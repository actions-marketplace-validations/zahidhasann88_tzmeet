import { describe, expect, it } from "vitest";
import {
  convertCronDialect,
  convertCronZone,
  detectDialect,
  explainCron,
  parseCron,
  parseNaturalCron,
  type CronDialect,
} from "../src/index.js";

const from = "2026-10-23T00:00:00Z";
const explain = (
  expression: string,
  dialect?: CronDialect,
  zone?: string,
  count = 3,
) =>
  explainCron({
    expression,
    ...(dialect ? { dialect } : {}),
    ...(zone ? { zone } : {}),
    from,
    count,
  });
const codes = (expression: string, dialect?: CronDialect, zone?: string) =>
  explain(expression, dialect, zone).warnings.map((warning) => warning.code);
const error = (expression: string, dialect: CronDialect) => {
  const result = parseCron(expression, dialect);
  if (result.ok) throw new Error(`expected ${expression} to fail`);
  return result.errors[0]!.message;
};

describe("detecting the new syntaxes", () => {
  it.each([
    ["cron(0 9 ? * MON-FRI *)", "eventbridge"],
    ["H 2 * * *", "jenkins"],
    ["TZ=Europe/London H/15 * * * *", "jenkins"],
    ["TZ=Europe/London 0 9 * * *", "kubernetes"],
    ["Mon..Fri *-*-* 09:00:00", "systemd"],
    ["Sat,Sun 10:00", "systemd"],
    ["0 9 * * 1-5", "unix"],
  ])("%s → %s", (expression, dialect) => {
    expect(detectDialect(expression)).toBe(dialect);
  });
});

describe("AWS EventBridge", () => {
  it("reads cron(...) with Quartz-style days and a year field", () => {
    expect(
      explain("cron(0 9 15 * ? 2027)", undefined, "UTC").runs.map((run) =>
        run.local.slice(0, 10),
      ),
    ).toEqual(["2027-01-15", "2027-02-15", "2027-03-15"]);
    expect(
      explain("cron(15 10 ? * 6L *)", undefined, "UTC", 1).description,
    ).toBe("At 10:15, on the last Friday of the month");
    expect(explain("cron(0 9 ? * 2-6 *)", undefined, "UTC").description).toBe(
      "At 09:00, Monday through Friday",
    );
  });

  it("skips runs in the skipped hour and runs once in the repeated hour", () => {
    expect(
      codes("cron(30 2 ? * * *)", undefined, "America/New_York"),
    ).toContain("dst-skip");
    expect(
      codes("cron(30 1 ? * * *)", undefined, "America/New_York"),
    ).toContain("dst-once");
  });

  it("enforces ? and rejects other schedule types", () => {
    expect(error("cron(0 9 * * * *)", "eventbridge")).toContain('needs "?"');
    expect(error("rate(5 minutes)", "eventbridge")).toContain("aren't cron");
    expect(error("cron(0 9 * *)", "eventbridge")).toContain("expects 6 fields");
  });
});

describe("GitHub Actions", () => {
  it("moves runs in the skipped hour to the next valid time, and flags the repeated hour", () => {
    const result = explain("30 2 * * *", "github", "America/New_York");
    expect(
      result.warnings.find((warning) => warning.code === "dst-late")?.message,
    ).toBe(
      "On 2027-03-14 in America/New_York, clocks jump from 02:00 to 03:00. GitHub Actions runs the 02:30 job right after the change, at 03:00.",
    );
    expect(codes("30 1 * * *", "github", "Europe/London")).toContain(
      "dst-maybe-double",
    );
  });

  it("assumes UTC without timezone: and rejects shortcuts", () => {
    expect(explain("0 9 * * *", "github").warnings[0]!.message).toBe(
      "GitHub Actions runs schedules in UTC unless the schedule sets timezone:. Times below assume UTC.",
    );
    expect(error("@daily", "github")).toContain("doesn't support @ shortcuts");
  });
});

describe("Jenkins", () => {
  it("replaces H with the first possible value and says so", () => {
    // London's clocks change on Sundays, so the job must run every day to hit them.
    const result = explain("TZ=Europe/London\nH/15 1 * * *", "jenkins");
    expect(result.zone).toBe("Europe/London");
    expect(result.description).toBe("Every 15 minutes, during the 01:00 hour");
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["jenkins-hash", "dst-double", "dst-skip"]),
    );
    expect(
      explain("@midnight", "jenkins").warnings.find(
        (warning) => warning.code === "jenkins-hash",
      )!.message,
    ).toContain("exact minute and hour aren't known");
  });

  it("requires both day-of-month and day-of-week", () => {
    expect(
      explain("0 0 13 * 5", "jenkins", "UTC", 2).runs.map((run) =>
        run.local.slice(0, 10),
      ),
    ).toEqual(["2026-11-13", "2027-08-13"]);
    expect(error("0 9 ? * *", "jenkins")).toContain('doesn\'t support "?"');
  });
});

describe("systemd timers", () => {
  it("reads weekdays, dates, times, repetition and a trailing zone", () => {
    expect(explain("Mon..Fri *-*-* 09:00:00 Asia/Dhaka")).toMatchObject({
      dialect: "systemd",
      zone: "Asia/Dhaka",
      description: "At 09:00, Monday through Friday",
    });
    expect(explain("*-*-* 09..17:00/15:00", "systemd", "UTC").description).toBe(
      "Every 15 minutes, from 09:00 through 17:59",
    );
    expect(explain("*-*-01 03:00", "systemd", "UTC").runs[0]!.local).toBe(
      "2026-11-01T03:00:00.000Z",
    );
    expect(
      explain("2027-02-01 08:30", "systemd", "UTC", 1).runs[0]!.local,
    ).toBe("2027-02-01T08:30:00.000Z");
  });

  it("expands shorthands", () => {
    expect(explain("weekly", "systemd", "UTC").description).toBe(
      "At 00:00, on Monday",
    );
    expect(explain("quarterly", "systemd", "UTC").description).toBe(
      "At 00:00, on day 1 of the month, in January, April, July and October",
    );
  });

  it("skips runs in the skipped hour and flags the repeated hour", () => {
    expect(codes("*-*-* 01:30:00 Europe/London", "systemd")).toEqual(
      expect.arrayContaining(["dst-skip", "dst-maybe-double"]),
    );
  });

  it("reports what it can't read", () => {
    expect(error("*-02~03 00:00", "systemd")).toContain('"~"');
    expect(error("Mon..Funday 09:00", "systemd")).toContain(
      "Couldn't read the weekday",
    );
    expect(error("@daily", "systemd")).toContain("doesn't support @ shortcuts");
  });
});

describe("converting to and from the new syntaxes", () => {
  it.each([
    ["0 9 * * 1-5", "unix", "eventbridge", ["cron(0 9 ? * MON-FRI *)"]],
    ["0 9 * * 1-5", "unix", "systemd", ["Mon..Fri *-*-* 09:00:00"]],
    ["*/15 9-17 * * *", "unix", "systemd", ["*-*-* 09..17:00/15:00"]],
    [
      "0 9 13 * 5",
      "unix",
      "systemd",
      ["*-*-13 09:00:00", "Fri *-*-* 09:00:00"],
    ],
    [
      "cron(15 10 ? * 6L 2027)",
      "eventbridge",
      "quartz",
      ["0 15 10 ? * FRIL 2027"],
    ],
    ["cron(0 9 ? * 2-6 *)", "eventbridge", "github", ["0 9 * * 1-5"]],
    ["Mon..Fri *-*-* 09:00:00", "systemd", "unix", ["0 9 * * 1-5"]],
    ["H H(0-2) * * *", "jenkins", "unix", ["0 0 * * *"]],
    ["0 30 2 * * *", "spring", "jenkins", ["30 2 * * *"]],
    ["0 9 13 * 5", "unix", "jenkins", ["0 9 13 * *", "0 9 * * 5"]],
  ] as const)("%s (%s → %s)", (expression, from, to, expressions) => {
    expect(convertCronDialect(expression, { from, to }).expressions).toEqual(
      expressions,
    );
  });

  it("gives each engine's own time-zone setting", () => {
    const native = (dialect: CronDialect, expression: string) =>
      convertCronZone({
        expression,
        dialect,
        fromZone: "Asia/Dhaka",
        toZone: "UTC",
        from,
      }).native;
    expect(native("github", "0 9 * * *")).toBe(
      'on:\n  schedule:\n    - cron: "0 9 * * *"\n      timezone: "Asia/Dhaka"',
    );
    expect(native("eventbridge", "cron(0 9 ? * * *)")).toBe(
      'ScheduleExpression: "cron(0 9 ? * * *)"\nScheduleExpressionTimezone: "Asia/Dhaka"',
    );
    expect(native("jenkins", "H 9 * * *")).toBe("TZ=Asia/Dhaka\nH 9 * * *");
    expect(native("systemd", "*-*-* 09:00:00 UTC")).toBe(
      "OnCalendar=*-*-* 09:00:00 Asia/Dhaka",
    );
  });

  it("writes plain English in any of them", () => {
    expect(
      parseNaturalCron("every weekday at 9am Dhaka", { dialect: "eventbridge" })
        .expressions,
    ).toEqual(["cron(0 9 ? * MON-FRI *)"]);
    expect(
      parseNaturalCron("every weekday at 9am Dhaka", { dialect: "systemd" })
        .expressions,
    ).toEqual(["Mon..Fri *-*-* 09:00:00"]);
  });
});
