import { describe, expect, it } from "vitest";
import {
  fairRotation,
  findSlots,
  parseScheduleInput,
  ramadanDates,
  type ZoneRule,
} from "../src/index.js";

describe("special hours", () => {
  const dhaka: ZoneRule = {
    id: "Asia/Dhaka",
    weekend: [],
    specialHours: [
      {
        label: "Ramadan",
        from: "2027-02-09",
        to: "2027-03-09",
        workStart: "09:00",
        workEnd: "15:30",
      },
    ],
  };
  const london: ZoneRule = {
    id: "Europe/London",
    weekend: [],
    quietBefore: "06:00",
    quietAfter: "22:00",
  };
  const classOf = (date: string, utcHour: number) => {
    const slot = findSlots({
      zones: [dhaka, london],
      startDate: date,
      days: 1,
      stepMinutes: 60,
    }).slots.find(
      (candidate) =>
        candidate.start.slice(11, 13) === String(utcHour).padStart(2, "0"),
    );
    return slot?.zones[0]!.classification;
  };

  it("uses the special work hours only inside the date range", () => {
    expect(classOf("2027-02-08", 10)).toBe("ideal");
    expect(classOf("2027-02-10", 10)).toBe("acceptable");
    expect(classOf("2027-03-10", 10)).toBe("ideal");
    expect(classOf("2027-02-10", 9)).toBe("ideal");
  });

  it("explains acceptable slots with the special hours", () => {
    const slot = findSlots({
      zones: [dhaka, london],
      startDate: "2027-02-10",
      days: 1,
      stepMinutes: 60,
    }).slots.find((candidate) => candidate.start.includes("T10:00"))!;
    expect(slot.reason).toContain("after work (acceptable) for Dhaka");
  });

  it("validates periods", () => {
    const bad = (period: object) => () =>
      findSlots({
        zones: [{ id: "UTC", specialHours: [period as never] }],
        startDate: "2027-02-10",
      });
    expect(
      bad({
        from: "2027-03-01",
        to: "2027-02-01",
        workStart: "09:00",
        workEnd: "15:00",
      }),
    ).toThrow(/to must be on or after from/);
    expect(
      bad({
        from: "2027-02-01",
        to: "2027-03-01",
        workStart: "07:00",
        workEnd: "15:00",
      }),
    ).toThrow(/specialHours.0.workStart: Work hours must fit/);
    expect(
      bad({
        from: "2027-02-01",
        to: "2027-03-01",
        workStart: "07:00",
        workEnd: "15:00",
        quietBefore: "06:00",
      }),
    ).not.toThrow();
  });
});

describe("Ramadan", () => {
  it("matches the announced start dates, a day later in Bangladesh", () => {
    expect(ramadanDates(2024)).toEqual({
      from: "2024-03-11",
      to: "2024-04-09",
    });
    expect(ramadanDates(2025, "BD")).toEqual({
      from: "2025-03-02",
      to: "2025-03-30",
    });
    expect(ramadanDates(2027, "BD")).toEqual({
      from: "2027-02-09",
      to: "2027-03-09",
    });
  });

  it("parses --ramadan and --special-hours", () => {
    const input = parseScheduleInput({
      zones: "Asia/Dhaka,Europe/London",
      date: "2026-11-02",
      ramadan: ["Asia/Dhaka=09:00-15:30"],
      specialHours: ["Europe/London=2026-12-21..2026-12-31@10:00-16:00"],
    });
    expect(input.zones[0]!.specialHours).toEqual([
      {
        label: "Ramadan",
        from: "2026-02-19",
        to: "2026-03-20",
        workStart: "09:00",
        workEnd: "15:30",
      },
      {
        label: "Ramadan",
        from: "2027-02-09",
        to: "2027-03-09",
        workStart: "09:00",
        workEnd: "15:30",
      },
    ]);
    expect(input.zones[1]!.specialHours).toEqual([
      {
        from: "2026-12-21",
        to: "2026-12-31",
        workStart: "10:00",
        workEnd: "16:00",
      },
    ]);
    expect(() =>
      parseScheduleInput({
        zones: "UTC",
        date: "2026-11-02",
        specialHours: ["UTC=2026-12-21@10:00-16:00"],
      }),
    ).toThrow(/--special-hours must use/);
    expect(() =>
      parseScheduleInput({
        zones: "UTC",
        date: "2026-11-02",
        ramadan: ["UTC=9-3"],
      }),
    ).toThrow(/--ramadan must use HH:mm-HH:mm/);
  });
});

describe("fairRotation", () => {
  const zones: ZoneRule[] = [
    {
      id: "UTC",
      weekend: [],
      workStart: "09:00",
      workEnd: "17:00",
      quietBefore: "07:00",
      quietAfter: "21:00",
    },
    {
      id: "Asia/Tokyo",
      weekend: [],
      workStart: "09:00",
      workEnd: "17:00",
      quietBefore: "07:00",
      quietAfter: "23:00",
    },
  ];
  const result = findSlots({
    zones,
    startDate: "2026-11-02",
    days: 1,
    stepMinutes: 60,
  });

  it("alternates times so each zone takes the inconvenient slot in turn", () => {
    const rotation = fairRotation(result)!;
    expect(rotation.size).toBe(2);
    expect(rotation.zones.map((zone) => zone.inconvenientTurns)).toEqual([
      1, 1,
    ]);
    expect(rotation.picks.map((pick) => pick.inconvenient)).toEqual(
      expect.arrayContaining([["UTC"], ["Tokyo"]]),
    );
    expect(rotation.picks[0]!.slot).toBe(result.slots[0]);
    expect(rotation.message).toBe(
      "Alternate 07:00, 09:00 UTC week by week. Inconvenient weeks: UTC 1 of 2, Tokyo 1 of 2, instead of UTC every week.",
    );
  });

  it("spreads three turns as evenly as possible", () => {
    const rotation = fairRotation(result, { size: 3 })!;
    expect(rotation.size).toBe(3);
    expect(
      Math.max(...rotation.zones.map((zone) => zone.inconvenientTurns)),
    ).toBe(2);
    expect(
      rotation.zones.reduce((sum, zone) => sum + zone.inconvenientTurns, 0),
    ).toBe(3);
  });

  it("doesn't rotate when one time suits everyone, or when rotating can't help", () => {
    const easy = findSlots({
      zones: [{ id: "Europe/London" }, { id: "Europe/Paris" }],
      startDate: "2026-11-02",
      days: 1,
    });
    expect(fairRotation(easy)).toMatchObject({
      size: 1,
      message: expect.stringContaining("inside work hours for everyone"),
    });
    const stuck = findSlots({
      zones: [
        { id: "Asia/Dhaka", weekend: [] },
        { id: "America/New_York", weekend: [] },
      ],
      startDate: "2026-11-02",
      days: 1,
    });
    expect(fairRotation(stuck)).toMatchObject({
      size: 1,
      message: expect.stringContaining("Rotating doesn't spread the load"),
    });
    expect(fairRotation({ ...result, slots: [] })).toBeNull();
  });
});
