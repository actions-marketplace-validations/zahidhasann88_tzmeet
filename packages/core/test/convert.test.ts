import { describe, expect, it } from "vitest";
import {
  convertCronDialect,
  convertCronZone,
  ScheduleInputError,
  type CronDialect,
} from "../src/index.js";

const convert = (expression: string, from: CronDialect, to: CronDialect) =>
  convertCronDialect(expression, { from, to });

describe("convertCronDialect", () => {
  it.each([
    ["0 9 * * 1-5", "unix", "quartz", "0 0 9 ? * MON-FRI"],
    ["0 9 * * 1-5", "unix", "spring", "0 0 9 * * MON-FRI"],
    ["0 9 * * 1-5", "unix", "kubernetes", "0 9 * * 1-5"],
    ["0 0 9 ? * MON-FRI", "quartz", "unix", "0 9 * * 1-5"],
    ["0 0 9 ? * 2-6", "quartz", "kubernetes", "0 9 * * 1-5"],
    ["0 0 12 15 * ?", "quartz", "unix", "0 12 15 * *"],
    ["*/15 9-17 * * 0,6", "unix", "quartz", "0 */15 9-17 ? * SUN,SAT"],
    ["@daily", "unix", "quartz", "0 0 0 * * ?"],
    ["0 0 22-2 ? * *", "quartz", "unix", "0 0-2,22,23 * * *"],
    ["0 0 12 ? * 6L", "quartz", "spring", "0 0 12 * * FRIL"],
    ["0 0 12 ? * MON#2", "quartz", "spring", "0 0 12 * * MON#2"],
    ["0 15 10 L-2 * ?", "quartz", "spring", "0 15 10 L-2 * *"],
    ["0 30 2 * * *", "spring", "quartz", "0 30 2 * * ?"],
  ] as const)("%s (%s → %s)", (expression, from, to, expected) => {
    const result = convert(expression, from, to);
    expect(result.problems).toEqual([]);
    expect(result.expressions).toEqual([expected]);
  });

  it("splits Unix's either-day schedules into two for Quartz and Spring", () => {
    expect(convert("0 0 13 * 5", "unix", "quartz")).toMatchObject({
      expressions: ["0 0 0 13 * ?", "0 0 0 ? * FRI"],
      problems: [],
      notes: expect.arrayContaining([
        'Quartz can\'t say "day 13 or FRI" in one expression, so this needs two schedules.',
      ]),
    });
    expect(convert("0 0 13 * 5", "unix", "spring").expressions).toEqual([
      "0 0 0 13 * *",
      "0 0 0 * * FRI",
    ]);
    expect(convert("0 0 13 * 5", "unix", "kubernetes").expressions).toEqual([
      "0 0 13 * 5",
    ]);
  });

  it("reports what the target can't express instead of guessing", () => {
    const problem = (
      expression: string,
      from: CronDialect,
      to: CronDialect,
    ) => {
      const result = convert(expression, from, to);
      expect(result.expressions).toEqual([]);
      return result.problems.join(" ");
    };
    expect(problem("30 0 12 * * *", "spring", "unix")).toContain(
      "no seconds field",
    );
    expect(problem("0 15 10 L * ?", "quartz", "kubernetes")).toContain(
      "doesn't support L or W",
    );
    expect(problem("0 0 12 ? * 6#3", "quartz", "unix")).toContain(
      "doesn't support L or #",
    );
    expect(problem("0 0 12 ? * * 2027", "quartz", "spring")).toContain(
      "no year field",
    );
    expect(problem("0 0 0 13 * FRI", "spring", "unix")).toContain(
      "can't require both",
    );
    expect(problem("0 0 0 13 * FRI", "spring", "quartz")).toContain(
      "Quartz allows only one of them",
    );
  });

  it("keeps Unix AND semantics when day-of-month starts with *", () => {
    expect(convert("0 0 0 */2 * FRI", "spring", "unix").expressions).toEqual([
      "0 0 */2 * 5",
    ]);
  });

  it("explains numbering, seconds and inline time zones", () => {
    expect(convert("0 0 9 ? * 2-6", "quartz", "unix").notes).toContain(
      "Day-of-week numbers are converted: Quartz counts Sunday as 1, the others count Monday as 1.",
    );
    expect(convert("0 9 * * *", "unix", "spring").notes).toContain(
      "Spring adds a seconds field; runs happen at second 0.",
    );
    expect(
      convert("CRON_TZ=Asia/Dhaka 0 9 * * *", "kubernetes", "spring").notes,
    ).toContain(
      "Set the time zone (Asia/Dhaka) in the scheduler; it isn't part of the expression.",
    );
  });

  it("rejects invalid expressions", () => {
    expect(() => convert("0 99 * * *", "unix", "quartz")).toThrow(
      ScheduleInputError,
    );
  });
});

describe("convertCronZone", () => {
  const from = "2026-10-22T00:00:00Z";
  const zone = (
    expression: string,
    dialect: CronDialect,
    fromZone: string,
    toZone: string,
  ) => convertCronZone({ expression, dialect, fromZone, toZone, from });

  it("shifts schedules when the offset never changes, rolling days across midnight", () => {
    expect(zone("0 9 * * 1-5", "unix", "Asia/Dhaka", "UTC")).toMatchObject({
      constant: true,
      periods: [
        { offsetMinutes: -360, expressions: ["0 3 * * 1-5"], problems: [] },
      ],
    });
    expect(
      zone("0 3 * * 1-5", "unix", "Asia/Dhaka", "UTC").periods[0]!.expressions,
    ).toEqual(["0 21 * * 0-4"]);
    expect(
      zone("0 0 3 ? * MON-FRI", "quartz", "Asia/Dhaka", "UTC").periods[0]!
        .expressions,
    ).toEqual(["0 0 21 ? * SUN-THU"]);
    expect(zone("0 9 * * 1-5", "unix", "Asia/Dhaka", "UTC").message).toBe(
      "UTC is always 6 hours behind Asia/Dhaka, so one expression works all year.",
    );
  });

  it("splits half-hour offsets into blocks", () => {
    expect(
      zone("*/15 9-17 * * *", "unix", "Asia/Kolkata", "UTC").periods[0]!
        .expressions,
    ).toEqual(["30,45 3 * * *", "*/15 4-11 * * *", "0,15 12 * * *"]);
  });

  it("merges rolled-over runs when the schedule runs every day", () => {
    expect(
      zone("0 3,9 * * *", "unix", "Asia/Dhaka", "UTC").periods[0]!.expressions,
    ).toEqual(["0 3,21 * * *"]);
  });

  it("gives one expression per DST period and recommends the native time-zone setting", () => {
    const result = zone("0 9 * * *", "kubernetes", "America/New_York", "UTC");
    expect(result.constant).toBe(false);
    expect(
      result.periods.map((period) => [
        period.from,
        period.offsetMinutes,
        period.expressions,
      ]),
    ).toEqual([
      ["2026-10-21", 240, ["0 13 * * *"]],
      ["2026-11-01", 300, ["0 14 * * *"]],
      ["2027-03-14", 240, ["0 13 * * *"]],
    ]);
    expect(result.native).toBe(
      'spec:\n  timeZone: "America/New_York"\n  schedule: "0 9 * * *"',
    );
    expect(result.message).toBe(
      "UTC is 4 or 5 hours ahead of America/New_York, depending on daylight saving, so no single expression matches all year. Keep the original schedule and set the scheduler's time zone, or switch expressions on the dates shown.",
    );
  });

  it("gives native settings for every dialect", () => {
    expect(zone("0 9 * * *", "unix", "Asia/Dhaka", "UTC").native).toBe(
      "CRON_TZ=Asia/Dhaka\n0 9 * * *",
    );
    expect(zone("0 0 9 * * *", "spring", "Asia/Dhaka", "UTC").native).toBe(
      '@Scheduled(cron = "0 0 9 * * *", zone = "Asia/Dhaka")',
    );
    expect(zone("0 0 9 * * ?", "quartz", "Asia/Dhaka", "UTC").native).toContain(
      'inTimeZone(TimeZone.getTimeZone("Asia/Dhaka"))',
    );
  });

  it("refuses shifts that day-of-month can't follow", () => {
    const result = zone("0 2 1 * *", "unix", "Asia/Dhaka", "UTC");
    expect(result.periods[0]).toMatchObject({
      expressions: [],
      problems: [
        "Runs move to the previous day, which day-of-month (1) can't follow.",
      ],
    });
    expect(result.message).toContain("can't be shifted exactly");
  });

  it("validates zones and the start instant", () => {
    expect(() => zone("0 9 * * *", "unix", "Mars/Base", "UTC")).toThrow(
      /Unknown IANA/,
    );
    expect(() =>
      convertCronZone({
        expression: "0 9 * * *",
        fromZone: "UTC",
        toZone: "UTC",
        from: "2026-10-22",
      }),
    ).toThrow(/ISO instant/);
  });
});
