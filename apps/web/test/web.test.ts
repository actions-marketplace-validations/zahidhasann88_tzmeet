import { describe, expect, it } from "vitest";
import {
  availabilityGrid,
  meHash,
  meShareLink,
  nextWorkingTime,
  parseMeHash,
  statusNow,
  upcomingHolidays,
  type MeState,
} from "../src/me-state";
import {
  classifySpan,
  classifySpans,
  findSlots,
  type Slot,
} from "@tzmeet/core";
import { calendarText, foldLine, inviteText } from "../src/invite";
import {
  decodeState,
  defaultState,
  encodeState,
  initials,
  parseState,
  persistState,
  regionalZone,
  restoreState,
  STORAGE_KEY,
} from "../src/state";
import { makeTimeline } from "../src/timeline";
import {
  CALENDAR_STORAGE_KEY,
  loadRememberedCalendars,
  readCalendars,
  saveRememberedCalendars,
  withBusy,
} from "../src/calendars";
import {
  cronHash,
  cronShareLink,
  defaultCronState,
  fieldLabels,
  isCronRoute,
  parseCronHash,
} from "../src/cron-state";

function fixture(): Slot {
  const open = {
    workStart: "00:00",
    workEnd: "23:59",
    quietBefore: "00:00",
    quietAfter: "23:59",
    weekend: [],
  };
  const result = findSlots({
    zones: ["Asia/Dhaka", "Europe/London", "America/New_York"].map((id) => ({
      ...open,
      id,
    })),
    startDate: "2026-11-03",
    days: 1,
  });
  return result.slots.find(
    (slot) => slot.start === "2026-11-02T18:15:00.000Z",
  )!;
}

describe("shareable and persistent state", () => {
  it("round-trips every input/view setting, zone order, and custom prayer coordinates", () => {
    const state = defaultState();
    state.input.startDate = "2026-11-02";
    state.input.zones.reverse();
    state.input.zones[0]!.label = "Team A & B / ঢাকা";
    state.prayerDraft = {
      location: { lat: 23.8103, lng: 90.4125 },
      method: "MWL",
      bufferMinutes: 17,
    };
    state.input.prayer = state.prayerDraft;
    state.theme = "dark";
    state.customDuration = true;
    state.input.durationMinutes = 37;
    state.day = "2026-11-03";
    state.selected = "2026-11-03T12:00:00.000Z";
    state.expanded = state.selected;
    state.panels = state.input.zones.map((zone) => zone.id);
    state.shown = 30;
    expect(decodeState(`?${encodeState(state)}`)).toEqual(state);
  });

  it("prioritizes the URL over storage and ignores malformed stored data", () => {
    const state = defaultState();
    state.theme = "dark";
    expect(
      restoreState(`?${encodeState(state)}`, { getItem: () => "broken JSON" })
        .state.theme,
    ).toBe("dark");
    expect(
      restoreState("", { getItem: () => "broken JSON" }).state.input.zones,
    ).toHaveLength(3);
    expect(restoreState("?state=broken", null).notice).toContain(
      "invalid settings",
    );
  });

  it("handles denied storage on read/write without throwing", () => {
    expect(
      restoreState("", {
        getItem: () => {
          throw new Error("denied");
        },
      }).state,
    ).toBeDefined();
    expect(() =>
      persistState(defaultState(), {
        setItem: () => {
          throw new Error("denied");
        },
      }),
    ).not.toThrow();
    let saved = "";
    persistState(defaultState(), {
      setItem: (key, value) => {
        expect(key).toBe(STORAGE_KEY);
        saved = value;
      },
    });
    expect(parseState(JSON.parse(saved)).v).toBe(1);
  });

  it("rejects unknown versions, bad zones and nonexistent civil dates", () => {
    const state = defaultState();
    expect(() => parseState({ ...state, v: 2 })).toThrow();
    state.input.zones[0]!.id = "Mars/Olympus";
    expect(() => encodeState(state)).toThrow();
    state.input.zones = [regionalZone("Pacific/Apia")];
    state.input.startDate = "2011-12-30";
    expect(() => encodeState(state)).toThrow(/civil date/);
  });

  it("sets Dhaka regional defaults without changing conventional weekends elsewhere", () => {
    expect(regionalZone("Asia/Dhaka").weekend).toEqual([5, 6]);
    expect(regionalZone("America/New_York").weekend).toEqual([6, 7]);
    expect(regionalZone("Europe/London").workStart).toBe("09:00");
  });

  it("builds avatar initials from each word of multi-word names", () => {
    expect(initials("New York")).toBe("NY");
    expect(initials("Los  Angeles")).toBe("LA");
    expect(initials("Dhaka")).toBe("DH");
    expect(initials("UTC")).toBe("UT");
  });

  it("colours holiday dates on the timeline", () => {
    const input = parseState({
      ...defaultState(),
      input: {
        zones: [{ ...regionalZone("Asia/Dhaka"), holidays: ["2026-12-16"] }],
        startDate: "2026-12-16",
      },
    }).input;
    const kinds = makeTimeline(input, "2026-12-16")[0]!.segments.map(
      (segment) => segment.kind,
    );
    expect(kinds).toContain("holiday");
    expect(kinds).not.toContain("work");
  });
});

describe("invite and calendar exports", () => {
  it("includes every zone and disambiguates differing local dates", () => {
    const text = inviteText(fixture());
    expect(text).toContain("Tue 3 Nov 2026");
    expect(text).toContain("00:15–00:45 Dhaka");
    expect(text).toContain("18:15–18:45 London (Mon 2 Nov)");
    expect(text).toContain("13:15–13:45 New York (Mon 2 Nov)");
  });

  it("uses UTC calendar instants, stable UID, CRLF and an explicit creation timestamp", () => {
    const slot = fixture();
    const content = calendarText(slot, "2026-10-14T12:00:00Z");
    expect(content).toContain("DTSTART:20261102T181500Z\r\n");
    expect(content).toContain("DTEND:20261102T184500Z\r\n");
    expect(content).toContain("DTSTAMP:20261014T120000Z\r\n");
    expect(content).toMatch(/UID:20261102T181500Z-\w+@tzmeet.local\r\n/);
    expect(content.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(content).toBe(calendarText(slot, "2026-10-14T12:00:00Z"));
  });

  it("escapes untrusted text rather than allowing ICS property injection", () => {
    const slot = fixture();
    slot.reason = "Hello, world; test\\path\nATTENDEE:bad";
    const content = calendarText(slot, "2026-10-14T12:00:00Z").replaceAll(
      "\r\n ",
      "",
    );
    expect(content).toContain("Hello\\, world\\; test\\\\path\\nATTENDEE:bad");
    expect(content).not.toContain("\r\nATTENDEE:bad");
  });

  it("folds multi-byte text by UTF-8 bytes without splitting a codepoint", () => {
    const text = "DESCRIPTION:" + "ঢাকা 😀".repeat(30);
    const folded = foldLine(text);
    expect(folded.replaceAll("\r\n ", "")).toBe(text);
    for (const line of folded.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("shared full-span timeline evaluation", () => {
  it("bulk evaluation is identical to independent span evaluation across a DST fold", () => {
    const rule = {
      id: "America/New_York",
      weekend: [],
      workStart: "01:30",
      workEnd: "04:00",
      quietBefore: "01:15",
    };
    const spans = [
      { start: "2026-11-01T05:45:00Z", end: "2026-11-01T06:45:00Z" },
      { start: "2026-11-01T07:00:00Z", end: "2026-11-01T07:30:00Z" },
    ];
    expect(classifySpans(rule, spans)).toEqual(
      spans.map((span) => classifySpan(rule, span.start, span.end)),
    );
  });

  it("bulk spans also enforce unambiguous instants and positive durations", () => {
    expect(() =>
      classifySpans({ id: "UTC" }, [
        { start: "2026-11-02T09:00:00", end: "2026-11-02T10:00:00" },
      ]),
    ).toThrow(/offset/);
    expect(() =>
      classifySpans({ id: "UTC" }, [
        { start: "2026-11-02T10:00:00Z", end: "2026-11-02T09:00:00Z" },
      ]),
    ).toThrow(/end after start/);
  });

  it("covers the complete shared UTC axis and retains weekend/prayer colors", () => {
    const input = defaultState().input;
    input.prayer = { location: "Dhaka", method: "Karachi", bufferMinutes: 10 };
    const rows = makeTimeline(input, "2026-11-02");
    expect(rows).toHaveLength(3);
    for (const row of rows)
      expect(
        row.segments.reduce((sum, segment) => sum + segment.width, 0),
      ).toBeCloseTo(100, 8);
    expect(rows[0]!.segments.some((segment) => segment.kind === "prayer")).toBe(
      true,
    );
    expect(
      rows[2]!.segments.some((segment) => segment.kind === "weekend"),
    ).toBe(true);
    expect(rows[0]!.origin).toContain("06:00");
  });
});

describe("cron page state", () => {
  it("round-trips through the URL hash", () => {
    const state = {
      expression: "0 0 9 ? * MON-FRI",
      dialect: "quartz" as const,
      zone: "Asia/Dhaka",
      display: ["UTC", "Europe/London"],
      count: 20,
    };
    const hash = cronHash(state);
    expect(isCronRoute(hash)).toBe(true);
    expect(parseCronHash(hash)).toEqual(state);
  });

  it("falls back to defaults for missing or invalid values", () => {
    expect(parseCronHash("#/cron")).toEqual(defaultCronState());
    expect(
      parseCronHash("#/cron?d=cronie&z=Mars/Base&n=7&show=UTC,Nope,UTC"),
    ).toEqual({ ...defaultCronState(), display: ["UTC"] });
    expect(parseCronHash("#results")).toEqual(defaultCronState());
    expect(isCronRoute("#/cronjobs")).toBe(false);
  });

  it("labels fields by expression length", () => {
    expect(fieldLabels(5)[4]).toBe("day of week");
    expect(fieldLabels(7)).toHaveLength(7);
  });
});

describe("holiday presets in shared state", () => {
  it("round-trips a zone holiday preset through the URL", () => {
    const state = defaultState();
    state.input.startDate = "2026-11-02";
    state.input.zones[0]!.holidayPreset = "BD";
    expect(
      decodeState(`?${encodeState(state)}`)!.input.zones[0]!.holidayPreset,
    ).toBe("BD");
  });
});

describe("imported calendars", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:1",
    "DTSTART;VALUE=DATE:20261102",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("reads busy times per zone and merges them into the search input only", () => {
    const state = defaultState();
    state.input.startDate = "2026-11-02";
    const results = readCalendars(
      {
        "Europe/London": { name: "london.ics", text: ics },
        "Asia/Tokyo": { name: "gone.ics", text: ics },
      },
      state.input,
    );
    expect(Object.keys(results)).toEqual(["Europe/London"]);
    expect(results["Europe/London"]).toMatchObject({
      busy: [
        { start: "2026-11-02T00:00:00.000Z", end: "2026-11-03T00:00:00.000Z" },
      ],
      events: 1,
    });
    const merged = withBusy(state.input, results);
    expect(
      merged.zones.find((zone) => zone.id === "Europe/London")!.busy,
    ).toHaveLength(1);
    expect(
      state.input.zones.find((zone) => zone.id === "Europe/London")!.busy,
    ).toBeUndefined();
  });

  it("reports unreadable calendars instead of throwing", () => {
    const state = defaultState();
    expect(
      readCalendars(
        { "Europe/London": { name: "notes.txt", text: "hello" } },
        state.input,
      )["Europe/London"],
    ).toEqual({ error: "This doesn't look like an iCalendar (.ics) file" });
  });
});

describe("compact share links", () => {
  it("are much shorter than the full JSON and still round-trip every setting", () => {
    const state = defaultState();
    state.input.startDate = "2026-11-02";
    state.day = "2026-11-02";
    const short = encodeState(state);
    const legacy = new URLSearchParams({
      state: JSON.stringify(state),
    }).toString();
    expect(short.startsWith("s=")).toBe(true);
    expect(short.length).toBeLessThan(legacy.length / 4);
    expect(decodeState(`?${short}`)).toEqual(state);
    state.input.zones[1] = {
      ...state.input.zones[1]!,
      label: "ঢাকা টিম",
      workStart: "10:00",
      holidayPreset: "GB-ENG",
      optional: true,
    };
    state.input.durationMinutes = 45;
    state.theme = "dark";
    state.day = "2026-11-03";
    state.prayerDraft = {
      location: { lat: 23.8, lng: 90.4 },
      method: "MWL",
      bufferMinutes: 5,
    };
    expect(decodeState(`?${encodeState(state)}`)).toEqual(state);
  });

  it("still opens older ?state= links and rejects broken ones", () => {
    const state = defaultState();
    expect(
      decodeState(`?${new URLSearchParams({ state: JSON.stringify(state) })}`),
    ).toEqual(state);
    expect(() => decodeState("?s=not-base64-json")).toThrow();
    expect(restoreState("?s=%%%", null).notice).toContain("invalid settings");
  });
});

describe("remembered calendars", () => {
  const memory = () => {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
  };

  it("stores only calendars marked remember, and loads them back", () => {
    const storage = memory();
    expect(
      saveRememberedCalendars(
        {
          UTC: { name: "me.ics", text: "BEGIN:VCALENDAR", remember: true },
          "Asia/Dhaka": { name: "team.ics", text: "x" },
        },
        storage,
      ),
    ).toBe(true);
    expect(JSON.parse(storage.items.get(CALENDAR_STORAGE_KEY)!)).toEqual({
      UTC: { name: "me.ics", text: "BEGIN:VCALENDAR" },
    });
    expect(loadRememberedCalendars(storage)).toEqual({
      UTC: { name: "me.ics", text: "BEGIN:VCALENDAR", remember: true },
    });
  });

  it("forgets everything when nothing is remembered, and survives bad data", () => {
    const storage = memory();
    storage.setItem(CALENDAR_STORAGE_KEY, '{"UTC":{"name":"a","text":"b"}}');
    expect(
      saveRememberedCalendars({ UTC: { name: "a", text: "b" } }, storage),
    ).toBe(true);
    expect(storage.items.has(CALENDAR_STORAGE_KEY)).toBe(false);
    storage.setItem(CALENDAR_STORAGE_KEY, "not json");
    expect(loadRememberedCalendars(storage)).toEqual({});
    storage.setItem(CALENDAR_STORAGE_KEY, '{"UTC":{"name":1}}');
    expect(loadRememberedCalendars(storage)).toEqual({});
    expect(loadRememberedCalendars(null)).toEqual({});
  });

  it("refuses calendars too large to keep, or storage that throws", () => {
    const storage = memory();
    expect(
      saveRememberedCalendars(
        {
          UTC: {
            name: "big.ics",
            text: "x".repeat(3 * 1024 * 1024),
            remember: true,
          },
        },
        storage,
      ),
    ).toBe(false);
    expect(
      saveRememberedCalendars(
        { UTC: { name: "a", text: "b", remember: true } },
        {
          setItem: () => {
            throw new Error("quota");
          },
          removeItem: () => {},
        },
      ),
    ).toBe(false);
  });
});

describe("cron share links", () => {
  it("go through the static /cron/ preview page and keep every setting", () => {
    const state = {
      expression: "30 1 * * *",
      dialect: "kubernetes" as const,
      zone: "Europe/London",
      display: ["Asia/Tokyo"],
      count: 20,
    };
    const link = cronShareLink(
      state,
      "https://example.github.io/tzmeet/?s=abc#/cron?e=old",
    );
    expect(link.startsWith("https://example.github.io/tzmeet/cron/#e=")).toBe(
      true,
    );
    expect(parseCronHash(`#/cron?${link.split("#")[1]}`)).toEqual(state);
  });
});

describe("working-hours links", () => {
  const zahid: MeState = {
    name: "Zahid",
    zone: "Asia/Dhaka",
    workStart: "09:00",
    workEnd: "18:00",
    weekend: [5, 6],
    holidayPreset: "BD",
  };

  it("round-trip through the URL hash and the /me/ preview page", () => {
    expect(parseMeHash(meHash(zahid))).toEqual(zahid);
    const link = meShareLink(zahid, "https://example.github.io/tzmeet/#/me");
    expect(
      link.startsWith(
        "https://example.github.io/tzmeet/me/#n=Zahid&z=Asia%2FDhaka",
      ),
    ).toBe(true);
    expect(parseMeHash(`#/me?${link.split("#")[1]}`)).toEqual(zahid);
  });

  it("reject links without a valid zone or with impossible hours, and default the rest", () => {
    expect(parseMeHash("#/me")).toBeNull();
    expect(parseMeHash("#/me?z=Mars/Base")).toBeNull();
    expect(parseMeHash("#/me?z=UTC&w=09:00-09:00")).toBeNull();
    expect(parseMeHash("#/me?z=Asia/Dhaka")).toEqual({
      name: "",
      zone: "Asia/Dhaka",
      workStart: "09:00",
      workEnd: "18:00",
      weekend: [5, 6],
    });
    expect(parseMeHash("#/me?z=UTC&h=XX")!.holidayPreset).toBeUndefined();
  });

  it("lays out availability in the viewer's zone, following DST", () => {
    const grid = availabilityGrid(
      zahid,
      "Europe/London",
      new Date("2026-10-23T09:35:00Z"),
    );
    expect(grid.map((row) => row.date)).toEqual([
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
    ]);
    expect(grid[0]!.cells.every((cell) => cell === "off")).toBe(true);
    expect(grid[2]!.cells.indexOf("work")).toBe(6);
    expect(grid[2]!.cells.lastIndexOf("work")).toBe(23);
    expect(grid[2]!.cells[5]).toBe("reachable");
  });

  it("says whether they are working now and when they next start", () => {
    expect(statusNow(zahid, new Date("2026-10-26T05:00:00Z"))).toEqual({
      kind: "work",
      local: "Mon 11:00",
    });
    expect(statusNow(zahid, new Date("2026-10-23T09:35:00Z")).kind).toBe("off");
    expect(nextWorkingTime(zahid, new Date("2026-10-23T09:35:00Z"))).toBe(
      "2026-10-25T03:00:00.000Z",
    );
  });

  it("lists upcoming public holidays", () => {
    expect(upcomingHolidays(zahid, new Date("2026-12-01T00:00:00Z"))).toEqual([
      { date: "2026-12-16", name: "Victory Day" },
      { date: "2026-12-25", name: "Christmas Day" },
    ]);
    expect(
      upcomingHolidays(
        { ...zahid, holidayPreset: undefined },
        new Date("2026-12-01T00:00:00Z"),
      ),
    ).toEqual([]);
  });
});
