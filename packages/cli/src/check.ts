import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { LineCounter, parseAllDocuments } from "yaml";
import {
  explainCron,
  parseCron,
  timeZoneIdSchema,
  type CronDialect,
} from "@tzmeet/core";

export interface CheckFinding {
  file: string;
  line: number;
  severity: "error" | "warning";
  code: string;
  message: string;
  schedule?: string;
  zone?: string;
}
export interface CheckResult {
  files: number;
  schedules: number;
  findings: CheckFinding[];
}
export interface CheckOptions {
  cwd: string;
  zone: string;
  from: string;
  localZone?: string;
}

const skippedFolders = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "coverage",
]);
const isYaml = (path: string) =>
  [".yaml", ".yml"].includes(extname(path).toLowerCase());
const isCrontab = (path: string) => {
  const name = basename(path).toLowerCase();
  return (
    name === "crontab" || name.endsWith(".crontab") || name.endsWith(".cron")
  );
};
const isTimer = (path: string) => extname(path).toLowerCase() === ".timer";
const isJenkinsfile = (path: string) => {
  const name = basename(path).toLowerCase();
  return name === "jenkinsfile" || name.endsWith(".jenkinsfile");
};
const isInfra = (path: string) =>
  [".tf", ".json"].includes(extname(path).toLowerCase());
const isScanned = (path: string) =>
  isYaml(path) ||
  isCrontab(path) ||
  isTimer(path) ||
  isJenkinsfile(path) ||
  isInfra(path);

function collect(paths: readonly string[], cwd: string): string[] {
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!skippedFolders.has(entry.name)) walk(path);
      } else if (isScanned(path)) {
        if (isInfra(path) && !readFileSync(path, "utf8").includes("cron("))
          continue;
        files.push(path);
      }
    }
  };
  for (const given of paths) {
    const path = resolve(cwd, given);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      throw new Error(`Cannot read ${given}: no such file or folder`);
    }
    if (stats.isDirectory()) walk(path);
    else files.push(path);
  }
  return [...new Set(files)].sort();
}

function checkSchedule(
  schedule: string,
  dialect: CronDialect,
  zone: string,
  from: string,
  localZone?: string,
): Omit<CheckFinding, "file" | "line">[] {
  const parsed = parseCron(schedule, dialect);
  if (!parsed.ok)
    return [
      {
        severity: "error",
        code: "invalid",
        message: `Invalid schedule: ${parsed.errors.map((error) => error.message).join("; ")}`,
        schedule,
      },
    ];
  const findings: Omit<CheckFinding, "file" | "line">[] = [];
  if (
    parsed.cron.prefixZone &&
    (dialect === "jenkins" || dialect === "systemd")
  )
    zone = parsed.cron.prefixZone;
  const utcOnly =
    zone === "UTC" &&
    localZone &&
    localZone !== "UTC" &&
    (dialect === "github" || dialect === "eventbridge");
  const result = explainCron({
    expression: schedule,
    dialect,
    zone,
    from,
    count: 1,
    ...(utcOnly ? { displayZones: [localZone] } : {}),
  });
  if (utcOnly)
    for (const shift of result.warnings.filter(
      (warning) => warning.code === "zone-shift",
    ))
      findings.push({
        severity: "warning",
        code: "utc-shift",
        message: `Runs in UTC, so its local time moves with daylight saving. ${shift.message} Set a time zone on the schedule to keep it at the same local time.`,
        schedule,
        zone,
      });
  for (const warning of result.warnings) {
    const severity = [
      "dst-skip",
      "dst-late",
      "dst-double",
      "never-runs",
    ].includes(warning.code)
      ? "error"
      : ["dom-dow-or", "k8s-inline-timezone", "dst-maybe-double"].includes(
            warning.code,
          )
        ? "warning"
        : null;
    if (severity)
      findings.push({
        severity,
        code: warning.code,
        message: warning.message,
        schedule,
        zone,
      });
  }
  return findings;
}

function checkCrontab(
  text: string,
  file: string,
  options: CheckOptions,
): { schedules: number; findings: CheckFinding[] } {
  const findings: CheckFinding[] = [];
  let zone = options.zone;
  let schedules = 0;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (assignment) {
      if (assignment[1] === "CRON_TZ") {
        const value = assignment[2]!.replace(/^["']|["']$/g, "").trim();
        if (timeZoneIdSchema.safeParse(value).success) zone = value;
        else
          findings.push({
            file,
            line: index + 1,
            severity: "error",
            code: "unknown-zone",
            message: `CRON_TZ is not a valid IANA time zone: ${value}`,
          });
      }
      return;
    }
    const tokens = line.split(/\s+/);
    if (tokens[0]!.toLowerCase() === "@reboot") return;
    const schedule = tokens[0]!.startsWith("@")
      ? tokens[0]!
      : tokens.slice(0, 5).join(" ");
    if (!tokens[0]!.startsWith("@") && tokens.length < 6) {
      findings.push({
        file,
        line: index + 1,
        severity: "error",
        code: "invalid",
        message:
          "Not a cron line: expected 5 schedule fields followed by a command",
        schedule: line,
      });
      return;
    }
    schedules++;
    for (const finding of checkSchedule(schedule, "unix", zone, options.from))
      findings.push({ file, line: index + 1, ...finding });
  });
  return { schedules, findings };
}

function checkYaml(
  text: string,
  file: string,
  options: CheckOptions,
): { schedules: number; findings: CheckFinding[] } {
  const findings: CheckFinding[] = [];
  let schedules = 0;
  const lines = new LineCounter();
  const documents = parseAllDocuments(text, { lineCounter: lines });
  if (!Array.isArray(documents)) return { schedules, findings };
  for (const document of documents) {
    if (document.errors.length) {
      if (/kind:\s*CronJob/.test(text))
        findings.push({
          file,
          line: lines.linePos(document.errors[0]!.pos[0]).line,
          severity: "warning",
          code: "unreadable",
          message:
            "Couldn't read this YAML document (is it a template?), so its CronJob wasn't checked",
        });
      continue;
    }
    const lineAt = (range?: [number, number, number]) =>
      range ? lines.linePos(range[0]).line : 1;
    const schedule = document.getIn(["on", "schedule"], true) as
      | { items?: unknown[] }
      | undefined;
    if (schedule && Array.isArray(schedule.items)) {
      const workflow = String(document.get("name") ?? "workflow");
      for (const item of schedule.items as {
        get?: (key: string, keep?: boolean) => unknown;
      }[]) {
        const cronNode = item.get?.("cron", true) as
          | { value?: unknown; range?: [number, number, number] }
          | undefined;
        if (typeof cronNode?.value !== "string") continue;
        schedules++;
        const line = lineAt(cronNode.range);
        const timezone = item.get?.("timezone");
        let zone = "UTC";
        if (typeof timezone === "string") {
          if (!timeZoneIdSchema.safeParse(timezone).success) {
            findings.push({
              file,
              line,
              severity: "error",
              code: "unknown-zone",
              message: `${workflow}: timezone is not a valid IANA time zone: ${timezone}`,
            });
            continue;
          }
          zone = timezone;
        }
        for (const finding of checkSchedule(
          cronNode.value,
          "github",
          zone,
          options.from,
          options.localZone,
        ))
          findings.push({
            file,
            line,
            ...finding,
            message: `${workflow}: ${finding.message}`,
          });
      }
      continue;
    }
    if (document.get("kind") !== "CronJob") continue;
    const node = document.getIn(["spec", "schedule"], true) as
      | { value?: unknown; range?: [number, number, number] }
      | undefined;
    const kindNode = document.get("kind", true) as
      | { range?: [number, number, number] }
      | undefined;
    const lineOf = (range?: [number, number, number]) =>
      range ? lines.linePos(range[0]).line : 1;
    const name = String(document.getIn(["metadata", "name"]) ?? "CronJob");
    if (typeof node?.value !== "string") {
      findings.push({
        file,
        line: lineOf(kindNode?.range),
        severity: "error",
        code: "invalid",
        message: `${name}: spec.schedule is missing`,
      });
      continue;
    }
    schedules++;
    const line = lineOf(node.range);
    const timeZone = document.getIn(["spec", "timeZone"]);
    let zone = options.zone;
    if (typeof timeZone === "string") {
      if (!timeZoneIdSchema.safeParse(timeZone).success) {
        findings.push({
          file,
          line,
          severity: "error",
          code: "unknown-zone",
          message: `${name}: spec.timeZone is not a valid IANA time zone: ${timeZone}`,
        });
        continue;
      }
      zone = timeZone;
    } else
      findings.push({
        file,
        line,
        severity: "warning",
        code: "k8s-no-timezone",
        message: `${name}: no spec.timeZone, so Kubernetes uses the kube-controller-manager's time zone (often UTC). Set spec.timeZone to make the schedule explicit.`,
        schedule: node.value,
      });
    for (const finding of checkSchedule(
      node.value,
      "kubernetes",
      zone,
      options.from,
    ))
      findings.push({
        file,
        line,
        ...finding,
        message: `${name}: ${finding.message}`,
      });
  }
  return { schedules, findings };
}

function checkTimer(
  text: string,
  file: string,
  options: CheckOptions,
): { schedules: number; findings: CheckFinding[] } {
  const findings: CheckFinding[] = [];
  let schedules = 0;
  text.split(/\r?\n/).forEach((raw, index) => {
    const match = /^\s*OnCalendar\s*=\s*(.+?)\s*$/.exec(raw);
    if (!match) return;
    schedules++;
    for (const finding of checkSchedule(
      match[1]!,
      "systemd",
      options.zone,
      options.from,
    ))
      findings.push({ file, line: index + 1, ...finding });
  });
  return { schedules, findings };
}

function checkJenkinsfile(
  text: string,
  file: string,
  options: CheckOptions,
): { schedules: number; findings: CheckFinding[] } {
  const findings: CheckFinding[] = [];
  let schedules = 0;
  const pattern =
    /cron\s*\(\s*(?:'{3}([\s\S]*?)'{3}|"{3}([\s\S]*?)"{3}|'([^'\n]*)'|"([^"\n]*)")\s*\)/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const spec = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    const startLine = text.slice(0, match.index).split("\n").length;
    const specLines = spec.replace(/\\n/g, "\n").split("\n");
    let zone: string | undefined;
    specLines.forEach((raw, offset) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      if (/^TZ=/.test(line)) {
        zone = line.slice(3).trim();
        return;
      }
      schedules++;
      const schedule = zone ? `TZ=${zone} ${line}` : line;
      for (const finding of checkSchedule(
        schedule,
        "jenkins",
        options.zone,
        options.from,
      ))
        findings.push({
          file,
          line: startLine + offset,
          ...finding,
          schedule: line,
        });
    });
  }
  return { schedules, findings };
}

function checkEventBridge(
  text: string,
  file: string,
  options: CheckOptions,
): { schedules: number; findings: CheckFinding[] } {
  const findings: CheckFinding[] = [];
  let schedules = 0;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const pattern = /cron\(([^)]*)\)/g;
    for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
      schedules++;
      const nearby = lines
        .slice(Math.max(0, index - 10), index + 11)
        .join("\n");
      const zoneMatch =
        /(?:ScheduleExpressionTimezone|schedule_expression_timezone|scheduleExpressionTimezone|timezone)["']?\s*[:=]\s*["']?(UTC|[A-Za-z_]+\/[A-Za-z_/+-]+)/.exec(
          nearby,
        );
      const zone =
        zoneMatch && timeZoneIdSchema.safeParse(zoneMatch[1]).success
          ? zoneMatch[1]!
          : "UTC";
      for (const finding of checkSchedule(
        match[0],
        "eventbridge",
        zone,
        options.from,
        options.localZone,
      ))
        findings.push({ file, line: index + 1, ...finding });
    }
  });
  return { schedules, findings };
}

export function checkCronFiles(
  paths: readonly string[],
  options: CheckOptions,
): CheckResult {
  const files = collect(paths, options.cwd);
  const result: CheckResult = {
    files: files.length,
    schedules: 0,
    findings: [],
  };
  for (const path of files) {
    const text = readFileSync(path, "utf8");
    const file =
      relative(options.cwd, path).split("\\").join("/") || basename(path);
    const checks = isYaml(path)
      ? [checkYaml(text, file, options), checkEventBridge(text, file, options)]
      : isTimer(path)
        ? [checkTimer(text, file, options)]
        : isJenkinsfile(path)
          ? [checkJenkinsfile(text, file, options)]
          : isInfra(path)
            ? [checkEventBridge(text, file, options)]
            : [checkCrontab(text, file, options)];
    for (const checked of checks) {
      result.schedules += checked.schedules;
      result.findings.push(...checked.findings);
    }
  }
  return result;
}

const escapeData = (text: string) =>
  text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (text: string) =>
  escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

export function formatCheck(
  result: CheckResult,
  format: "text" | "github",
): string {
  const errors = result.findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  const warnings = result.findings.length - errors;
  const lines = result.findings.map((finding) => {
    const detail = finding.schedule
      ? ` [${finding.schedule}${finding.zone ? ` in ${finding.zone}` : ""}]`
      : "";
    return format === "github"
      ? `::${finding.severity} file=${escapeProperty(finding.file)},line=${finding.line},title=${escapeProperty("tzmeet cron check")}::${escapeData(finding.message + detail)}`
      : `${finding.file}:${finding.line}: ${finding.severity}: ${finding.message}${detail}`;
  });
  lines.push(
    `Checked ${result.schedules} schedule${result.schedules === 1 ? "" : "s"} in ${result.files} file${result.files === 1 ? "" : "s"}: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`,
  );
  return `${lines.join("\n")}\n`;
}
