import { describe, expect, it } from "vitest";
import {
  looksLikeNaturalCron,
  parseNaturalCron,
  type CronDialect,
} from "../src/index.js";

const cron = (text: string, dialect?: CronDialect) =>
  parseNaturalCron(text, dialect ? { dialect } : {});

describe("parseNaturalCron", () => {
  it.each([
    ["every weekday at 9am Dhaka", ["0 9 * * 1-5"], "Asia/Dhaka"],
    ["every weekday at 9am in Asia/Dhaka", ["0 9 * * 1-5"], "Asia/Dhaka"],
    ["daily at 2:30am New York", ["30 2 * * *"], "America/New_York"],
    [
      "mondays and fridays at noon London time",
      ["0 12 * * 1,5"],
      "Europe/London",
    ],
    ["every day at 6pm in Delhi", ["0 18 * * *"], "Asia/Kolkata"],
    [
      "every 15 minutes between 9am and 5pm on weekdays",
      ["*/15 9-17 * * 1-5"],
      undefined,
    ],
    ["every hour", ["0 * * * *"], undefined],
    ["hourly at :15", ["15 * * * *"], undefined],
    ["every 2 hours", ["0 */2 * * *"], undefined],
    ["every minute", ["* * * * *"], undefined],
    ["at 9am and 5pm", ["0 9,17 * * *"], undefined],
    ["at 9am and 5:30pm", ["0 9 * * *", "30 17 * * *"], undefined],
    ["monday to friday at 18:00", ["0 18 * * 1-5"], undefined],
    ["every weekend at 10", ["0 10 * * 0,6"], undefined],
    ["on the 1st and 15th at midnight", ["0 0 1,15 * *"], undefined],
    ["every january on the 1st at 9am", ["0 9 1 1 *"], undefined],
    ["monthly", ["0 0 1 * *"], undefined],
    ["weekly", ["0 0 * * 0"], undefined],
    ["every 3 days at 6am", ["0 6 */3 * *"], undefined],
  ])("%s", (text, expressions, zone) => {
    const result = cron(text);
    expect(result.problems).toEqual([]);
    expect(result.expressions).toEqual(expressions);
    expect(result.zone).toBe(zone);
  });

  it("writes Spring and Quartz syntax, including last day and nth weekday", () => {
    expect(cron("every weekday at 9am Dhaka", "quartz").expressions).toEqual([
      "0 0 9 ? * MON-FRI",
    ]);
    expect(
      cron("first monday of the month at 10am", "spring").expressions,
    ).toEqual(["0 0 10 * * MON#1"]);
    expect(
      cron("last day of the month at 23:00", "quartz").expressions,
    ).toEqual(["0 0 23 L * ?"]);
    expect(cron("on the 1st and mondays at 9am", "quartz").expressions).toEqual(
      ["0 0 9 1 * ?", "0 0 9 ? * MON"],
    );
  });

  it("describes the result and gives the scheduler's time-zone setting", () => {
    const result = cron("every weekday at 9am Dhaka", "kubernetes");
    expect(result.description).toBe(
      "At 09:00, Monday through Friday (Asia/Dhaka)",
    );
    expect(result.native).toBe(
      'spec:\n  timeZone: "Asia/Dhaka"\n  schedule: "0 9 * * 1-5"',
    );
  });

  it("explains defaults it chose", () => {
    expect(cron("weekly").notes).toEqual([
      "No time given, so it runs at midnight (00:00).",
      "Weekly runs on Sunday, like @weekly.",
    ]);
    expect(cron("every 3 days at 6am").notes).toContain(
      '"Every 3 days" restarts each month (cron counts days of the month).',
    );
  });

  it("reports what it can't do instead of guessing", () => {
    const problems = (text: string) => cron(text).problems.join(" ");
    expect(problems("every other monday at 9am")).toContain(
      'Cron can\'t do "every other monday"',
    );
    expect(problems("twice a fortnight")).toContain(
      'Didn\'t understand: "twice", "fortnight"',
    );
    expect(problems("at 25:00")).toContain('Couldn\'t read the time "25:00"');
    expect(problems("last day of the month at 23:00")).toBe(
      "The last day of the month needs Spring or Quartz syntax; Unix cron can't express it.",
    );
    expect(problems("at 9am between 9am and 5pm")).toContain(
      "A time window only makes sense with a step",
    );
    expect(problems("on the 40th at 9am")).toContain(
      "There's no day 40 in a month.",
    );
    expect(cron("every other monday at 9am").expressions).toEqual([]);
  });
});

describe("looksLikeNaturalCron", () => {
  it.each([
    ["every weekday at 9am", true],
    ["daily", true],
    ["0 9 * * 1-5", false],
    ["@daily", false],
    ["0 0 9 ? * MON-FRI", false],
    ["", false],
  ])("%s → %s", (text, expected) => {
    expect(looksLikeNaturalCron(text)).toBe(expected);
  });
});
