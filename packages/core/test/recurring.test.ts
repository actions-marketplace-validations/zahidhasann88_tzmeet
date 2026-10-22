import { describe, expect, it } from "vitest";
import {
  InputValidationError,
  recurringImpact,
  type RecurringInput,
} from "../src/index.js";

const team = [
  { id: "Europe/London" },
  { id: "America/New_York" },
  { id: "Asia/Dhaka" },
];
const impact = (input: Partial<RecurringInput>) =>
  recurringImpact({
    zones: team,
    startDate: "2026-10-12",
    time: "14:00",
    weeks: 30,
    ...input,
  });
const summary = (input: Partial<RecurringInput>) =>
  impact(input).periods.map((period) => [
    period.from,
    period.weeks,
    period.zones.map((zone) => zone.localTime).join(" "),
  ]);

describe("recurringImpact", () => {
  it("follows a London-anchored meeting through the US/UK mismatch weeks", () => {
    expect(summary({})).toEqual([
      ["2026-10-12", 2, "14:00 09:00 19:00"],
      ["2026-10-26", 1, "14:00 10:00 20:00"],
      ["2026-11-02", 19, "14:00 09:00 20:00"],
      ["2027-03-15", 2, "14:00 10:00 20:00"],
      ["2027-03-29", 6, "14:00 09:00 19:00"],
    ]);
  });

  it("names the clock change that starts each period", () => {
    expect(impact({}).periods.map((period) => period.causes)).toEqual([
      [],
      ["Europe/London clocks went back 1 hour on 2026-10-25"],
      ["America/New_York clocks went back 1 hour on 2026-11-01"],
      ["America/New_York clocks went forward 1 hour on 2027-03-14"],
      ["Europe/London clocks went forward 1 hour on 2027-03-28"],
    ]);
  });

  it("is informational when a move stays inside the same hours", () => {
    const week = impact({}).warnings.find(
      (warning) => warning.date === "2026-10-26",
    )!;
    expect(week.severity).toBe("info");
    expect(week.message).toBe(
      "Week of 2026-10-26: New York at 10:00 instead of 09:00; Dhaka at 20:00 instead of 19:00 (outside work hours). Europe/London clocks went back 1 hour on 2026-10-25.",
    );
  });

  it("warns when a move pushes a zone outside its hours", () => {
    const result = impact({
      zones: [{ id: "Europe/London" }, { id: "Asia/Dhaka" }],
      time: "15:00",
    });
    const winter = result.warnings.find(
      (warning) => warning.date === "2026-10-26",
    )!;
    expect(winter).toMatchObject({ severity: "warning" });
    expect(winter.message).toBe(
      "2026-10-26 to 2027-03-22 (22 weeks): Dhaka at 21:00 instead of 20:00 (blocked: outside allowed hours). Europe/London clocks went back 1 hour on 2026-10-25.",
    );
  });

  it("reports the weekday, anchor and every occurrence", () => {
    const result = impact({ weeks: 3, durationMinutes: 45 });
    expect(result).toMatchObject({
      anchor: "Europe/London",
      time: "14:00",
      weekday: "Monday",
      durationMinutes: 45,
      weeks: 3,
    });
    expect(
      result.occurrences.map((occurrence) => [
        occurrence.date,
        occurrence.start,
        occurrence.end,
      ]),
    ).toEqual([
      ["2026-10-12", "2026-10-12T13:00:00.000Z", "2026-10-12T13:45:00.000Z"],
      ["2026-10-19", "2026-10-19T13:00:00.000Z", "2026-10-19T13:45:00.000Z"],
      ["2026-10-26", "2026-10-26T14:00:00.000Z", "2026-10-26T14:45:00.000Z"],
    ]);
  });

  it("shows the local day offset across the date line", () => {
    const result = recurringImpact({
      zones: [{ id: "America/Los_Angeles" }, { id: "Asia/Tokyo" }],
      startDate: "2026-11-02",
      time: "17:00",
      weeks: 1,
    });
    expect(result.occurrences[0]!.zones[1]).toMatchObject({
      localTime: "10:00",
      dayOffset: 1,
      classification: "ideal",
    });
  });

  it("uses each zone's weekend, holidays and prayer rules", () => {
    const result = recurringImpact({
      zones: [
        { id: "Europe/London" },
        { id: "Asia/Dhaka", holidays: ["2026-12-16"], quietAfter: "22:00" },
      ],
      startDate: "2026-12-09",
      time: "14:00",
      weeks: 3,
    });
    expect(
      result.periods.map((period) => [
        period.from,
        period.weeks,
        period.zones[1]!.classification,
        period.causes,
      ]),
    ).toEqual([
      ["2026-12-09", 1, "acceptable", []],
      ["2026-12-16", 1, "blocked", ["Holiday in Dhaka"]],
      ["2026-12-23", 1, "acceptable", ["Holiday in Dhaka is over"]],
    ]);
    expect(result.warnings[0]!.message).toBe(
      "Week of 2026-12-16: Dhaka at 20:00 (blocked: holiday). Holiday in Dhaka.",
    );
  });

  it("follows RFC 5545 for skipped and repeated anchor times", () => {
    const zones = [
      {
        id: "America/New_York",
        workStart: "00:00",
        workEnd: "23:00",
        quietBefore: "00:00",
        quietAfter: "23:59",
        weekend: [],
      },
    ];
    const gap = recurringImpact({
      zones,
      startDate: "2027-03-07",
      time: "02:30",
      weeks: 2,
    });
    expect(
      gap.occurrences.map((occurrence) => [
        occurrence.status,
        occurrence.zones[0]!.localStart,
      ]),
    ).toEqual([
      ["ok", "2027-03-07T02:30:00.000-05:00"],
      ["shifted", "2027-03-14T03:30:00.000-04:00"],
    ]);
    expect(gap.warnings[0]!.message).toBe(
      "On 2027-03-14, 02:30 doesn't exist in America/New_York because clocks jump forward. Calendars move the meeting to 03:30.",
    );
    const fold = recurringImpact({
      zones,
      startDate: "2026-11-01",
      time: "01:30",
      weeks: 1,
    });
    expect(fold.occurrences[0]).toMatchObject({
      status: "ambiguous",
      start: "2026-11-01T05:30:00.000Z",
    });
  });

  it("raises no DST changes for zones without DST", () => {
    const result = recurringImpact({
      zones: [{ id: "Asia/Dhaka" }, { id: "Asia/Kolkata" }],
      startDate: "2026-10-05",
      time: "11:00",
      weeks: 52,
    });
    expect(result.periods).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("validates input with path-specific errors", () => {
    expect(() => impact({ time: "25:00" })).toThrow(InputValidationError);
    expect(() => impact({ weeks: 0 })).toThrow(/weeks/);
    expect(() => impact({ zones: [{ id: "Mars/Base" }] })).toThrow(
      /Unknown IANA time zone/,
    );
  });
});
