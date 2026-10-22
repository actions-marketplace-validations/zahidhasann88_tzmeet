import { describe, expect, it } from "vitest";
import {
  findSlots,
  parseScheduleInput,
  presetHolidays,
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
        .map((holiday) => holiday.date),
    ).toEqual([
      "2026-02-21",
      "2026-03-26",
      "2026-04-14",
      "2026-05-01",
      "2026-12-16",
      "2026-12-25",
    ]);
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
        "Asia/Tokyo",
      ].map(suggestHolidayPreset),
    ).toEqual(["BD", "GB-ENG", "US", "US", "US", undefined]);
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
    ).toThrow(/use BD, GB-ENG, US or none/);
  });
});
