import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { configSchema, type FindSlotsResult } from "@tzmeet/core";
import { runCLI } from "../src/cli.js";
import { readConfig, resolveOptions, type CliFlags } from "../src/config.js";
import { formatTable, type CliResult } from "../src/output.js";

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "tzmeet-cli-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function invoke(args: string[], directory = cwd) {
  let stdout = "";
  let stderr = "";
  const code = runCLI(args, {
    cwd: directory,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    now: () => new Date("2026-11-01T20:00:00Z"),
  });
  return { code, stdout, stderr };
}
function configFile(config: unknown, filename = "tzmeet.config.json") {
  const path = join(cwd, filename);
  writeFileSync(path, JSON.stringify(config));
  return path;
}
function json(args: string[]) {
  const output = invoke([...args, "--json"]);
  expect(output.code, output.stderr).toBe(0);
  expect(output.stderr).toBe("");
  return JSON.parse(output.stdout) as CliResult;
}

const fixedArgs = [
  "--zones",
  "Asia/Dhaka,America/New_York,Europe/London",
  "--date",
  "2026-11-02",
  "--days",
  "1",
  "--duration",
  "30",
  "--step",
  "30",
  "--weekend",
  "Asia/Dhaka=fri,sat",
  "--top",
  "2",
];

describe("fixed CLI output", () => {
  it("snapshots the table with all local dates/offsets and classification markers", () => {
    const output = invoke(fixedArgs);
    expect(output.code).toBe(0);
    expect(output.stderr).toBe("");
    expect(output.stdout).toMatchSnapshot();
  });

  it("snapshots JSON with the same ranked, top-capped data", () => {
    const result = json(fixedArgs);
    expect(result).toMatchSnapshot();
    expect(result.slots).toHaveLength(2);
    expect(result.totalSlots).toBeGreaterThan(2);
    expect(result.diagnostics.scannedCandidates).toBe(48);
  });

  it("makes table and JSON refer to the same first result", () => {
    const result = json(fixedArgs);
    const table = invoke(fixedArgs).stdout;
    expect(table).toContain(result.slots[0]!.reason);
    expect(table).toContain(result.slots[0]!.date);
  });
});

describe("configuration discovery and precedence", () => {
  it("discovers a validated config in cwd when no flags are supplied", () => {
    configFile({
      zones: [{ id: "UTC", label: "Home", weekend: [] }],
      startDate: "2026-11-02",
      days: 1,
      durationMinutes: 45,
      stepMinutes: 30,
      top: 1,
    });
    const result = json([]);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]!.zones[0]!.label).toBe("Home");
    expect(
      Date.parse(result.slots[0]!.end) - Date.parse(result.slots[0]!.start),
    ).toBe(45 * 60000);
  });

  it("honors an explicit relative or absolute config path instead of auto-discovery", () => {
    configFile({ invalid: "must not load this file" });
    const explicit = configFile(
      { zones: [{ id: "UTC" }], startDate: "2026-11-02", top: 1 },
      "team.json",
    );
    expect(json(["--config", "team.json"]).slots).toHaveLength(1);
    expect(json(["--config", explicit]).slots).toHaveLength(1);
  });

  it("merges flags over config, retaining matching-zone settings and ordering", () => {
    const original = {
      zones: [
        {
          id: "Asia/Dhaka",
          label: "HQ",
          weekend: [5, 6],
          workStart: "10:00",
          workEnd: "16:00",
        },
        { id: "America/New_York", workStart: "10:00", workEnd: "16:00" },
        { id: "Europe/London" },
      ],
      startDate: "2026-10-26",
      days: 3,
      durationMinutes: 60,
      stepMinutes: 60,
      top: 3,
      prayer: { location: "Dhaka", method: "MWL", bufferMinutes: 20 },
    };
    const snapshot = structuredClone(original);
    const flags: CliFlags = {
      zones: "America/New_York,Asia/Dhaka",
      date: "2026-11-02",
      days: "2",
      duration: "15",
      step: "15",
      top: "1",
      work: "09:00-18:00",
      zoneWork: ["America/New_York=08:00-17:00"],
      quiet: "07:00-22:00",
      weekend: ["Asia/Dhaka=sun"],
      prayerMethod: "Karachi",
      prayerBuffer: "5",
    };
    const resolved = resolveOptions(original, flags);
    expect(resolved).toMatchObject({
      top: 1,
      input: {
        startDate: "2026-11-02",
        days: 2,
        durationMinutes: 15,
        stepMinutes: 15,
        prayer: { location: "Dhaka", method: "Karachi", bufferMinutes: 5 },
      },
    });
    expect(resolved.input.zones.map((zone) => zone.id)).toEqual([
      "America/New_York",
      "Asia/Dhaka",
    ]);
    expect(resolved.input.zones[0]).toMatchObject({
      workStart: "08:00",
      workEnd: "17:00",
      quietBefore: "07:00",
      quietAfter: "22:00",
    });
    expect(resolved.input.zones[1]).toMatchObject({
      label: "HQ",
      workStart: "09:00",
      workEnd: "18:00",
      weekend: [7],
    });
    expect(original).toEqual(snapshot);
  });

  it("tests precedence through actual CLI flags as well as the resolver", () => {
    configFile({
      zones: [{ id: "UTC" }],
      startDate: "2026-10-26",
      days: 5,
      durationMinutes: 60,
      top: 8,
    });
    const result = json([
      "--date",
      "2026-11-02",
      "--days",
      "1",
      "--duration",
      "15",
      "--top",
      "1",
    ]);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]!.date).toBe("2026-11-02");
    expect(
      Date.parse(result.slots[0]!.end) - Date.parse(result.slots[0]!.start),
    ).toBe(15 * 60000);
    expect(result.range.end).toBe("2026-11-03T00:00:00.000Z");
  });

  it("applies per-zone overrides after global flags, regardless of command-line order", () => {
    const flags: CliFlags = {
      zones: "UTC,Europe/London",
      date: "2026-11-02",
      work: "10:00-16:00",
      zoneWork: ["UTC=09:00-17:00", "UTC=08:00-18:00"],
    };
    const result = resolveOptions({}, flags);
    expect(result.input.zones[0]!.workStart).toBe("08:00");
    expect(result.input.zones[1]!.workStart).toBe("10:00");
    const output = invoke([
      "--zones",
      "UTC",
      "--date",
      "2026-11-02",
      "--zone-work",
      "UTC=08:00-17:00",
      "--work",
      "10:00-16:00",
      "--days",
      "1",
    ]);
    expect(output.code).toBe(0);
  });

  it("supports repeatable weekend overrides, including no weekend", () => {
    const resolved = resolveOptions(
      {},
      {
        zones: "Asia/Dhaka,UTC",
        date: "2026-11-02",
        weekend: ["Asia/Dhaka=fri,sat", "UTC=none"],
      },
    );
    expect(resolved.input.zones[0]!.weekend).toEqual([5, 6]);
    expect(resolved.input.zones[1]!.weekend).toEqual([]);
    const last = resolveOptions(
      {},
      {
        zones: "UTC",
        date: "2026-11-02",
        weekend: ["UTC=Friday,Saturday", "UTC=7"],
      },
    );
    expect(last.input.zones[0]!.weekend).toEqual([7]);
  });

  it("collects repeated per-zone flags through commander without losing earlier zones", () => {
    const output = invoke([
      "--zones",
      "Asia/Dhaka,Europe/London",
      "--date",
      "2026-11-02",
      "--days",
      "1",
      "--json",
      "--zone-work",
      "Asia/Dhaka=08:00-17:00",
      "--zone-work",
      "Europe/London=10:00-18:00",
      "--weekend",
      "Asia/Dhaka=mon",
      "--weekend",
      "Europe/London=none",
    ]);
    expect(output.code).toBe(0);
    const result = JSON.parse(output.stdout) as CliResult;
    expect(result.slots).toEqual([]);
    expect(
      result.diagnostics.constraints.some(
        (count) =>
          count.zoneId === "Asia/Dhaka" && count.constraint === "weekend",
      ),
    ).toBe(true);
    expect(
      result.diagnostics.constraints.some(
        (count) =>
          count.zoneId === "Europe/London" && count.constraint === "weekend",
      ),
    ).toBe(false);
  });

  it("validates the checked-in example with the shared schema and executes it", () => {
    const example = JSON.parse(
      readFileSync(resolve("examples/tzmeet.config.json"), "utf8"),
    ) as unknown;
    expect(configSchema.safeParse(example).success).toBe(true);
    const output = invoke([
      "--config",
      resolve("examples/tzmeet.config.json"),
      "--top",
      "1",
      "--json",
    ]);
    expect(output.code, output.stderr).toBe(0);
    expect(JSON.parse(output.stdout).slots).toHaveLength(1);
  });

  it("does not silently repair invalid configs with flags", () => {
    configFile({ zones: [{ id: "Not/AZone" }], startDate: "2026-11-02" });
    const output = invoke(["--zones", "UTC"]);
    expect(output.code).toBe(1);
    expect(output.stderr).toContain("Invalid config");
    expect(output.stderr).toContain("zones.0.id");
  });

  it("accepts a UTF-8 BOM and reports strict-JSON failures", () => {
    writeFileSync(
      join(cwd, "tzmeet.config.json"),
      '\uFEFF{"zones":[{"id":"UTC"}],"startDate":"2026-11-02","top":1}',
    );
    expect(json([]).slots).toHaveLength(1);
    writeFileSync(join(cwd, "tzmeet.config.json"), '{"zones": [],}');
    expect(invoke([]).stderr).toContain("Invalid JSON");
  });

  it("only auto-discovers in cwd, not parent directories", () => {
    configFile({ zones: [{ id: "UTC" }], startDate: "2026-11-02" });
    const child = mkdtempSync(join(cwd, "child-"));
    expect(invoke([], child).code).toBe(1);
    expect(readConfig(child)).toEqual({});
  });

  it("defaults the omitted date to today in the first zone, not the host date", () => {
    const now = new Date("2026-11-01T20:00:00Z");
    expect(
      resolveOptions({}, { zones: "Asia/Dhaka" }, now).input.startDate,
    ).toBe("2026-11-02");
    expect(
      resolveOptions({}, { zones: "America/New_York" }, now).input.startDate,
    ).toBe("2026-11-01");
  });
});

describe("holiday CLI option", () => {
  it("blocks a zone holiday and reports it as the cause", () => {
    const result = json([
      "--zones",
      "Asia/Dhaka,Europe/London",
      "--date",
      "2026-12-16",
      "--days",
      "1",
      "--holiday",
      "Asia/Dhaka=2026-12-16",
    ]);
    expect(result.slots).toEqual([]);
    expect(result.diagnostics.mostRestrictive).toMatchObject({
      zoneId: "Asia/Dhaka",
      constraint: "holiday",
    });
    expect(
      json([
        "--zones",
        "Asia/Dhaka,Europe/London",
        "--date",
        "2026-12-16",
        "--days",
        "1",
      ]).slots.length,
    ).toBeGreaterThan(0);
  });
});

describe("prayer CLI options", () => {
  it("enables prayer constraints with a built-in city and defaults", () => {
    const result = json([
      "--zones",
      "Asia/Dhaka",
      "--date",
      "2026-11-02",
      "--days",
      "1",
      "--prayer-location",
      "Dhaka",
    ]);
    expect(
      result.diagnostics.constraints.some(
        (constraint) => constraint.constraint === "prayer",
      ),
    ).toBe(true);
    expect(
      resolveOptions(
        {},
        { zones: "Asia/Dhaka", date: "2026-11-02", prayerLocation: "Dhaka" },
      ).input.prayer,
    ).toEqual({ location: "Dhaka", method: "Karachi", bufferMinutes: 10 });
  });

  it("parses coordinate locations and zero-minute buffers", () => {
    const result = resolveOptions(
      {},
      {
        zones: "Asia/Dhaka",
        date: "2026-11-02",
        prayerLocation: "23.8103,90.4125",
        prayerMethod: "MWL",
        prayerBuffer: "0",
      },
    );
    expect(result.input.prayer).toEqual({
      location: { lat: 23.8103, lng: 90.4125 },
      method: "MWL",
      bufferMinutes: 0,
    });
  });

  it("requires a location to enable prayers, but can use a configured location", () => {
    expect(invoke(["--zones", "UTC", "--prayer-buffer", "5"]).stderr).toContain(
      "--prayer-location is required",
    );
    configFile({
      zones: [{ id: "Asia/Dhaka" }],
      startDate: "2026-11-02",
      prayer: { location: "Dhaka" },
    });
    expect(
      json(["--prayer-method", "MWL", "--prayer-buffer", "5"]).slots.length,
    ).toBeGreaterThan(0);
  });

  it("keeps explicit per-zone prayer rules as overrides of global rules", () => {
    const result = resolveOptions(
      {
        zones: [
          {
            id: "Asia/Dhaka",
            prayer: { location: "Dhaka", method: "MWL", bufferMinutes: 25 },
          },
        ],
        startDate: "2026-11-02",
        prayer: { location: "London" },
      },
      { prayerBuffer: "5" },
    );
    expect(result.input.prayer!.bufferMinutes).toBe(5);
    expect(result.input.zones[0]!.prayer!.bufferMinutes).toBe(25);
  });
});

describe("errors, help and search", () => {
  it.each([
    [[], "Select at least one"],
    [["--zones", "Mars/Olympus", "--date", "2026-11-02"], "Unknown IANA"],
    [["--zones", "UTC", "--work", "9:00-18:00"], "HH:mm-HH:mm"],
    [["--zones", "UTC", "--work", "09:00-24:00"], "HH:mm"],
    [["--zones", "UTC", "--quiet", "10:00-17:00"], "fit inside"],
    [["--zones", "UTC", "--date", "2026-02-30"], "calendar date"],
    [["--zones", "UTC", "--duration", "abc"], "must be an integer"],
    [["--zones", "UTC", "--duration", "30.5"], "must be an integer"],
    [["--zones", "UTC", "--duration", "-30"], "must be an integer"],
    [["--zones", "UTC", "--days", "0"], "greater than"],
    [["--zones", "UTC", "--step", "0"], "greater than"],
    [["--zones", "UTC", "--top", "0"], "between 1 and 1000"],
    [["--zones", "UTC", "--top", "1001"], "between 1 and 1000"],
    [["--zones", "UTC", "--duration", "99999999999999999"], "safe integer"],
    [["--zones", "UTC,UTC"], "unique"],
    [["--zones", "UTC,"], "Unknown IANA"],
    [
      ["--zones", "UTC", "--zone-work", "Europe/London=08:00-17:00"],
      "not a selected zone",
    ],
    [["--zones", "UTC", "--zone-work", "08:00-17:00"], "IANA_ZONE=value"],
    [["--zones", "UTC", "--weekend", "UTC=funday"], "Unknown weekend day"],
    [["--zones", "UTC", "--weekend", "UTC=sat,sat"], "unique"],
    [["--zones", "UTC", "--prayer-location", "Atlantis"], "prayer.location"],
    [
      [
        "--zones",
        "UTC",
        "--prayer-location",
        "Dhaka",
        "--prayer-method",
        "Bogus",
      ],
      "prayer.method",
    ],
    [["--zones", "UTC", "--prayer-location", "90.1,0"], "90"],
    [
      ["--zones", "UTC", "--prayer-location", "bad,coords"],
      "latitude,longitude",
    ],
    [["--config", "missing.json"], "Cannot read config"],
    [["--unknown"], "unknown option"],
    [["--zones"], "argument missing"],
    [["stray"], "too many arguments"],
  ])("exits 1 for %j without writing success output", (args, message) => {
    const result = invoke(args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(message);
  });

  it("rejects unknown config fields through the shared schema", () => {
    configFile({
      zones: [{ id: "UTC" }],
      startDate: "2026-11-02",
      stray: true,
    });
    expect(invoke([]).stderr).toContain("Invalid config");
    expect(configSchema.safeParse({ stray: true }).success).toBe(false);
  });

  it("prints help/version with exit code 0 and no errors", () => {
    expect(invoke(["--help"]).code).toBe(0);
    expect(invoke(["--help"]).stdout).toContain("--zone-work");
    expect(invoke(["--help"]).stderr).toBe("");
    const { version } = JSON.parse(
      readFileSync("packages/cli/package.json", "utf8"),
    ) as { version: string };
    expect(invoke(["--version"]).stdout).toBe(`${version}\n`);
  });

  it("searches zone names without needing a config or meeting input", () => {
    configFile({ invalid: true });
    expect(invoke(["zones", "london"])).toEqual({
      code: 0,
      stdout: "Europe/London\n",
      stderr: "",
    });
    expect(invoke(["zones", "NEW_YORK"]).stdout).toBe("America/New_York\n");
    expect(invoke(["zones", "utc"]).stdout).toBe("UTC\n");
    expect(invoke(["zones", "does_not_exist"]).code).toBe(0);
    expect(invoke(["zones", "does_not_exist"]).stdout).toContain(
      "No time zones matched",
    );
    expect(JSON.parse(invoke(["--json", "zones", "london"]).stdout)).toEqual([
      "Europe/London",
    ]);
    expect(invoke(["zones", "--help"]).code).toBe(0);
  });

  it("returns exit 0 with helpful diagnostics when no overlap exists", () => {
    configFile({
      zones: [{ id: "Asia/Dhaka" }, { id: "America/New_York" }],
      startDate: "2026-11-02",
      days: 1,
    });
    const table = invoke(["--quiet", "09:00-18:00"]);
    expect(table.code).toBe(0);
    expect(table.stderr).toBe("");
    expect(table.stdout).toContain("No shared slots");
    expect(table.stdout).toContain("Suggestion: Relax");
    const result = json(["--quiet", "09:00-18:00"]);
    expect(result.slots).toEqual([]);
    expect(result.totalSlots).toBe(0);
    expect(result.diagnostics.mostRestrictive?.constraint).toBe("quiet");
  });

  it("renders changed offsets and local dates explicitly for DST/midnight spans", () => {
    const { input } = resolveOptions(
      {},
      { zones: "America/New_York", date: "2026-11-01" },
    );
    const fixture: CliResult = {
      slots: [
        {
          start: "2026-11-01T05:45:00.000Z",
          end: "2026-11-01T06:15:00.000Z",
          date: "2026-11-01",
          score: 1,
          baseScore: 1,
          zones: [
            {
              id: "America/New_York",
              label: "New York",
              localStart: "2026-11-01T01:45:00.000-04:00",
              localEnd: "2026-11-01T01:15:00.000-05:00",
              formattedStart: "",
              formattedEnd: "",
              classification: "acceptable",
            },
          ],
          reason: "Fold fixture",
        },
      ],
      totalSlots: 1,
      diagnostics: {
        scannedCandidates: 1,
        rejectedCandidates: 0,
        constraints: [],
        mostRestrictive: null,
        message: "1 slots found.",
        suggestion: "",
      },
      range: { start: "", end: "" },
    };
    expect(formatTable(fixture, input)).toContain("-0400/-0500 ~");
    fixture.slots[0]!.zones[0]!.localEnd = "2026-11-02T01:15:00.000-05:00";
    expect(formatTable(fixture, input)).toContain("Mon 2 Nov 01:15");
  });

  it("neutralizes control characters in configured labels before table output", () => {
    configFile({
      zones: [{ id: "UTC", label: "HQ\n\u001b[31m" }],
      startDate: "2026-11-02",
      top: 1,
    });
    const output = invoke([]);
    expect(output.code).toBe(0);
    expect(output.stdout).not.toContain("\u001b");
    expect(output.stdout).toContain("HQ  [31m");
  });
});

describe("built Node executable", () => {
  const packageDir = resolve("packages/cli");
  const executable = join(packageDir, "dist/bin.js");
  let isolated: string;
  beforeAll(() => {
    execFileSync(process.execPath, ["scripts/build.mjs"], {
      cwd: packageDir,
      encoding: "utf8",
    });
    isolated = mkdtempSync(join(tmpdir(), "tzmeet-built-"));
  });
  afterAll(() => {
    rmSync(isolated, { recursive: true, force: true });
  });

  function execute(args: string[]) {
    return spawnSync(process.execPath, [executable, ...args], {
      cwd: isolated,
      encoding: "utf8",
    });
  }

  it("has an executable shebang and a publishable bin manifest", () => {
    expect(
      readFileSync(executable, "utf8").startsWith("#!/usr/bin/env node"),
    ).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(packageDir, "package.json"), "utf8"),
    );
    expect(manifest.name).toBe("tzmeet");
    expect(manifest.bin.tzmeet).toBe("./dist/bin.js");
    expect(manifest.engines.node).toBe(">=20");
    expect(manifest.dependencies["@tzmeet/core"]).toBeUndefined();
  });

  it("runs the real binary with JSON stdout and exit 0", () => {
    const output = execute([...fixedArgs, "--json"]);
    expect(output.status, output.stderr).toBe(0);
    expect(output.stderr).toBe("");
    const result = JSON.parse(output.stdout) as FindSlotsResult;
    expect(result.slots).toHaveLength(2);
    expect(result.slots[0]!.zones).toHaveLength(3);
  });

  it("runs table output, zone search and help from an unrelated directory", () => {
    expect(execute(fixedArgs).stdout).toContain("Reason");
    expect(execute(["zones", "london"]).stdout).toBe("Europe/London\n");
    expect(execute(["--help"]).status).toBe(0);
  });

  it("propagates the required invalid-input exit code", () => {
    const output = execute(["--zones", "Mars/Olympus", "--date", "2026-11-02"]);
    expect(output.status).toBe(1);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain("Unknown IANA");
  });

  it("does not treat an empty result as a process error", () => {
    const output = execute([
      "--zones",
      "Asia/Dhaka,America/New_York",
      "--date",
      "2026-11-02",
      "--days",
      "1",
      "--quiet",
      "09:00-18:00",
      "--json",
    ]);
    expect(output.status).toBe(0);
    expect(JSON.parse(output.stdout).slots).toEqual([]);
  });
});

describe("cron subcommand", () => {
  const from = ["--from", "2027-03-12T00:00:00Z"];

  it("prints a run table in the default zones with DST notes and warnings", () => {
    const output = invoke([
      "cron",
      "30 2 * * *",
      "--zone",
      "America/New_York",
      "--count",
      "4",
      ...from,
    ]);
    expect(output.code, output.stderr).toBe(0);
    expect(output.stdout).toMatchSnapshot();
    expect(output.stdout).toContain("Sun 14 Mar 2027 03:00 -04:00");
    expect(output.stdout).toContain("late: DST skipped this time");
    expect(output.stdout).toContain(
      "! On 2027-03-14 in America/New_York, clocks jump from 02:00 to 03:00.",
    );
  });

  it("joins unquoted fields and honours --dialect and --display", () => {
    const output = invoke([
      "cron",
      "30",
      "1",
      "*",
      "*",
      "*",
      "--dialect",
      "kubernetes",
      "--zone",
      "America/New_York",
      "--display",
      "UTC",
      "--count",
      "2",
      "--from",
      "2026-10-31T12:00:00Z",
    ]);
    expect(output.code, output.stderr).toBe(0);
    expect(output.stdout).toContain(
      "30 1 * * *  (Kubernetes CronJob, runs in America/New_York)",
    );
    expect(output.stdout).toContain("2nd of 2 runs");
    expect(output.stdout).not.toContain("Asia/Dhaka");
  });

  it("prints core output as JSON and defaults --from to now", () => {
    const output = invoke(["cron", "@daily", "--count", "1", "--json"]);
    expect(output.code, output.stderr).toBe(0);
    const result = JSON.parse(output.stdout);
    expect(result.runs[0].utc).toBe("2026-11-02T00:00:00.000Z");
    expect(
      result.runs[0].zones.map((zone: { zone: string }) => zone.zone),
    ).toEqual(["Asia/Dhaka", "UTC", "America/New_York", "Europe/London"]);
  });

  it.each([
    [["cron", "0 99 * * *"], "hour must be 0–23, got 99"],
    [["cron", "0 0 * * *", "--count", "x"], "--count must be an integer"],
    [["cron", "0 0 * * *", "--dialect", "cronie"], "dialect"],
    [["cron", "0 0 * * *", "--zone", "Asia/Dhka"], "Unknown IANA time zone"],
  ])("exits 1 for %j", (args, message) => {
    const output = invoke(args);
    expect(output.code).toBe(1);
    expect(output.stderr).toContain(message);
  });
});

describe("recurring subcommand", () => {
  const team = [
    "--zones",
    "Europe/London,America/New_York,Asia/Dhaka",
    "--date",
    "2026-10-12",
  ];

  it("prints one row per period with the clock change that caused it", () => {
    const output = invoke([
      "recurring",
      ...team,
      "--time",
      "14:00",
      "--weeks",
      "30",
    ]);
    expect(output.code, output.stderr).toBe(0);
    expect(output.stdout).toMatchSnapshot();
    expect(output.stdout).toContain(
      "Every Monday at 14:00 Europe/London (30 min), next 30 weeks",
    );
    expect(output.stdout).toContain(
      "2026-10-26               | 1     | 14:00 *",
    );
    expect(output.stdout).toContain(
      "i Week of 2026-10-26: New York at 10:00 instead of 09:00",
    );
  });

  it("shares zone flags and config with the main search, and prints JSON", () => {
    configFile({
      zones: [
        { id: "Europe/London" },
        { id: "Asia/Dhaka", quietAfter: "20:30" },
      ],
      durationMinutes: 45,
    });
    const output = invoke([
      "recurring",
      "--date",
      "2026-10-19",
      "--time",
      "14:00",
      "--weeks",
      "2",
      "--json",
    ]);
    expect(output.code, output.stderr).toBe(0);
    const result = JSON.parse(output.stdout);
    expect(result.durationMinutes).toBe(45);
    expect(
      result.periods.map(
        (period: { zones: { classification: string }[] }) =>
          period.zones[1]!.classification,
      ),
    ).toEqual(["acceptable", "blocked"]);
  });

  it("defaults --date to today in the first zone", () => {
    const output = invoke([
      "recurring",
      "--zones",
      "Asia/Dhaka",
      "--time",
      "10:00",
      "--weeks",
      "1",
      "--json",
    ]);
    expect(output.code, output.stderr).toBe(0);
    expect(JSON.parse(output.stdout).occurrences[0].date).toBe("2026-11-02");
  });

  it.each([
    [["recurring", ...team], "required option '--time <HH:mm>'"],
    [["recurring", ...team, "--time", "9"], "Time must use HH:mm"],
    [["recurring", ...team, "--time", "09:00", "--weeks", "200"], "weeks"],
    [
      [
        "recurring",
        "--zones",
        "Asia/Dhka",
        "--date",
        "2026-10-12",
        "--time",
        "09:00",
      ],
      "Unknown IANA time zone",
    ],
  ])("exits 1 for %j", (args, message) => {
    const output = invoke(args);
    expect(output.code).toBe(1);
    expect(output.stderr).toContain(message);
  });
});

describe("holiday presets", () => {
  it("blocks preset holidays from --holiday-preset and config", () => {
    const args = [
      "--zones",
      "Asia/Dhaka,Europe/London",
      "--date",
      "2026-12-16",
      "--days",
      "1",
    ];
    expect(json(args).slots.length).toBeGreaterThan(0);
    const blocked = json([...args, "--holiday-preset", "Asia/Dhaka=BD"]);
    expect(blocked.slots).toEqual([]);
    expect(blocked.diagnostics.mostRestrictive).toMatchObject({
      zoneId: "Asia/Dhaka",
      constraint: "holiday",
    });
    configFile({
      zones: [
        { id: "Asia/Dhaka", holidayPreset: "BD" },
        { id: "Europe/London" },
      ],
    });
    expect(json(["--date", "2026-12-16", "--days", "1"]).slots).toEqual([]);
    expect(
      json([
        "--date",
        "2026-12-16",
        "--days",
        "1",
        "--holiday-preset",
        "Asia/Dhaka=none",
      ]).slots.length,
    ).toBeGreaterThan(0);
  });

  it("rejects unknown presets", () => {
    const output = invoke([
      "--zones",
      "UTC",
      "--date",
      "2026-12-16",
      "--holiday-preset",
      "UTC=FR",
    ]);
    expect(output.code).toBe(1);
    expect(output.stderr).toContain(
      'Unknown holiday preset "FR"; use BD, GB-ENG, IN, PK, AE, US or none',
    );
  });
});

describe("busy calendars", () => {
  const ics = (...events: string[]) =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      ...events.flatMap((lines, index) => [
        "BEGIN:VEVENT",
        `UID:${index}`,
        lines,
        "END:VEVENT",
      ]),
      "END:VCALENDAR",
      "",
    ].join("\r\n");
  const args = [
    "--zones",
    "UTC,Europe/London",
    "--date",
    "2026-11-02",
    "--days",
    "1",
    "--step",
    "60",
    "--weekend",
    "UTC=none",
    "--top",
    "50",
  ];

  it("blocks busy times from --busy and warns about skipped events", () => {
    writeFileSync(
      join(cwd, "me.ics"),
      ics(
        "DTSTART:20261102T100000Z\r\nDTEND:20261102T120000Z",
        "DTSTART;TZID=Nowhere:20261102T140000\r\nDTEND;TZID=Nowhere:20261102T150000",
      ),
    );
    const before = json(args).slots.map((slot) => slot.start.slice(11, 13));
    expect(before).toEqual(expect.arrayContaining(["10", "11"]));
    const output = invoke([...args, "--busy", "UTC=me.ics", "--json"]);
    expect(output.code, output.stderr).toBe(0);
    expect(output.stderr).toBe(
      'tzmeet: me.ics: Skipped events in unknown time zones: "Nowhere".\n',
    );
    const after = (JSON.parse(output.stdout) as CliResult).slots.map((slot) =>
      slot.start.slice(11, 13),
    );
    expect(after).not.toContain("10");
    expect(after).not.toContain("11");
    expect(after).toContain("12");
  });

  it("applies busy calendars to recurring meetings", () => {
    writeFileSync(
      join(cwd, "me.ics"),
      ics("DTSTART:20261109T140000Z\r\nDTEND:20261109T150000Z"),
    );
    const output = invoke([
      "recurring",
      "--zones",
      "Europe/London,UTC",
      "--date",
      "2026-11-02",
      "--time",
      "14:00",
      "--weeks",
      "3",
      "--busy",
      "UTC=me.ics",
      "--json",
    ]);
    expect(output.code, output.stderr).toBe(0);
    expect(
      JSON.parse(output.stdout).occurrences.map(
        (occurrence: { zones: { classification: string }[] }) =>
          occurrence.zones[1]!.classification,
      ),
    ).toEqual(["ideal", "blocked", "ideal"]);
  });

  it.each([
    [["--busy", "UTC"], "--busy must use IANA_ZONE=calendar.ics"],
    [["--busy", "Asia/Tokyo=me.ics"], "Asia/Tokyo is not a selected zone"],
    [["--busy", "UTC=missing.ics"], "Cannot read calendar"],
    [["--busy", "UTC=notes.txt"], "doesn't look like an iCalendar"],
  ])("exits 1 for %j", (extra, message) => {
    writeFileSync(join(cwd, "notes.txt"), "hello");
    const output = invoke([...args, ...extra]);
    expect(output.code).toBe(1);
    expect(output.stderr).toContain(message);
  });
});

describe("special hours and rotation", () => {
  const pair = [
    "--zones",
    "UTC,Asia/Tokyo",
    "--date",
    "2026-11-02",
    "--days",
    "1",
    "--step",
    "60",
    "--weekend",
    "UTC=none",
    "--weekend",
    "Asia/Tokyo=none",
    "--work",
    "09:00-17:00",
    "--quiet",
    "07:00-21:00",
  ];

  it("prints a fair rotation after the table and in JSON", () => {
    const text = invoke([...pair, "--rotation", "2", "--top", "3"]);
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toContain("Fair rotation (2 times, alternate weekly):");
    expect(text.stdout).toContain(
      "UTC 07:00 / Tokyo 16:00  (outside work hours: UTC)",
    );
    const result = JSON.parse(
      invoke([...pair, "--rotation", "3", "--json"]).stdout,
    );
    expect(result.rotation.size).toBe(3);
    expect(json(pair)).not.toHaveProperty("rotation");
  });

  it("applies --ramadan and --special-hours", () => {
    const dhaka = (extra: string[]) =>
      json([
        "--zones",
        "Asia/Dhaka,Europe/London",
        "--date",
        "2027-02-10",
        "--days",
        "1",
        "--step",
        "60",
        "--top",
        "50",
        ...extra,
      ]).slots.find((slot) => slot.start.includes("T10:00"))!.zones[0]!
        .classification;
    expect(dhaka([])).toBe("ideal");
    expect(dhaka(["--ramadan", "Asia/Dhaka=09:00-15:30"])).toBe("acceptable");
    expect(
      dhaka([
        "--special-hours",
        "Asia/Dhaka=2027-02-01..2027-02-28@09:00-14:00",
      ]),
    ).toBe("acceptable");
  });

  it.each([
    [["--rotation", "4"], "--rotation must be 2 or 3"],
    [
      ["--special-hours", "UTC=2026-11-02@09:00-15:00"],
      "--special-hours must use",
    ],
    [["--ramadan", "UTC=9-3"], "--ramadan must use HH:mm-HH:mm"],
  ])("exits 1 for %j", (extra, message) => {
    const output = invoke([...pair, ...extra]);
    expect(output.code).toBe(1);
    expect(output.stderr).toContain(message);
  });
});

describe("optional attendees", () => {
  it("marks optional zones and never lets them block", () => {
    const args = [
      "--zones",
      "Europe/London,Asia/Dhaka,America/New_York",
      "--date",
      "2026-11-02",
      "--days",
      "1",
      "--step",
      "60",
      "--top",
      "20",
    ];
    const output = invoke([...args, "--optional", "America/New_York"]);
    expect(output.code, output.stderr).toBe(0);
    expect(output.stdout).toContain(
      "* ideal / ~ acceptable / x unavailable (optional)",
    );
    expect(output.stdout).toMatch(/-0500 x \(optional\)/);
    expect(
      json([...args, "--optional", "America/New_York"]).slots.length,
    ).toBeGreaterThan(json(args).slots.length);
  });
});

describe("cron conversion", () => {
  it("converts syntax with --to and zones with --to-zone", () => {
    const output = invoke([
      "cron",
      "0 9 * * 1-5",
      "--zone",
      "Asia/Dhaka",
      "--to",
      "quartz",
      "--to-zone",
      "UTC",
    ]);
    expect(output.code, output.stderr).toBe(0);
    expect(output.stdout).toContain("Quartz:\n  0 0 9 ? * MON-FRI");
    expect(output.stdout).toContain(
      "UTC is always 6 hours behind Asia/Dhaka, so one expression works all year.",
    );
    expect(output.stdout).toContain("  All year:\n    0 3 * * 1-5");
    expect(output.stdout).toContain("  CRON_TZ=Asia/Dhaka\n  0 9 * * 1-5");
  });

  it("lists an expression per DST period and prints JSON", () => {
    const output = invoke([
      "cron",
      "0 9 * * *",
      "--dialect",
      "kubernetes",
      "--zone",
      "America/New_York",
      "--to-zone",
      "UTC",
      "--from",
      "2026-10-23T00:00:00Z",
      "--json",
    ]);
    expect(output.code, output.stderr).toBe(0);
    const result = JSON.parse(output.stdout);
    expect(
      result.zone.periods.map(
        (period: { expressions: string[] }) => period.expressions[0],
      ),
    ).toEqual(["0 13 * * *", "0 14 * * *", "0 13 * * *"]);
  });

  it("exits 1 when a conversion is impossible, or the target is unknown", () => {
    const impossible = invoke(["cron", "0 0 0 13 * FRI", "--to", "unix"]);
    expect(impossible.code).toBe(1);
    expect(impossible.stdout).toContain("Can't convert to Unix cron exactly:");
    const unknown = invoke(["cron", "0 9 * * *", "--to", "cronie"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain(
      "--to must be unix, kubernetes, spring or quartz",
    );
  });
});

describe("cron --check", () => {
  const from = ["--from", "2026-10-23T00:00:00Z"];
  const crontab = [
    "MAILTO=ops@example.com",
    "0 9 * * 1-5 /usr/bin/report",
    "CRON_TZ=America/New_York",
    "30 2 * * * /usr/bin/backup",
    "15 1 * * 0 /usr/bin/rotate",
    "@reboot /usr/bin/warm",
    "",
  ].join("\n");
  const jobs = [
    "apiVersion: batch/v1",
    "kind: CronJob",
    "metadata:",
    "  name: cleanup",
    "spec:",
    '  schedule: "30 1 * * *"',
    '  timeZone: "Europe/London"',
    "  jobTemplate: {}",
    "---",
    "apiVersion: batch/v1",
    "kind: CronJob",
    "metadata:",
    "  name: report",
    "spec:",
    '  schedule: "0 6 13 * 5"',
    "  jobTemplate: {}",
    "---",
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    "  name: other",
    "",
  ].join("\n");
  const setup = () => {
    writeFileSync(join(cwd, "crontab"), crontab);
    mkdirSync(join(cwd, "k8s"));
    writeFileSync(join(cwd, "k8s", "jobs.yaml"), jobs);
    mkdirSync(join(cwd, "node_modules"));
    writeFileSync(
      join(cwd, "node_modules", "ignored.yaml"),
      'kind: CronJob\nspec:\n  schedule: "nope"\n',
    );
  };

  it("finds DST problems in crontabs and CronJobs, with file and line, and exits 1", () => {
    setup();
    const output = invoke(["cron", "--check", ".", ...from]);
    expect(output.code).toBe(1);
    expect(output.stdout).toMatchSnapshot();
    expect(output.stdout).toContain(
      "crontab:4: error: On 2027-03-14 in America/New_York, clocks jump from 02:00 to 03:00.",
    );
    expect(output.stdout).toContain(
      "k8s/jobs.yaml:6: error: cleanup: On 2026-10-25 in Europe/London, clocks go back from 02:00 to 01:00, so the 01:30 run happens twice.",
    );
    expect(output.stdout).toContain(
      "k8s/jobs.yaml:15: warning: report: no spec.timeZone",
    );
    expect(output.stdout).toContain(
      "Checked 5 schedules in 2 files: 3 errors, 2 warnings.",
    );
  });

  it("passes clean files, and fails on warnings only with --strict", () => {
    writeFileSync(join(cwd, "ok.crontab"), "0 9 * * * /bin/true\n");
    writeFileSync(
      join(cwd, "job.yml"),
      'kind: CronJob\nmetadata:\n  name: plain\nspec:\n  schedule: "0 9 * * *"\n',
    );
    expect(invoke(["cron", "--check", "ok.crontab", ...from])).toMatchObject({
      code: 0,
    });
    expect(invoke(["cron", "--check", "job.yml", ...from])).toMatchObject({
      code: 0,
    });
    expect(
      invoke(["cron", "--check", "job.yml", "--strict", ...from]),
    ).toMatchObject({ code: 1 });
  });

  it("uses --zone where no time zone is set", () => {
    writeFileSync(join(cwd, "ok.crontab"), "30 1 * * * /bin/true\n");
    expect(invoke(["cron", "--check", "ok.crontab", ...from]).code).toBe(0);
    const output = invoke([
      "cron",
      "--check",
      "ok.crontab",
      "--zone",
      "Europe/London",
      ...from,
    ]);
    expect(output.code).toBe(1);
    expect(output.stdout).toContain("[30 1 * * * in Europe/London]");
  });

  it("prints GitHub annotations and JSON", () => {
    setup();
    const github = invoke([
      "cron",
      "--check",
      "k8s",
      "--format",
      "github",
      ...from,
    ]);
    expect(github.stdout.split("\n")[0]).toBe(
      "::error file=k8s/jobs.yaml,line=6,title=tzmeet cron check::cleanup: On 2026-10-25 in Europe/London, clocks go back from 02:00 to 01:00, so the 01:30 run happens twice. [30 1 * * * in Europe/London]",
    );
    const result = JSON.parse(
      invoke(["cron", "--check", "k8s", "--json", ...from]).stdout,
    );
    expect(result).toMatchObject({ files: 1, schedules: 2 });
    expect(
      result.findings.map((finding: { code: string }) => finding.code),
    ).toEqual(["dst-double", "dst-skip", "k8s-no-timezone", "dom-dow-or"]);
  });

  it("reports bad lines, bad zones and missing paths", () => {
    writeFileSync(
      join(cwd, "bad.crontab"),
      "CRON_TZ=Mars/Base\n61 * * * * /bin/x\n0 9 * *\n",
    );
    const output = invoke(["cron", "--check", "bad.crontab", ...from]);
    expect(output.code).toBe(1);
    expect(output.stdout).toContain(
      "bad.crontab:1: error: CRON_TZ is not a valid IANA time zone: Mars/Base",
    );
    expect(output.stdout).toContain(
      "bad.crontab:2: error: Invalid schedule: minute must be 0–59, got 61",
    );
    expect(output.stdout).toContain("bad.crontab:3: error: Not a cron line");
    const missing = invoke(["cron", "--check", "nowhere"]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("Cannot read nowhere");
    expect(
      invoke(["cron", "--check", ".", "--format", "xml"]).stderr,
    ).toContain("--format must be text or github");
  });
});
