import { describe, expect, it } from "vitest";
import {
  findSlots,
  holidayListYears,
  parseScheduleInput,
  presetHolidays,
  presetNote,
  ScheduleInputError,
  suggestHolidayPreset,
} from "../src/index.js";

const dates = (preset: Parameters<typeof presetHolidays>[0], year: number) =>
  presetHolidays(preset, year).map((holiday) => holiday.date);

describe("US federal holidays", () => {
  it("matches the 2026 OPM list, including Saturday observance", () => {
    expect(dates("US", 2026)).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03",
      "2026-09-07",
      "2026-10-12",
      "2026-11-11",
      "2026-11-26",
      "2026-12-25",
    ]);
  });

  it("observes weekend dates on Friday/Monday, including next New Year on 31 December", () => {
    expect(dates("US", 2027)).toEqual([
      "2027-01-01",
      "2027-01-18",
      "2027-02-15",
      "2027-05-31",
      "2027-06-18",
      "2027-07-05",
      "2027-09-06",
      "2027-10-11",
      "2027-11-11",
      "2027-11-25",
      "2027-12-24",
      "2027-12-31",
    ]);
    expect(dates("US", 2028)[0]).toBe("2028-01-17");
  });
});

describe("England and Wales bank holidays", () => {
  it("matches the 2026 gov.uk list, with Boxing Day substituted", () => {
    expect(dates("GB-ENG", 2026)).toEqual([
      "2026-01-01",
      "2026-04-03",
      "2026-04-06",
      "2026-05-04",
      "2026-05-25",
      "2026-08-31",
      "2026-12-25",
      "2026-12-28",
    ]);
  });

  it("substitutes both Christmas days when they fall on a weekend", () => {
    expect(dates("GB-ENG", 2027)).toEqual([
      "2027-01-01",
      "2027-03-26",
      "2027-03-29",
      "2027-05-03",
      "2027-05-31",
      "2027-08-30",
      "2027-12-27",
      "2027-12-28",
    ]);
    expect(dates("GB-ENG", 2022).slice(-2)).toEqual([
      "2022-12-26",
      "2022-12-27",
    ]);
  });
});

describe("Bangladesh public holidays", () => {
  const named = (year: number) =>
    Object.fromEntries(
      presetHolidays("BD", year)
        .filter((holiday) => !holiday.name.endsWith("holiday"))
        .map((holiday) => [holiday.name, holiday.date]),
    );

  it("reproduces announced Eid dates for 2024 and 2025", () => {
    expect(named(2024)).toMatchObject({
      "Eid al-Fitr": "2024-04-11",
      "Eid al-Adha": "2024-06-17",
      Ashura: "2024-07-17",
      "Eid-e-Milad-un-Nabi": "2024-09-16",
    });
    expect(named(2025)).toMatchObject({
      "Eid al-Fitr": "2025-03-31",
      "Eid al-Adha": "2025-06-07",
      Ashura: "2025-07-06",
      "Eid-e-Milad-un-Nabi": "2025-09-05",
    });
  });

  it("gives Eid a day either side, marked approximate, plus fixed national days", () => {
    const year = presetHolidays("BD", 2026);
    expect(
      year
        .filter((holiday) => holiday.name.startsWith("Eid al-Fitr"))
        .map((holiday) => [holiday.date, holiday.approximate]),
    ).toEqual([
      ["2026-03-20", true],
      ["2026-03-21", true],
      ["2026-03-22", true],
    ]);
    expect(
      year
        .filter((holiday) => !holiday.approximate)
        .map((holiday) => `${holiday.date} ${holiday.name}`),
    ).toEqual([
      "2026-02-21 Shaheed Day and International Mother Language Day",
      "2026-03-26 Independence Day",
      "2026-04-14 Pohela Boishakh (Bengali New Year)",
      "2026-05-01 Buddha Purnima",
      "2026-05-01 May Day",
      "2026-09-04 Janmashtami",
      "2026-10-20 Durga Puja (Nabami)",
      "2026-10-21 Durga Puja (Bijoya Dashami)",
      "2026-12-16 Victory Day",
      "2026-12-25 Christmas Day",
    ]);
    expect(presetNote("BD", 2026)).toBeNull();
    expect(presetNote("BD", 2027)).toContain("Hindu and Buddhist holidays");
  });
});

describe("presets in scheduling", () => {
  it("suggests a preset by zone", () => {
    expect(
      [
        "Asia/Dhaka",
        "Europe/London",
        "America/Chicago",
        "America/Indiana/Indianapolis",
        "Pacific/Honolulu",
        "Asia/Kolkata",
        "Asia/Karachi",
        "Asia/Dubai",
        "Asia/Tokyo",
      ].map(suggestHolidayPreset),
    ).toEqual(["BD", "GB-ENG", "US", "US", "US", "IN", "PK", "AE", undefined]);
  });

  it("blocks preset holidays like weekends and reports them in diagnostics", () => {
    const zones = [
      { id: "Asia/Dhaka", holidayPreset: "BD" as const },
      { id: "Europe/London" },
    ];
    const result = findSlots({ zones, startDate: "2026-12-16", days: 1 });
    expect(result.slots).toEqual([]);
    expect(result.diagnostics.mostRestrictive).toMatchObject({
      zoneId: "Asia/Dhaka",
      constraint: "holiday",
    });
    expect(
      findSlots({
        zones: [{ id: "Asia/Dhaka" }, { id: "Europe/London" }],
        startDate: "2026-12-16",
        days: 1,
      }).slots.length,
    ).toBeGreaterThan(0);
  });

  it("merges manual holidays with the preset", () => {
    const zones = [
      {
        id: "Europe/London",
        holidayPreset: "GB-ENG" as const,
        holidays: ["2026-12-29"],
        weekend: [],
      },
    ];
    const blocked = (date: string) =>
      findSlots({ zones, startDate: date, days: 1 }).slots.length === 0;
    expect([
      blocked("2026-12-25"),
      blocked("2026-12-28"),
      blocked("2026-12-29"),
      blocked("2026-12-30"),
    ]).toEqual([true, true, true, false]);
  });

  it("parses --holiday-preset per zone, case-insensitively, with none to clear", () => {
    const input = parseScheduleInput(
      {
        zones: "Asia/Dhaka,Europe/London",
        date: "2026-11-02",
        holidayPreset: [
          "Asia/Dhaka=bd",
          "Europe/London=GB-ENG",
          "Europe/London=none",
        ],
      },
      { zones: [{ id: "Europe/London", holidayPreset: "GB-ENG" }] },
    );
    expect(input.zones.map((zone) => zone.holidayPreset)).toEqual([
      "BD",
      undefined,
    ]);
    expect(() =>
      parseScheduleInput({
        zones: "UTC",
        date: "2026-11-02",
        holidayPreset: ["UTC=FR"],
      }),
    ).toThrow(ScheduleInputError);
    expect(() =>
      parseScheduleInput({
        zones: "UTC",
        date: "2026-11-02",
        holidayPreset: ["UTC=FR"],
      }),
    ).toThrow(/use BD, GB-ENG, IN, PK, AE, US or none/);
  });
});

describe("India central government holidays", () => {
  it("uses the DoPT gazetted lists for 2026 and 2027", () => {
    expect(holidayListYears("IN")).toEqual([2026, 2027]);
    const year = presetHolidays("IN", 2026);
    expect(year).toHaveLength(17);
    expect(
      year
        .filter((holiday) =>
          ["Holi", "Diwali", "Dussehra"].includes(holiday.name),
        )
        .map((holiday) => holiday.date),
    ).toEqual(["2026-03-04", "2026-10-20", "2026-11-08"]);
    expect(year.find((holiday) => holiday.name === "Id-ul-Fitr")).toEqual({
      date: "2026-03-21",
      name: "Id-ul-Fitr",
      approximate: true,
    });
    expect(
      presetHolidays("IN", 2027).find(
        (holiday) => holiday.name === "Ram Navami",
      )!.date,
    ).toBe("2027-04-15");
    expect(presetNote("IN", 2027)).toBeNull();
  });

  it("falls back to fixed national holidays, and says so, in other years", () => {
    expect(
      presetHolidays("IN", 2028).map(
        (holiday) => `${holiday.date} ${holiday.name}`,
      ),
    ).toEqual([
      "2028-01-26 Republic Day",
      "2028-04-14 Good Friday",
      "2028-08-15 Independence Day",
      "2028-10-02 Mahatma Gandhi's Birthday",
      "2028-12-25 Christmas Day",
    ]);
    expect(presetNote("IN", 2028)).toBe(
      "Only fixed national holidays and Good Friday are included for 2028. Festival dates come from the government's yearly list, which tzmeet has for 2026–2027.",
    );
  });
});

describe("Pakistan and UAE holidays", () => {
  const named = (preset: "PK" | "AE", year: number, name: string) =>
    presetHolidays(preset, year)
      .filter((holiday) => holiday.name.startsWith(name))
      .map((holiday) => holiday.date);

  it("matches Pakistan's 2026 notifications for Eid ul-Adha and Ashura", () => {
    expect(named("PK", 2026, "Eid ul-Adha")).toEqual([
      "2026-05-26",
      "2026-05-27",
      "2026-05-28",
    ]);
    expect(named("PK", 2026, "Ashura")).toEqual(["2026-06-24", "2026-06-25"]);
    expect(
      presetHolidays("PK", 2026)
        .filter((holiday) => !holiday.approximate)
        .map((holiday) => holiday.date),
    ).toEqual([
      "2026-02-05",
      "2026-03-23",
      "2026-05-01",
      "2026-05-28",
      "2026-08-14",
      "2026-11-09",
      "2026-12-25",
    ]);
    expect(presetNote("PK", 2030)).toBeNull();
  });

  it("matches the UAE's 2026 Eid and Arafat Day holidays", () => {
    expect(named("AE", 2026, "Eid al-Fitr")).toEqual([
      "2026-03-19",
      "2026-03-20",
      "2026-03-21",
      "2026-03-22",
    ]);
    expect([
      ...named("AE", 2026, "Arafat"),
      ...named("AE", 2026, "Eid al-Adha"),
    ]).toEqual(["2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29"]);
    expect(named("AE", 2026, "National Day")).toEqual([
      "2026-12-02",
      "2026-12-03",
    ]);
  });
});
