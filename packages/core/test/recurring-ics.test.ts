import { describe, expect, it } from "vitest";
import {
  parseIcsBusy,
  recurringCalendarText,
  recurringImpact,
} from "../src/index.js";

const impact = recurringImpact({
  zones: [
    { id: "Europe/London" },
    { id: "America/New_York" },
    { id: "Asia/Dhaka" },
  ],
  startDate: "2026-10-12",
  time: "14:00",
  weeks: 30,
});
const ics = recurringCalendarText(impact, {
  created: "2026-10-23T00:00:00Z",
  title: "Team sync",
});
const lines = ics.split("\r\n");

describe("recurringCalendarText", () => {
  it("writes one weekly event fixed in the first zone", () => {
    expect(lines).toEqual(
      expect.arrayContaining([
        "DTSTART;TZID=Europe/London:20261012T140000",
        "DTEND;TZID=Europe/London:20261012T143000",
        "RRULE:FREQ=WEEKLY;COUNT=30",
        "SUMMARY:Team sync",
        "DTSTAMP:20261023T000000Z",
      ]),
    );
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(
      lines.every((line) => new TextEncoder().encode(line).length <= 75),
    ).toBe(true);
  });

  it("includes a VTIMEZONE with every clock change in the series", () => {
    const block = ics.slice(
      ics.indexOf("BEGIN:VTIMEZONE"),
      ics.indexOf("END:VTIMEZONE"),
    );
    expect(block).toContain("TZID:Europe/London");
    expect(block).toContain(
      "BEGIN:STANDARD\r\nDTSTART:20261025T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0000",
    );
    expect(block).toContain(
      "BEGIN:DAYLIGHT\r\nDTSTART:20270328T010000\r\nTZOFFSETFROM:+0000\r\nTZOFFSETTO:+0100",
    );
  });

  it("describes the series and the zones that move", () => {
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(
      String.raw`DESCRIPTION:Every Monday at 14:00 Europe/London (30 min)\, 30 weeks from 2026-10-12.\nFirst week: 14:00 London / 09:00 New York / 19:00 Dhaka.`,
    );
    expect(unfolded).toContain(
      "Week of 2026-10-26: New York at 10:00 instead of 09:00",
    );
  });

  it("reads back as exactly the meeting's occurrences, across DST", () => {
    const busy = parseIcsBusy(ics, {
      from: "2026-10-01T00:00:00Z",
      to: "2027-06-01T00:00:00Z",
      defaultZone: "UTC",
    });
    expect(busy.warnings).toEqual([]);
    expect(busy.busy.map((interval) => interval.start)).toEqual(
      impact.occurrences.map((occurrence) => occurrence.start),
    );
  });

  it("uses a single STANDARD observance for zones without DST, and a stable UID", () => {
    const dhaka = recurringCalendarText(
      recurringImpact({
        zones: [{ id: "Asia/Dhaka" }, { id: "UTC" }],
        startDate: "2026-11-02",
        time: "10:00",
        weeks: 4,
      }),
      { created: "2026-10-23T00:00:00Z" },
    );
    expect(dhaka.match(/BEGIN:STANDARD/g)).toHaveLength(1);
    expect(dhaka).not.toContain("BEGIN:DAYLIGHT");
    expect(dhaka).toContain("SUMMARY:Team meeting");
    expect(
      recurringCalendarText(impact, { created: "2027-01-01T00:00:00Z" }).match(
        /UID:.*/,
      )![0],
    ).toBe(ics.match(/UID:.*/)![0]);
  });
});
