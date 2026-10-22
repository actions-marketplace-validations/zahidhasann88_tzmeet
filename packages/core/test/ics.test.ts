import { describe, expect, it } from "vitest";
import { findSlots, parseIcsBusy, ScheduleInputError } from "../src/index.js";

const event = (...lines: string[]) =>
  ["BEGIN:VEVENT", "UID:" + Math.random(), ...lines, "END:VEVENT"].join("\r\n");
const calendar = (...events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
const window = {
  from: "2026-10-01T00:00:00Z",
  to: "2027-01-01T00:00:00Z",
  defaultZone: "Asia/Dhaka",
};
const busy = (text: string, options = window) => parseIcsBusy(text, options);
const spans = (text: string, options = window) =>
  busy(text, options).busy.map(
    ({ start, end }) => `${start.slice(0, 16)}/${end.slice(11, 16)}`,
  );

describe("parseIcsBusy: single events", () => {
  it("reads UTC, IANA, Windows and floating times", () => {
    const text = calendar(
      event(
        "DTSTART:20261102T090000Z",
        "DTEND:20261102T093000Z",
        "SUMMARY:UTC",
      ),
      event(
        "DTSTART;TZID=Europe/London:20261103T090000",
        "DTEND;TZID=Europe/London:20261103T100000",
      ),
      event(
        'DTSTART;TZID="Eastern Standard Time":20261104T090000',
        'DTEND;TZID="Eastern Standard Time":20261104T093000',
      ),
      event(
        "DTSTART;TZID=/mozilla.org/20050126_1/America/Chicago:20261105T090000",
        "DTEND;TZID=/mozilla.org/20050126_1/America/Chicago:20261105T093000",
      ),
      event("DTSTART:20261106T090000", "DTEND:20261106T093000"),
    );
    expect(spans(text)).toEqual([
      "2026-11-02T09:00/09:30",
      "2026-11-03T09:00/10:00",
      "2026-11-04T14:00/14:30",
      "2026-11-05T15:00/15:30",
      "2026-11-06T03:00/03:30",
    ]);
    expect(busy(text).events).toBe(5);
  });

  it("treats all-day events as whole local days in the calendar owner's zone", () => {
    const text = calendar(
      event("DTSTART;VALUE=DATE:20261216", "DTEND;VALUE=DATE:20261218"),
      event("DTSTART;VALUE=DATE:20261225"),
    );
    expect(busy(text).busy).toEqual([
      { start: "2026-12-15T18:00:00.000Z", end: "2026-12-17T18:00:00.000Z" },
      { start: "2026-12-24T18:00:00.000Z", end: "2026-12-25T18:00:00.000Z" },
    ]);
  });

  it("uses DURATION, unfolds long lines and ignores alarms", () => {
    const text = calendar(
      event(
        "DTSTART;TZID=Europe/Lo\r\n ndon:20261103T090000",
        "DURATION:PT1H30M",
        "SUMMARY:A very long title that wraps\r\n  onto a second line",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "DURATION:PT5M",
        "ACTION:DISPLAY",
        "END:VALARM",
      ),
    );
    expect(spans(text)).toEqual(["2026-11-03T09:00/10:30"]);
  });

  it("skips free, cancelled and zero-length events, and merges overlaps", () => {
    const text = calendar(
      event(
        "DTSTART:20261102T090000Z",
        "DTEND:20261102T100000Z",
        "TRANSP:TRANSPARENT",
      ),
      event(
        "DTSTART:20261102T110000Z",
        "DTEND:20261102T120000Z",
        "STATUS:CANCELLED",
      ),
      event(
        "DTSTART:20261102T130000Z",
        "DTEND:20261102T140000Z",
        "X-MICROSOFT-CDO-BUSYSTATUS:FREE",
      ),
      event("DTSTART:20261102T150000Z", "DTEND:20261102T150000Z"),
      event("DTSTART:20261103T090000Z", "DTEND:20261103T100000Z"),
      event("DTSTART:20261103T093000Z", "DTEND:20261103T110000Z"),
      event("DTSTART:20261103T110000Z", "DTEND:20261103T113000Z"),
    );
    expect(spans(text)).toEqual(["2026-11-03T09:00/11:30"]);
  });

  it("keeps only events overlapping the window", () => {
    const text = calendar(
      event("DTSTART:20260930T230000Z", "DTEND:20261001T010000Z"),
      event("DTSTART:20270101T000000Z", "DTEND:20270101T010000Z"),
    );
    expect(spans(text)).toEqual(["2026-09-30T23:00/01:00"]);
  });

  it("does not keep titles or other details", () => {
    const result = busy(
      calendar(
        event(
          "DTSTART:20261102T090000Z",
          "DTEND:20261102T093000Z",
          "SUMMARY:Secret project",
          "LOCATION:Room 1",
        ),
      ),
    );
    expect(JSON.stringify(result)).not.toContain("Secret");
  });
});

describe("parseIcsBusy: repeating events", () => {
  it("keeps a weekly meeting at the same local time across DST", () => {
    const text = calendar(
      event(
        "DTSTART;TZID=Europe/London:20261019T090000",
        "DTEND;TZID=Europe/London:20261019T093000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
      ),
    );
    expect(spans(text)).toEqual([
      "2026-10-19T08:00/08:30",
      "2026-10-21T08:00/08:30",
      "2026-10-26T09:00/09:30",
      "2026-10-28T09:00/09:30",
    ]);
  });

  it("expands daily, monthly and yearly rules with INTERVAL and UNTIL", () => {
    const daily = calendar(
      event(
        "DTSTART:20261102T090000Z",
        "DTEND:20261102T091500Z",
        "RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261108",
      ),
    );
    expect(spans(daily).map((span) => span.slice(0, 10))).toEqual([
      "2026-11-02",
      "2026-11-04",
      "2026-11-06",
      "2026-11-08",
    ]);
    const weekdays = calendar(
      event(
        "DTSTART:20261102T090000Z",
        "DTEND:20261102T091500Z",
        "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=6",
      ),
    );
    expect(spans(weekdays).map((span) => span.slice(0, 10))).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-09",
    ]);
    const monthly = calendar(
      event(
        "DTSTART:20261013T100000Z",
        "DTEND:20261013T110000Z",
        "RRULE:FREQ=MONTHLY;BYDAY=2TU",
      ),
      event(
        "DTSTART:20261030T150000Z",
        "DTEND:20261030T160000Z",
        "RRULE:FREQ=MONTHLY;BYDAY=-1FR",
      ),
      event(
        "DTSTART:20261031T120000Z",
        "DTEND:20261031T130000Z",
        "RRULE:FREQ=MONTHLY",
      ),
    );
    expect(spans(monthly).map((span) => span.slice(0, 13))).toEqual([
      "2026-10-13T10",
      "2026-10-30T15",
      "2026-10-31T12",
      "2026-11-10T10",
      "2026-11-27T15",
      "2026-12-08T10",
      "2026-12-25T15",
      "2026-12-31T12",
    ]);
    const yearly = calendar(
      event("DTSTART;VALUE=DATE:20250216", "RRULE:FREQ=YEARLY"),
    );
    expect(
      busy(yearly, { ...window, to: "2028-01-01T00:00:00Z" }).busy.map((span) =>
        span.start.slice(0, 10),
      ),
    ).toEqual(["2027-02-15"]);
  });

  it("removes EXDATEs and moved or cancelled instances", () => {
    const series = [
      "UID:standup",
      "DTSTART;TZID=America/New_York:20261102T093000",
      "DTEND;TZID=America/New_York:20261102T094500",
      "RRULE:FREQ=DAILY;COUNT=5",
      "EXDATE;TZID=America/New_York:20261103T093000",
    ];
    const text = calendar(
      ["BEGIN:VEVENT", ...series, "END:VEVENT"].join("\r\n"),
      [
        "BEGIN:VEVENT",
        "UID:standup",
        "RECURRENCE-ID;TZID=America/New_York:20261104T093000",
        "DTSTART;TZID=America/New_York:20261104T160000",
        "DTEND;TZID=America/New_York:20261104T161500",
        "END:VEVENT",
      ].join("\r\n"),
      [
        "BEGIN:VEVENT",
        "UID:standup",
        "RECURRENCE-ID;TZID=America/New_York:20261105T093000",
        "DTSTART;TZID=America/New_York:20261105T093000",
        "DTEND;TZID=America/New_York:20261105T094500",
        "STATUS:CANCELLED",
        "END:VEVENT",
      ].join("\r\n"),
    );
    expect(spans(text)).toEqual([
      "2026-11-02T14:30/14:45",
      "2026-11-04T21:00/21:15",
      "2026-11-06T14:30/14:45",
    ]);
  });

  it("warns about unsupported rules and unknown zones instead of guessing", () => {
    const result = busy(
      calendar(
        event(
          "DTSTART:20261102T090000Z",
          "DTEND:20261102T093000Z",
          "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
        ),
        event(
          "DTSTART;TZID=Mars Standard Time:20261103T090000",
          "DTEND;TZID=Mars Standard Time:20261103T093000",
        ),
      ),
    );
    expect(result.busy).toEqual([
      { start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T09:30:00.000Z" },
    ]);
    expect(result.warnings).toEqual([
      'Skipped events in unknown time zones: "Mars Standard Time".',
      "1 repeating event uses an unsupported rule (BYSETPOS); only the first occurrence is used.",
    ]);
  });

  it("rejects files that aren't calendars and bad options", () => {
    expect(() => busy("hello")).toThrow(ScheduleInputError);
    expect(() =>
      busy(calendar(), { ...window, defaultZone: "Mars/Base" }),
    ).toThrow(/Unknown IANA/);
    expect(() => busy(calendar(), { ...window, to: window.from })).toThrow(
      /after from/,
    );
  });
});

describe("busy times in scheduling", () => {
  const zones = (busy: { start: string; end: string }[]) => [
    { id: "UTC", weekend: [], busy },
    { id: "Europe/London", weekend: [] },
  ];

  it("blocks overlapping slots but allows meetings that touch a busy time", () => {
    const result = findSlots({
      zones: zones([
        { start: "2026-11-02T10:00:00Z", end: "2026-11-02T11:00:00Z" },
      ]),
      startDate: "2026-11-02",
      days: 1,
      stepMinutes: 30,
    });
    const starts = result.slots.map((slot) => slot.start.slice(11, 16));
    expect(starts).toContain("09:30");
    expect(starts).toContain("11:00");
    expect(starts).not.toContain("10:00");
    expect(starts).not.toContain("10:30");
    expect(result.diagnostics.constraints).toContainEqual(
      expect.objectContaining({ zoneId: "UTC", constraint: "busy" }),
    );
  });

  it("explains a fully busy day", () => {
    const result = findSlots({
      zones: zones([
        { start: "2026-11-02T00:00:00Z", end: "2026-11-03T00:00:00Z" },
      ]),
      startDate: "2026-11-02",
      days: 1,
    });
    expect(result.slots).toEqual([]);
    expect(result.diagnostics.suggestion).toContain("UTC's calendar is busy");
  });

  it("validates busy intervals", () => {
    expect(() =>
      findSlots({
        zones: zones([
          { start: "2026-11-02T11:00:00Z", end: "2026-11-02T10:00:00Z" },
        ]),
        startDate: "2026-11-02",
      }),
    ).toThrow(/end must be after start/);
    expect(() =>
      findSlots({
        zones: zones([
          { start: "2026-11-02T10:00", end: "2026-11-02T11:00:00Z" },
        ]),
        startDate: "2026-11-02",
      }),
    ).toThrow(/ISO instant/);
  });
});
