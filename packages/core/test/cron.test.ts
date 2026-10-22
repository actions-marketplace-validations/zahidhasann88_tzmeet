import { describe, expect, it } from "vitest";
import {
  detectDialect,
  explainCron,
  parseCron,
  ScheduleInputError,
  type CronExplainInput,
} from "../src/index.js";

const NY = "America/New_York";
const explain = (input: Partial<CronExplainInput> & { expression: string }) =>
  explainCron({ from: "2026-10-22T00:00:00Z", count: 5, ...input });
const locals = (input: Partial<CronExplainInput> & { expression: string }) =>
  explain(input).runs.map((run) => run.local);
const codes = (input: Partial<CronExplainInput> & { expression: string }) =>
  explain(input).warnings.map((warning) => warning.code);
const errorOf = (
  expression: string,
  dialect?: Parameters<typeof parseCron>[1],
) => {
  const result = parseCron(expression, dialect);
  if (result.ok) throw new Error(`expected ${expression} to fail`);
  return result.errors[0]!.message;
};

describe("detectDialect", () => {
  it.each([
    ["30 2 * * *", "unix"],
    ["@daily", "unix"],
    ["0 30 2 * * *", "spring"],
    ["0 30 2 ? * MON", "quartz"],
    ["0 30 2 ? * MON 2027", "quartz"],
    ["CRON_TZ=Asia/Dhaka 0 9 * * *", "kubernetes"],
  ])("%s → %s", (expression, dialect) => {
    expect(detectDialect(expression)).toBe(dialect);
  });
});

describe("parseCron validation", () => {
  it.each([
    ["0 30 2 * * *", "unix", /expects 5 fields/],
    ["30 2 * *", "spring", /expects 6 fields/],
    ["61 * * * *", "unix", /minute must be 0–59, got 61/],
    ["0 0 L * *", "unix", /doesn't support L, W or #/],
    ["0 0 ? * 1", "unix", /doesn't support "\?"/],
    ["0 17-9 * * *", "unix", /runs backwards/],
    ["0 0 12 * * MON", "quartz", /needs "\?"/],
    ["0 0 12 ? * ?", "quartz", /only one of/],
    ["0 0 12 ? * 0", "quartz", /day of week must be 1–7/],
    ["@daily", "quartz", /doesn't support @ shortcuts/],
    ["@reboot", "unix", /no schedule/],
    ["@every 5m", "kubernetes", /fixed interval/],
    ["TZ=UTC 0 0 * * *", "unix", /prefix/],
    ["0 0 1,,2 * *", "unix", /empty item/],
    ["*/0 * * * *", "unix", /positive number/],
    ["0 0 0 MON#6 * ?", "quartz", /isn't valid|1–5|not a valid/],
  ] as const)("%s (%s)", (expression, dialect, message) => {
    expect(errorOf(expression, dialect)).toMatch(message);
  });

  it("reports the failing field and token", () => {
    expect(parseCron("0 25 * * *", "unix")).toEqual({
      ok: false,
      dialect: "unix",
      errors: [
        { field: "hour", message: "hour must be 0–23, got 25", token: "25" },
      ],
    });
  });

  it("accepts names, lists, steps and macros", () => {
    for (const expression of [
      "0 9 * JAN-MAR mon-fri",
      "*/15 9-17 1,15 * *",
      "5/10 * * * *",
      "@hourly",
      "@weekly",
    ])
      expect(parseCron(expression, "unix").ok, expression).toBe(true);
  });
});

describe("day-of-month and day-of-week", () => {
  it("Unix cron ORs them when both are restricted", () => {
    expect(locals({ expression: "0 0 13 * 5", zone: "UTC" })).toEqual([
      "2026-10-23T00:00:00.000Z",
      "2026-10-30T00:00:00.000Z",
      "2026-11-06T00:00:00.000Z",
      "2026-11-13T00:00:00.000Z",
      "2026-11-20T00:00:00.000Z",
    ]);
    expect(codes({ expression: "0 0 13 * 5", zone: "UTC" })).toContain(
      "dom-dow-or",
    );
  });

  it("cronie treats a field starting with * as unrestricted, so */2 means AND", () => {
    expect(parseCron("0 0 */2 * 5", "unix")).toMatchObject({
      ok: true,
      cron: { dayMatch: "and" },
    });
  });

  it("robfig/cron (Kubernetes) only treats * or ? without a step as unrestricted", () => {
    expect(parseCron("0 0 */2 * 5", "kubernetes")).toMatchObject({
      ok: true,
      cron: { dayMatch: "or" },
    });
    expect(parseCron("0 0 * * 5", "kubernetes")).toMatchObject({
      ok: true,
      cron: { dayMatch: "and" },
    });
  });

  it("Spring requires both and says so", () => {
    const result = explain({
      expression: "0 0 0 13 * FRI",
      zone: "UTC",
      count: 2,
    });
    expect(result.runs.map((run) => run.local)).toEqual([
      "2026-11-13T00:00:00.000Z",
      "2027-08-13T00:00:00.000Z",
    ]);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "dom-dow-and",
    );
  });
});

describe("special characters", () => {
  const dates = (expression: string, count = 3) =>
    explain({ expression, zone: "UTC", count }).runs.map((run) =>
      run.local.slice(0, 10),
    );

  it("L, L-n and LW", () => {
    expect(dates("0 0 0 L * ?")).toEqual([
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
    ]);
    expect(dates("0 0 0 L-2 * ?")).toEqual([
      "2026-10-29",
      "2026-11-28",
      "2026-12-29",
    ]);
    expect(dates("0 0 0 LW * ?", 4)).toEqual([
      "2026-10-30",
      "2026-11-30",
      "2026-12-31",
      "2027-01-29",
    ]);
  });

  it("nW moves to the nearest weekday without leaving the month", () => {
    expect(dates("0 0 0 15W * ?", 2)).toEqual(["2026-11-16", "2026-12-15"]);
    expect(
      explain({
        expression: "0 0 0 1W 8 ?",
        zone: "UTC",
        from: "2026-01-01T00:00:00Z",
        count: 1,
      }).runs[0]!.local,
    ).toBe("2026-08-03T00:00:00.000Z");
  });

  it("last and nth weekday of the month", () => {
    expect(dates("0 0 0 ? * 6L")).toEqual([
      "2026-10-30",
      "2026-11-27",
      "2026-12-25",
    ]);
    expect(dates("0 0 0 ? * MON#2")).toEqual([
      "2026-11-09",
      "2026-12-14",
      "2027-01-11",
    ]);
    expect(dates("0 0 0 * * FRIL")).toEqual([
      "2026-10-30",
      "2026-11-27",
      "2026-12-25",
    ]);
  });

  it("Quartz numbers days from Sunday = 1 and warns about it", () => {
    const result = explain({
      expression: "0 0 12 ? * 2",
      zone: "UTC",
      count: 1,
    });
    expect(result.runs[0]!.local).toBe("2026-10-26T12:00:00.000Z");
    expect(result.description).toBe("At 12:00, on Monday");
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "quartz-dow-numbering",
    );
  });

  it("Quartz wraps reversed ranges and honours the year field", () => {
    expect(
      locals({ expression: "0 0 22-1 ? * * 2027", zone: "UTC", count: 4 }),
    ).toEqual([
      "2027-01-01T00:00:00.000Z",
      "2027-01-01T01:00:00.000Z",
      "2027-01-01T22:00:00.000Z",
      "2027-01-01T23:00:00.000Z",
    ]);
  });

  it("finds rare dates and reports schedules that never run", () => {
    expect(locals({ expression: "0 0 29 2 *", zone: "UTC", count: 1 })).toEqual(
      ["2028-02-29T00:00:00.000Z"],
    );
    const never = explain({ expression: "0 0 30 2 *", zone: "UTC" });
    expect(never.runs).toEqual([]);
    expect(never.warnings.map((warning) => warning.code)).toContain(
      "never-runs",
    );
  });
});

describe("descriptions", () => {
  it.each([
    ["30 2 * * *", "unix", "At 02:30"],
    ["0 9 * * 1-5", "unix", "At 09:00, Monday through Friday"],
    ["0 9,17 * * *", "unix", "At 09:00 and 17:00"],
    ["*/15 * * * *", "unix", "Every 15 minutes"],
    ["5/10 * * * *", "unix", "Every 10 minutes starting at 5"],
    ["0 */2 * * *", "unix", "At minute 0, every 2 hours"],
    ["0 0 13 * 5", "unix", "At 00:00, on day 13 of the month, or on Friday"],
    [
      "0 0 1 1,7 *",
      "unix",
      "At 00:00, on day 1 of the month, in January and July",
    ],
    [
      "0 0/15 9-17 * * MON-FRI",
      "spring",
      "Every 15 minutes, from 09:00 through 17:59, Monday through Friday",
    ],
    [
      "30 0 12 ? * MON#2",
      "quartz",
      "At 12:00:30, on the second Monday of the month",
    ],
    ["0 15 10 L * ?", "quartz", "At 10:15, on the last day of the month"],
    ["@daily", "spring", "At 00:00"],
  ] as const)("%s (%s)", (expression, dialect, text) => {
    expect(explain({ expression, dialect, zone: "UTC" }).description).toBe(
      text,
    );
  });
});

describe("DST: spring-forward gap (New York, 14 Mar 2027, 02:00 → 03:00)", () => {
  const from = "2027-03-13T12:00:00Z";

  it("Unix cron runs a fixed-time job right after the change", () => {
    const result = explain({
      expression: "30 2 * * *",
      zone: NY,
      from,
      count: 2,
    });
    expect(
      result.runs.map((run) => [run.local, run.scheduled, run.note]),
    ).toEqual([
      ["2027-03-14T03:00:00.000-04:00", "2027-03-14T02:30:00", "gap-catch-up"],
      ["2027-03-15T02:30:00.000-04:00", "2027-03-15T02:30:00", undefined],
    ]);
    expect(
      result.warnings.find((warning) => warning.code === "dst-late")?.message,
    ).toBe(
      "On 2027-03-14 in America/New_York, clocks jump from 02:00 to 03:00. Unix cron runs the 02:30 job right after the change, at 03:00.",
    );
  });

  it("Unix cron skips the missing minutes of a wildcard job", () => {
    const result = explain({
      expression: "*/30 2 * * *",
      zone: NY,
      from,
      count: 1,
    });
    expect(result.runs[0]!.local).toBe("2027-03-15T02:00:00.000-04:00");
    expect(result.skipped).toEqual([
      { scheduled: "2027-03-14T02:00:00", reason: "gap" },
      { scheduled: "2027-03-14T02:30:00", reason: "gap" },
    ]);
    expect(
      result.warnings.find((warning) => warning.code === "dst-skip")?.message,
    ).toContain("runs from 02:00 to 02:30 don't happen");
  });

  it.each([
    ["30 2 * * *", "kubernetes"],
    ["0 30 2 * * *", "spring"],
    ["0 30 2 * * ?", "quartz"],
  ] as const)("%s (%s) skips the run that day", (expression, dialect) => {
    const result = explain({ expression, dialect, zone: NY, from, count: 1 });
    expect(result.runs[0]!.local).toBe("2027-03-15T02:30:00.000-04:00");
    expect(result.skipped).toEqual([
      { scheduled: "2027-03-14T02:30:00", reason: "gap" },
    ]);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "dst-skip",
    );
  });

  it("robfig/cron hourly jobs go 01:00 → 03:00", () => {
    expect(
      locals({
        expression: "0 * * * *",
        dialect: "kubernetes",
        zone: NY,
        from: "2027-03-14T05:30:00Z",
        count: 2,
      }),
    ).toEqual([
      "2027-03-14T01:00:00.000-05:00",
      "2027-03-14T03:00:00.000-04:00",
    ]);
  });
});

describe("DST: fall-back fold (New York, 1 Nov 2026, 02:00 → 01:00)", () => {
  const from = "2026-10-31T12:00:00Z";
  const runs = (
    expression: string,
    dialect: CronExplainInput["dialect"],
    count = 3,
  ) =>
    explain({ expression, dialect, zone: NY, from, count }).runs.map((run) => [
      run.utc,
      run.note,
    ]);

  it("Kubernetes runs a 01:30 job twice", () => {
    expect(runs("30 1 * * *", "kubernetes")).toEqual([
      ["2026-11-01T05:30:00.000Z", "fold-first"],
      ["2026-11-01T06:30:00.000Z", "fold-second"],
      ["2026-11-02T06:30:00.000Z", undefined],
    ]);
    expect(
      codes({
        expression: "30 1 * * *",
        dialect: "kubernetes",
        zone: NY,
        from,
      }),
    ).toContain("dst-double");
  });

  it("Unix cron runs a fixed-time job once", () => {
    expect(runs("30 1 * * *", "unix", 2)).toEqual([
      ["2026-11-01T05:30:00.000Z", "fold-once"],
      ["2026-11-02T06:30:00.000Z", undefined],
    ]);
    expect(
      codes({ expression: "30 1 * * *", dialect: "unix", zone: NY, from }),
    ).toContain("dst-once");
  });

  it("Unix cron repeats wildcard jobs in time order", () => {
    expect(runs("*/30 1 * * *", "unix", 4).map(([utc]) => utc)).toEqual([
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:00:00.000Z",
      "2026-11-01T06:30:00.000Z",
    ]);
  });

  it("Quartz fires once; Spring may fire twice", () => {
    expect(runs("0 30 1 * * ?", "quartz", 1)).toEqual([
      ["2026-11-01T05:30:00.000Z", "fold-once"],
    ]);
    expect(runs("0 30 1 * * *", "spring", 1)).toEqual([
      ["2026-11-01T05:30:00.000Z", "fold-maybe-twice"],
    ]);
    expect(
      codes({ expression: "0 30 1 * * *", dialect: "spring", zone: NY, from }),
    ).toContain("dst-maybe-double");
  });

  it("finds a second occurrence after `from` even when `from` is inside the fold", () => {
    expect(runs("30 1 * * *", "kubernetes", 1)).toEqual([
      ["2026-11-01T05:30:00.000Z", "fold-first"],
    ]);
    expect(
      explain({
        expression: "30 1 * * *",
        dialect: "kubernetes",
        zone: NY,
        from: "2026-11-01T05:45:00Z",
        count: 1,
      }).runs[0]!.utc,
    ).toBe("2026-11-01T06:30:00.000Z");
  });
});

describe("zones and warnings", () => {
  it("warns about DST months ahead, beyond the listed runs", () => {
    const result = explain({
      expression: "30 2 * * *",
      dialect: "kubernetes",
      zone: NY,
      count: 1,
    });
    expect(result.runs).toHaveLength(1);
    expect(
      result.warnings.find((warning) => warning.code === "dst-skip")?.at,
    ).toBe("2027-03-14T07:00:00.000Z");
  });

  it("raises no DST warnings in Dhaka", () => {
    expect(
      codes({ expression: "30 2 * * *", zone: "Asia/Dhaka" }).filter((code) =>
        code.startsWith("dst-"),
      ),
    ).toEqual([]);
  });

  it("shows each run in the display zones", () => {
    const [run] = explain({
      expression: "0 9 * * *",
      zone: "Asia/Dhaka",
      count: 1,
      displayZones: ["UTC", NY, "Europe/London"],
    }).runs;
    expect(run!.zones.map((zone) => [zone.zone, zone.local])).toEqual([
      ["UTC", "2026-10-22T03:00:00.000Z"],
      [NY, "2026-10-21T23:00:00.000-04:00"],
      ["Europe/London", "2026-10-22T04:00:00.000+01:00"],
    ]);
  });

  it("warns when a UTC job moves on local clocks", () => {
    const shifts = explain({
      expression: "0 8 * * *",
      zone: "UTC",
      displayZones: [NY, "Asia/Dhaka"],
    }).warnings.filter((warning) => warning.code === "zone-shift");
    expect(shifts.map((warning) => warning.message)).toEqual([
      "From 2026-11-01, runs happen 1 hour earlier on America/New_York clocks.",
      "From 2027-03-14, runs happen 1 hour later on America/New_York clocks.",
    ]);
  });

  it("skips zone-shift warnings for jobs that run every hour", () => {
    expect(
      codes({ expression: "*/5 * * * *", zone: "UTC", displayZones: [NY] }),
    ).not.toContain("zone-shift");
  });

  it("assumes UTC when no zone is given and says why", () => {
    const result = explain({ expression: "0 0 * * *", dialect: "kubernetes" });
    expect(result.zone).toBe("UTC");
    expect(result.warnings[0]).toMatchObject({
      code: "zone-assumed",
      severity: "info",
    });
    expect(result.warnings[0]!.message).toContain("spec.timeZone");
  });

  it("uses a Kubernetes CRON_TZ prefix but warns that it's unsupported", () => {
    const result = explain({
      expression: "CRON_TZ=Asia/Dhaka 0 9 * * *",
      count: 1,
    });
    expect(result.zone).toBe("Asia/Dhaka");
    expect(result.runs[0]!.local).toBe("2026-10-22T09:00:00.000+06:00");
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "k8s-inline-timezone",
    );
  });

  it("lists runs strictly after `from`", () => {
    expect(
      locals({
        expression: "0 0 * * *",
        zone: "UTC",
        from: "2026-10-22T00:00:00Z",
        count: 1,
      }),
    ).toEqual(["2026-10-23T00:00:00.000Z"]);
  });
});

describe("explainCron input validation", () => {
  it.each([
    [{ expression: "0 0 * * *", zone: "Mars/Base" }, "zone"],
    [{ expression: "0 0 * * *", from: "2026-10-22T00:00" }, "from"],
    [{ expression: "0 0 * * *", count: 0 }, "count"],
    [{ expression: "0 0 * * *", displayZones: ["UTC", "UTC"] }, "displayZones"],
    [{ expression: "0 0 * *" }, "expression"],
    [{ expression: "0 99 * * *" }, "expression.hour"],
    [{ expression: "CRON_TZ=Mars/Base 0 0 * * *" }, "expression"],
  ])("%j → %s", (input, path) => {
    try {
      explain(input as CronExplainInput);
      throw new Error("expected an error");
    } catch (error) {
      expect(error).toBeInstanceOf(ScheduleInputError);
      expect((error as ScheduleInputError).issues[0]!.path).toBe(path);
    }
  });
});
