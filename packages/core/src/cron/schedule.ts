import { DateTime, IANAZone } from "luxon";
import { z } from "zod";
import { timeZoneIdSchema } from "../time-transport.js";
import { resolveWall, scanTransitions } from "../transitions.js";
import { ScheduleInputError } from "../transport-input.js";
import { describeCron } from "./describe.js";
import {
  cronDialectName,
  cronDialects,
  parseCron,
  type CronDialect,
  type CronField,
  type CronFieldName,
  type ParsedCron,
} from "./parse.js";

type GapPolicy = "skip" | "catch-up";
type FoldPolicy = "once" | "twice" | "unconfirmed";
function policy(cron: ParsedCron): { gap: GapPolicy; fold: FoldPolicy } {
  switch (cron.dialect) {
    case "unix":
      return cron.fixedTime
        ? { gap: "catch-up", fold: "once" }
        : { gap: "skip", fold: "twice" };
    case "kubernetes":
      return { gap: "skip", fold: "twice" };
    case "spring":
      return { gap: "skip", fold: "unconfirmed" };
    case "quartz":
      return { gap: "skip", fold: "once" };
  }
}

export const cronExplainSchema = z
  .object({
    expression: z.string().min(1, "Enter a cron expression").max(200),
    dialect: z
      .enum(cronDialects as [CronDialect, ...CronDialect[]], {
        errorMap: () => ({
          message: "dialect must be unix, kubernetes, spring or quartz",
        }),
      })
      .optional(),
    zone: timeZoneIdSchema.optional(),
    from: z
      .string()
      .regex(
        /(?:Z|[+-]\d{2}:\d{2})$/,
        "from must be an ISO instant with Z or an explicit offset",
      ),
    count: z.number().int().min(1).max(100).default(10),
    displayZones: z
      .array(timeZoneIdSchema)
      .max(20)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Display zones must be unique",
      )
      .default([]),
  })
  .strict();
export type CronExplainInput = z.input<typeof cronExplainSchema>;

export type CronRunNote =
  | "gap-catch-up"
  | "fold-once"
  | "fold-first"
  | "fold-second"
  | "fold-maybe-twice";
export interface CronRunZone {
  zone: string;
  local: string;
  offsetMinutes: number;
}
export interface CronRun {
  utc: string;
  local: string;
  scheduled: string;
  note?: CronRunNote;
  zones: CronRunZone[];
}
export type CronWarningCode =
  | "dst-skip"
  | "dst-late"
  | "dst-double"
  | "dst-maybe-double"
  | "dst-once"
  | "zone-shift"
  | "dom-dow-or"
  | "dom-dow-and"
  | "quartz-dow-numbering"
  | "zone-assumed"
  | "k8s-inline-timezone"
  | "never-runs";
export interface CronWarning {
  code: CronWarningCode;
  severity: "warning" | "info";
  message: string;
  at?: string;
}
export interface CronExplanation {
  dialect: CronDialect;
  dialectName: string;
  expression: string;
  zone: string;
  description: string;
  fields: { name: CronFieldName; text: string }[];
  runs: CronRun[];
  skipped: { scheduled: string; reason: "gap" }[];
  warnings: CronWarning[];
}

const second = 1000;
const hour = 3600 * second;
const day = 24 * hour;
const horizonYears = 8;
const civilText = (naive: number) => new Date(naive).toISOString().slice(0, 19);
const clock = (naive: number, seconds: boolean) =>
  civilText(naive).slice(11, seconds ? 19 : 16);
const dateOf = (naive: number) => civilText(naive).slice(0, 10);

interface Matcher {
  second: boolean[];
  minute: boolean[];
  hour: boolean[];
  month: boolean[];
  days: (year: number, month: number, date: number) => boolean;
  years: number[] | null;
}

const mask = (
  field: CronField | undefined,
  size: number,
  fallback: number[],
) => {
  const values = field ? field.values : new Set(fallback);
  return Array.from({ length: size }, (_, index) => values.has(index));
};
const daysIn = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const weekdayOf = (year: number, month: number, date: number) =>
  ((new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7) + 1;

function nearestWeekday(year: number, month: number, target: number): number {
  const last = daysIn(year, month);
  const date = Math.min(target, last);
  const weekday = weekdayOf(year, month, date);
  if (weekday === 6) return date === 1 ? 3 : date - 1;
  if (weekday === 7) return date === last ? date - 2 : date + 1;
  return date;
}

function matcher(cron: ParsedCron): Matcher {
  const dom = cron.dayOfMonth;
  const dow = cron.dayOfWeek;
  const domHit = (year: number, month: number, date: number) => {
    if (dom.values.has(date)) return true;
    const last = daysIn(year, month);
    return dom.parts.some((part) => {
      if (part.kind === "last") return date === last - part.offset;
      if (part.kind === "nearestWeekday")
        return date === nearestWeekday(year, month, part.day);
      if (part.kind === "lastWeekday")
        return date === nearestWeekday(year, month, last);
      return false;
    });
  };
  const dowHit = (year: number, month: number, date: number) => {
    const weekday = weekdayOf(year, month, date);
    if (dow.values.has(weekday)) return true;
    return dow.parts.some((part) => {
      if (part.kind === "lastWeekdayOf")
        return part.weekday === weekday && date + 7 > daysIn(year, month);
      if (part.kind === "nth")
        return part.weekday === weekday && Math.ceil(date / 7) === part.n;
      return false;
    });
  };
  return {
    second: mask(cron.second, 60, [0]),
    minute: mask(cron.minute, 60, []),
    hour: mask(cron.hour, 24, []),
    month: mask(cron.month, 13, []),
    days:
      cron.dayMatch === "or"
        ? (y, m, d) => domHit(y, m, d) || dowHit(y, m, d)
        : (y, m, d) => domHit(y, m, d) && dowHit(y, m, d),
    years:
      cron.year && !cron.year.any
        ? [...cron.year.values].sort((a, b) => a - b)
        : null,
  };
}

function nextMatch(m: Matcher, start: number, limit: number): number | null {
  let t = Math.ceil(start / second) * second;
  while (t <= limit) {
    const d = new Date(t);
    const [y, mo, date, h, mi, s] = [
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
    ];
    if (m.years && !m.years.includes(y)) {
      const next = m.years.find((year) => year > y);
      if (next === undefined) return null;
      t = Date.UTC(next, 0, 1);
    } else if (!m.month[mo]) t = Date.UTC(y, mo, 1);
    else if (!m.days(y, mo, date)) t = Date.UTC(y, mo - 1, date + 1);
    else if (!m.hour[h]) t = Date.UTC(y, mo - 1, date, h + 1);
    else if (!m.minute[mi]) t = Date.UTC(y, mo - 1, date, h, mi + 1);
    else if (!m.second[s]) t = Date.UTC(y, mo - 1, date, h, mi, s + 1);
    else return t;
  }
  return null;
}

function issues(error: z.ZodError, input: unknown): ScheduleInputError {
  return new ScheduleInputError(
    error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      value: issue.path.reduce<unknown>(
        (value, key) =>
          value !== null && typeof value === "object"
            ? (value as Record<string, unknown>)[String(key)]
            : undefined,
        input,
      ),
    })),
  );
}

export function explainCron(input: CronExplainInput): CronExplanation {
  const parsedInput = cronExplainSchema.safeParse(input);
  if (!parsedInput.success) throw issues(parsedInput.error, input);
  const { expression, count, displayZones } = parsedInput.data;
  const fromTime = DateTime.fromISO(parsedInput.data.from, { setZone: true });
  if (!fromTime.isValid)
    throw new ScheduleInputError([
      {
        path: "from",
        message: "from must be a valid ISO instant",
        value: parsedInput.data.from,
      },
    ]);
  const parsed = parseCron(expression, parsedInput.data.dialect);
  if (!parsed.ok)
    throw new ScheduleInputError(
      parsed.errors.map((error) => ({
        path:
          error.field === "expression"
            ? "expression"
            : `expression.${error.field}`,
        message: error.message,
        value: error.token ?? expression,
      })),
    );
  const cron = parsed.cron;
  const warnings: CronWarning[] = [];
  const name = cronDialectName(cron.dialect);

  let zone = parsedInput.data.zone;
  if (cron.prefixZone) {
    if (!timeZoneIdSchema.safeParse(cron.prefixZone).success)
      throw new ScheduleInputError([
        {
          path: "expression",
          message: `Unknown IANA time zone in prefix: ${cron.prefixZone}`,
          value: expression,
        },
      ]);
    warnings.push({
      code: "k8s-inline-timezone",
      severity: "warning",
      message:
        "Kubernetes doesn't support CRON_TZ= or TZ= inside the schedule. Set spec.timeZone instead.",
    });
    zone ??= cron.prefixZone;
  }
  if (!zone) {
    zone = "UTC";
    const where = {
      unix: "Unix cron uses the server's local time zone unless CRON_TZ is set",
      kubernetes:
        "Without spec.timeZone, Kubernetes uses the kube-controller-manager's time zone",
      spring:
        "Spring uses the server's default time zone unless @Scheduled sets zone",
      quartz:
        "Quartz uses the scheduler's default time zone unless the trigger sets one",
    }[cron.dialect];
    warnings.push({
      code: "zone-assumed",
      severity: "info",
      message: `${where}. Times below assume UTC.`,
    });
  }

  const tz = IANAZone.create(zone);
  const m = matcher(cron);
  const rules = policy(cron);
  const hasSeconds = Boolean(cron.second);
  const from = fromTime.toMillis();
  const fromCivil = from + tz.offset(from) * 60000;
  const limit = fromCivil + horizonYears * 366 * day;
  const represent = (millis: number, id: string): CronRunZone => {
    const local = DateTime.fromMillis(millis, { zone: id });
    return { zone: id, local: local.toISO()!, offsetMinutes: local.offset };
  };

  const pending: { at: number; scheduled: number; note?: CronRunNote }[] = [];
  const skippedAll: { scheduled: number; would: number }[] = [];
  let cursor = fromCivil - 3 * hour;
  let stopAt = Infinity;
  while (cursor <= Math.min(limit, stopAt)) {
    const match = nextMatch(m, cursor, Math.min(limit, stopAt));
    if (match === null) break;
    cursor = match + second;
    const wall = resolveWall(tz, match);
    const add = (at: number, note?: CronRunNote) => {
      if (at > from)
        pending.push({ at, scheduled: match, ...(note ? { note } : {}) });
    };
    if (wall.change !== undefined) {
      if (rules.gap === "catch-up") add(wall.change, "gap-catch-up");
      else skippedAll.push({ scheduled: match, would: wall.change });
    } else if (wall.instants.length === 2) {
      const [first, last] = wall.instants as [number, number];
      if (rules.fold === "twice") {
        add(first, "fold-first");
        add(last, "fold-second");
      } else
        add(first, rules.fold === "once" ? "fold-once" : "fold-maybe-twice");
    } else add(wall.instants[0]!);
    if (pending.length >= count && stopAt === Infinity)
      stopAt = rules.fold === "twice" ? match + 3 * hour : match;
  }
  pending.sort((a, b) => a.at - b.at);
  const chosen = pending.slice(0, count);
  const lastAt = chosen.at(-1)?.at ?? from;
  const runs: CronRun[] = chosen.map((run) => ({
    utc: DateTime.fromMillis(run.at, { zone: "UTC" }).toISO()!,
    local: represent(run.at, zone!).local,
    scheduled: civilText(run.scheduled),
    ...(run.note ? { note: run.note } : {}),
    zones: displayZones.map((id) => represent(run.at, id)),
  }));
  const skipped = skippedAll
    .filter((entry) => entry.would > from && entry.would <= lastAt)
    .map((entry) => ({
      scheduled: civilText(entry.scheduled),
      reason: "gap" as const,
    }));

  if (!runs.length)
    warnings.push({
      code: "never-runs",
      severity: "warning",
      message: `This schedule never runs in the next ${horizonYears} years (check for dates like 31 February).`,
    });

  const yearEnd = from + 366 * day;
  for (const change of scanTransitions(tz, from, yearEnd)) {
    const gap = change.offsetAfter > change.offsetBefore;
    const before = change.at + change.offsetBefore * 60000;
    const after = change.at + change.offsetAfter * 60000;
    const windowStart = Math.min(before, after);
    const windowEnd = Math.max(before, after) - second;
    const hit = nextMatch(m, windowStart, windowEnd);
    if (hit === null) continue;
    const at = DateTime.fromMillis(change.at, { zone: "UTC" }).toISO()!;
    const when = `On ${dateOf(before)} in ${zone}`;
    let last = hit;
    for (
      let next = nextMatch(m, last + second, windowEnd);
      next !== null;
      next = nextMatch(m, next + second, windowEnd)
    )
      last = next;
    const several = last !== hit;
    const withSeconds = hasSeconds && (hit % 60000 !== 0 || last % 60000 !== 0);
    const times = several
      ? `${clock(hit, withSeconds)}–${clock(last, withSeconds)}`
      : clock(hit, withSeconds);
    const runs = several
      ? `runs from ${clock(hit, withSeconds)} to ${clock(last, withSeconds)}`
      : `${times} run`;
    const shift = `${clock(before, false)} to ${clock(after, false)}`;
    if (gap && rules.gap === "skip")
      warnings.push({
        code: "dst-skip",
        severity: "warning",
        at,
        message: `${when}, clocks jump from ${shift}, so the ${runs} ${several ? "don't" : "doesn't"} happen that day.`,
      });
    else if (gap)
      warnings.push({
        code: "dst-late",
        severity: "warning",
        at,
        message: `${when}, clocks jump from ${shift}. ${name} runs the ${several ? `jobs due ${times}` : `${times} job`} right after the change, at ${clock(after, false)}.`,
      });
    else if (rules.fold === "twice")
      warnings.push({
        code: "dst-double",
        severity: "warning",
        at,
        message: `${when}, clocks go back from ${shift}, so the ${runs} happen${several ? "" : "s"} twice.`,
      });
    else if (rules.fold === "unconfirmed")
      warnings.push({
        code: "dst-maybe-double",
        severity: "warning",
        at,
        message: `${when}, clocks go back from ${shift}, so ${times} happens twice. ${name} doesn't document what it does then; it may run twice.`,
      });
    else
      warnings.push({
        code: "dst-once",
        severity: "info",
        at,
        message: `${when}, clocks go back from ${shift}. ${times} happens twice, but ${name} runs it only the first time.`,
      });
  }

  if (!cron.hour.any) {
    for (const id of displayZones) {
      if (id === zone) continue;
      const other = IANAZone.create(id);
      const difference = (t: number) => other.offset(t) - tz.offset(t);
      const instants = [
        ...new Set(
          [
            ...scanTransitions(tz, from, yearEnd),
            ...scanTransitions(other, from, yearEnd),
          ].map((change) => change.at),
        ),
      ].sort((a, b) => a - b);
      const shifts: { at: number; text: string }[] = [];
      for (const at of instants) {
        const delta = difference(at) - difference(at - 1);
        if (!delta) continue;
        const minutes = Math.abs(delta);
        const amount =
          minutes % 60
            ? `${minutes} minutes`
            : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
        shifts.push({
          at,
          text: `${amount} ${delta > 0 ? "later" : "earlier"} from ${DateTime.fromMillis(at, { zone: id }).toISODate()}`,
        });
      }
      if (shifts.length)
        warnings.push({
          code: "zone-shift",
          severity: "info",
          at: DateTime.fromMillis(shifts[0]!.at, { zone: "UTC" }).toISO()!,
          message: `On ${id} clocks, runs move ${shifts.map((shift) => shift.text).join(", then ")}.`,
        });
    }
  }

  if (cron.dayMatch === "or")
    warnings.push({
      code: "dom-dow-or",
      severity: "warning",
      message: `Both day-of-month (${cron.dayOfMonth.text}) and day-of-week (${cron.dayOfWeek.text}) are set, so ${name} runs when either one matches, not only when both do.`,
    });
  else if (
    cron.dialect === "spring" &&
    !cron.dayOfMonth.any &&
    !cron.dayOfWeek.any
  )
    warnings.push({
      code: "dom-dow-and",
      severity: "info",
      message: `Spring runs only when both day-of-month (${cron.dayOfMonth.text}) and day-of-week (${cron.dayOfWeek.text}) match. Unix cron would run when either matches.`,
    });
  if (
    cron.dialect === "quartz" &&
    /\d/.test(cron.dayOfWeek.text.replace(/#\d+/g, ""))
  )
    warnings.push({
      code: "quartz-dow-numbering",
      severity: "info",
      message:
        "In Quartz, day-of-week 1 is Sunday and 7 is Saturday. Unix cron and Spring use 1 for Monday.",
    });

  const fieldNames: CronFieldName[] = [
    "second",
    "minute",
    "hour",
    "dayOfMonth",
    "month",
    "dayOfWeek",
    "year",
  ];
  return {
    dialect: cron.dialect,
    dialectName: name,
    expression: cron.expression,
    zone,
    description: describeCron(cron),
    fields: fieldNames.flatMap((field) => {
      const value = cron[field];
      return value ? [{ name: field, text: value.text }] : [];
    }),
    runs,
    skipped,
    warnings,
  };
}
