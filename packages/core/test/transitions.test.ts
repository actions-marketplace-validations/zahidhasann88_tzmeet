import { describe, expect, it } from "vitest";
import {
  listTransitions,
  resolveLocal,
  ScheduleInputError,
} from "../src/index.js";

const summary = (zone: string, from: string, to: string) =>
  listTransitions(zone, from, to).map((t) => [
    t.at,
    t.kind,
    t.offsetBefore,
    t.offsetAfter,
  ]);

describe("listTransitions", () => {
  it("finds New York spring-forward and fall-back for 2026 and 2027", () => {
    expect(
      summary("America/New_York", "2026-01-01T00:00Z", "2028-01-01T00:00Z"),
    ).toEqual([
      ["2026-03-08T07:00:00.000Z", "gap", -300, -240],
      ["2026-11-01T06:00:00.000Z", "fold", -240, -300],
      ["2027-03-14T07:00:00.000Z", "gap", -300, -240],
      ["2027-11-07T06:00:00.000Z", "fold", -240, -300],
    ]);
  });

  it("finds London changes, which fall on different weeks from the US", () => {
    expect(
      summary("Europe/London", "2026-01-01T00:00Z", "2028-01-01T00:00Z"),
    ).toEqual([
      ["2026-03-29T01:00:00.000Z", "gap", 0, 60],
      ["2026-10-25T01:00:00.000Z", "fold", 60, 0],
      ["2027-03-28T01:00:00.000Z", "gap", 0, 60],
      ["2027-10-31T01:00:00.000Z", "fold", 60, 0],
    ]);
  });

  it("reports the local wall times on both sides of the change", () => {
    const [spring, autumn] = listTransitions(
      "America/New_York",
      "2026-01-01T00:00Z",
      "2027-01-01T00:00Z",
    );
    expect([spring!.localBefore, spring!.localAfter]).toEqual([
      "2026-03-08T02:00:00",
      "2026-03-08T03:00:00",
    ]);
    expect([autumn!.localBefore, autumn!.localAfter]).toEqual([
      "2026-11-01T02:00:00",
      "2026-11-01T01:00:00",
    ]);
  });

  it("returns nothing for zones without DST", () => {
    expect(
      listTransitions("Asia/Dhaka", "2026-01-01T00:00Z", "2036-01-01T00:00Z"),
    ).toEqual([]);
    expect(
      listTransitions("UTC", "2026-01-01T00:00Z", "2027-01-01T00:00Z"),
    ).toEqual([]);
  });

  it("handles the 30-minute Lord Howe shift", () => {
    expect(
      summary("Australia/Lord_Howe", "2026-01-01T00:00Z", "2027-01-01T00:00Z"),
    ).toEqual([
      ["2026-04-04T15:00:00.000Z", "fold", 660, 630],
      ["2026-10-03T15:30:00.000Z", "gap", 630, 660],
    ]);
  });

  it("orders southern-hemisphere changes fold first", () => {
    expect(
      summary("Australia/Sydney", "2026-01-01T00:00Z", "2027-01-01T00:00Z"),
    ).toEqual([
      ["2026-04-04T16:00:00.000Z", "fold", 660, 600],
      ["2026-10-03T16:00:00.000Z", "gap", 600, 660],
    ]);
  });

  it("treats the range as half-open [from, to)", () => {
    expect(
      summary("America/New_York", "2026-03-08T07:00Z", "2026-03-09T00:00Z"),
    ).toHaveLength(1);
    expect(
      summary("America/New_York", "2026-03-01T00:00Z", "2026-03-08T07:00Z"),
    ).toHaveLength(0);
  });

  it("accepts explicit offsets on the range bounds", () => {
    expect(
      summary(
        "America/New_York",
        "2026-03-08T00:00-05:00",
        "2026-03-09T00:00-04:00",
      ),
    ).toHaveLength(1);
  });

  it("rejects bad input with readable issues", () => {
    expect(() =>
      listTransitions("Mars/Olympus", "2026-01-01T00:00Z", "2027-01-01T00:00Z"),
    ).toThrow(ScheduleInputError);
    expect(() =>
      listTransitions("UTC", "2026-01-01T00:00", "2027-01-01T00:00Z"),
    ).toThrow(/explicit offset/);
    expect(() =>
      listTransitions("UTC", "2027-01-01T00:00Z", "2026-01-01T00:00Z"),
    ).toThrow(/later than from/);
    expect(() =>
      listTransitions("UTC", "2026-01-01T00:00Z", "2040-01-01T00:00Z"),
    ).toThrow(/at most 10 years/);
  });
});

describe("resolveLocal", () => {
  it("resolves an ordinary time to one instant", () => {
    expect(resolveLocal("Asia/Dhaka", "2026-11-02T20:00")).toEqual({
      status: "ok",
      instants: [
        {
          utc: "2026-11-02T14:00:00.000Z",
          local: "2026-11-02T20:00:00.000+06:00",
          offsetMinutes: 360,
        },
      ],
    });
  });

  it("flags a spring-forward gap and shifts forward by the gap", () => {
    expect(resolveLocal("America/New_York", "2026-03-08T02:30")).toEqual({
      status: "skipped",
      instants: [],
      nextValid: {
        utc: "2026-03-08T07:30:00.000Z",
        local: "2026-03-08T03:30:00.000-04:00",
        offsetMinutes: -240,
      },
    });
  });

  it("returns both instants for a fall-back fold, earlier first", () => {
    const result = resolveLocal("America/New_York", "2026-11-01T01:30");
    expect(result.status).toBe("ambiguous");
    expect(result.instants.map((i) => [i.utc, i.offsetMinutes])).toEqual([
      ["2026-11-01T05:30:00.000Z", -240],
      ["2026-11-01T06:30:00.000Z", -300],
    ]);
  });

  it("treats the edges of a gap and fold correctly", () => {
    expect(resolveLocal("America/New_York", "2026-03-08T02:00").status).toBe(
      "skipped",
    );
    expect(resolveLocal("America/New_York", "2026-03-08T03:00").status).toBe(
      "ok",
    );
    expect(resolveLocal("America/New_York", "2026-11-01T01:00").status).toBe(
      "ambiguous",
    );
    expect(resolveLocal("America/New_York", "2026-11-01T02:00").status).toBe(
      "ok",
    );
  });

  it("handles the 30-minute Lord Howe gap", () => {
    const result = resolveLocal("Australia/Lord_Howe", "2026-10-04T02:15");
    expect(result.status).toBe("skipped");
    if (result.status === "skipped")
      expect(result.nextValid.local).toBe("2026-10-04T02:45:00.000+11:00");
  });

  it("rejects offsets, invalid dates and unknown zones", () => {
    expect(() => resolveLocal("UTC", "2026-03-08T02:30Z")).toThrow(
      ScheduleInputError,
    );
    expect(() => resolveLocal("UTC", "2026-02-30T10:00")).toThrow(
      ScheduleInputError,
    );
    expect(() => resolveLocal("Mars/Olympus", "2026-03-08T02:30")).toThrow(
      /Unknown IANA/,
    );
  });
});
