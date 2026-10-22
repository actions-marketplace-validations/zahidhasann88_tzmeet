export type CronDialect = "unix" | "kubernetes" | "spring" | "quartz";
export const cronDialects: readonly CronDialect[] = [
  "unix",
  "kubernetes",
  "spring",
  "quartz",
];

export type CronFieldName =
  | "second"
  | "minute"
  | "hour"
  | "dayOfMonth"
  | "month"
  | "dayOfWeek"
  | "year";

export interface CronIssue {
  field: CronFieldName | "expression";
  message: string;
  token?: string;
}

export type CronPart =
  | { kind: "any"; step: number }
  | { kind: "range"; from: number; to: number; step: number }
  | { kind: "last"; offset: number }
  | { kind: "nearestWeekday"; day: number }
  | { kind: "lastWeekday" }
  | { kind: "lastWeekdayOf"; weekday: number }
  | { kind: "nth"; weekday: number; n: number };

export interface CronField {
  name: CronFieldName;
  text: string;
  parts: CronPart[];
  values: Set<number>;
  any: boolean;
}

export interface ParsedCron {
  dialect: CronDialect;
  expression: string;
  macro?: string;
  prefixZone?: string;
  second?: CronField;
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
  year?: CronField;
  dayMatch: "and" | "or";
  fixedTime: boolean;
}

export type CronParseResult =
  | { ok: true; cron: ParsedCron }
  | { ok: false; dialect: CronDialect; errors: CronIssue[] };

interface FieldRule {
  name: CronFieldName;
  min: number;
  max: number;
  names?: readonly string[];
  namesFrom?: number;
}

const monthNames = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const macros: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};
const fieldCounts: Record<CronDialect, number[]> = {
  unix: [5],
  kubernetes: [5],
  spring: [6],
  quartz: [6, 7],
};
const dialectNames: Record<CronDialect, string> = {
  unix: "Unix cron",
  kubernetes: "Kubernetes CronJob",
  spring: "Spring",
  quartz: "Quartz",
};
export const cronDialectName = (dialect: CronDialect) => dialectNames[dialect];

function rules(dialect: CronDialect): Record<CronFieldName, FieldRule> {
  const quartz = dialect === "quartz";
  return {
    second: { name: "second", min: 0, max: 59 },
    minute: { name: "minute", min: 0, max: 59 },
    hour: { name: "hour", min: 0, max: 23 },
    dayOfMonth: { name: "dayOfMonth", min: 1, max: 31 },
    month: { name: "month", min: 1, max: 12, names: monthNames, namesFrom: 1 },
    dayOfWeek: quartz
      ? { name: "dayOfWeek", min: 1, max: 7, names: dayNames, namesFrom: 1 }
      : { name: "dayOfWeek", min: 0, max: 7, names: dayNames, namesFrom: 0 },
    year: { name: "year", min: 1970, max: 2099 },
  };
}

export function isoWeekday(dialect: CronDialect, value: number): number {
  if (dialect === "quartz") return ((value + 5) % 7) + 1;
  return value % 7 === 0 ? 7 : value;
}

export function detectDialect(expression: string): CronDialect {
  const text = expression.trim();
  if (/^(?:CRON_)?TZ=/i.test(text)) return "kubernetes";
  if (text.startsWith("@")) return "unix";
  const fields = text.split(/\s+/);
  if (fields.length === 7) return "quartz";
  if (fields.length === 6) return fields.includes("?") ? "quartz" : "spring";
  return "unix";
}

class FieldError extends Error {
  constructor(
    message: string,
    public readonly token: string,
  ) {
    super(message);
  }
}

function parseValue(rule: FieldRule, token: string): number {
  const upper = token.toUpperCase();
  const named = rule.names?.indexOf(upper) ?? -1;
  if (named >= 0) return named + rule.namesFrom!;
  if (!/^\d+$/.test(token))
    throw new FieldError(
      `"${token}" is not a valid ${label(rule.name)} value`,
      token,
    );
  const value = Number(token);
  if (value < rule.min || value > rule.max)
    throw new FieldError(
      `${label(rule.name)} must be ${rule.min}–${rule.max}, got ${value}`,
      token,
    );
  return value;
}

function label(name: CronFieldName): string {
  return {
    second: "second",
    minute: "minute",
    hour: "hour",
    dayOfMonth: "day of month",
    month: "month",
    dayOfWeek: "day of week",
    year: "year",
  }[name];
}

function parsePart(
  dialect: CronDialect,
  rule: FieldRule,
  token: string,
): CronPart {
  const specials = dialect === "spring" || dialect === "quartz";
  const upper = token.toUpperCase();
  if (rule.name === "dayOfMonth" && specials) {
    if (upper === "L") return { kind: "last", offset: 0 };
    if (upper === "LW") return { kind: "lastWeekday" };
    const lastOffset = /^L-(\d+)$/.exec(upper);
    if (lastOffset) {
      const offset = Number(lastOffset[1]);
      if (offset > 30)
        throw new FieldError(`"${token}" offset must be 0–30`, token);
      return { kind: "last", offset };
    }
    const weekday = /^(\d+)W$/.exec(upper);
    if (weekday)
      return { kind: "nearestWeekday", day: parseValue(rule, weekday[1]!) };
  }
  if (rule.name === "dayOfWeek" && specials) {
    if (upper === "L" && dialect === "quartz")
      return { kind: "range", from: 7, to: 7, step: 1 };
    const last = /^(\w+)L$/.exec(upper);
    if (last)
      return {
        kind: "lastWeekdayOf",
        weekday: isoWeekday(dialect, parseValue(rule, last[1]!)),
      };
    const nth = /^(\w+)#(\d+)$/.exec(upper);
    if (nth) {
      const n = Number(nth[2]);
      if (n < 1 || n > 5)
        throw new FieldError(
          `"${token}": the number after # must be 1–5`,
          token,
        );
      return {
        kind: "nth",
        weekday: isoWeekday(dialect, parseValue(rule, nth[1]!)),
        n,
      };
    }
  }
  if (/[LW#]/i.test(token) && !rule.names?.some((name) => upper.includes(name)))
    throw new FieldError(
      specials
        ? `"${token}" isn't valid in the ${label(rule.name)} field`
        : `${dialectNames[dialect]} doesn't support L, W or # ("${token}")`,
      token,
    );

  const [range, stepText, extra] = token.split("/");
  if (extra !== undefined || range === "" || stepText === "")
    throw new FieldError(`"${token}" is not a valid step`, token);
  let step = 1;
  if (stepText !== undefined) {
    if (!/^\d+$/.test(stepText) || Number(stepText) < 1)
      throw new FieldError(
        `step in "${token}" must be a positive number`,
        token,
      );
    step = Number(stepText);
  }
  if (range === "*" || range === "?") {
    if (range === "?" && stepText !== undefined)
      throw new FieldError(`"?" can't have a step`, token);
    return { kind: "any", step };
  }
  const bounds = range!.split("-");
  if (bounds.length > 2)
    throw new FieldError(`"${token}" is not a valid range`, token);
  const from = parseValue(rule, bounds[0]!);
  // "5/15" means "5-max/15".
  const to =
    bounds.length === 2
      ? parseValue(rule, bounds[1]!)
      : stepText !== undefined
        ? rule.max
        : from;
  if (from > to && dialect !== "quartz")
    throw new FieldError(
      `range "${token}" runs backwards; ${dialectNames[dialect]} doesn't wrap ranges`,
      token,
    );
  return { kind: "range", from, to, step };
}

function expand(
  dialect: CronDialect,
  rule: FieldRule,
  part: CronPart,
  values: Set<number>,
) {
  const add = (value: number) =>
    values.add(rule.name === "dayOfWeek" ? isoWeekday(dialect, value) : value);
  if (part.kind === "any") {
    for (let value = rule.min; value <= rule.max; value += part.step)
      add(value);
  } else if (part.kind === "range") {
    const size = rule.max - rule.min + 1;
    const span =
      part.from <= part.to ? part.to - part.from : part.to - part.from + size;
    for (let k = 0; k <= span; k += part.step)
      add(rule.min + ((part.from - rule.min + k) % size));
  }
}

function parseField(
  dialect: CronDialect,
  rule: FieldRule,
  text: string,
): CronField {
  const parts = text.split(",").map((token) => {
    if (token === "") throw new FieldError(`empty item in "${text}"`, text);
    return parsePart(dialect, rule, token);
  });
  const values = new Set<number>();
  for (const part of parts) expand(dialect, rule, part, values);
  const size = rule.name === "dayOfWeek" ? 7 : rule.max - rule.min + 1;
  const any =
    parts.every((part) => part.kind === "any" || part.kind === "range") &&
    values.size === size;
  return { name: rule.name, text, parts, values, any };
}

export function parseCron(
  expression: string,
  dialect: CronDialect = detectDialect(expression),
): CronParseResult {
  const errors: CronIssue[] = [];
  const fail = (message: string): CronParseResult => ({
    ok: false,
    dialect,
    errors: [{ field: "expression", message }],
  });
  let text = expression.trim();
  if (!text) return fail("Enter a cron expression");
  if (text.length > 200)
    return fail("Expression must be at most 200 characters");

  let prefixZone: string | undefined;
  const prefix = /^(?:CRON_)?TZ=(\S+)\s+/i.exec(text);
  if (prefix) {
    if (dialect !== "kubernetes")
      return fail(
        `${dialectNames[dialect]} doesn't accept a CRON_TZ=/TZ= prefix in the expression`,
      );
    prefixZone = prefix[1];
    text = text.slice(prefix[0].length);
  }

  let macro: string | undefined;
  if (text.startsWith("@")) {
    macro = text.toLowerCase();
    if (dialect === "quartz")
      return fail("Quartz doesn't support @ shortcuts like @daily");
    if (macro === "@reboot")
      return fail(
        "@reboot runs once at startup, so it has no schedule to explain",
      );
    if (macro.startsWith("@every"))
      return fail(
        "@every is a fixed interval, not a clock schedule, so DST doesn't affect it",
      );
    const expanded = macros[macro];
    if (!expanded) return fail(`Unknown shortcut "${text}"`);
    text = dialect === "spring" ? `0 ${expanded}` : expanded;
  }

  const fields = text.split(/\s+/);
  const counts = fieldCounts[dialect];
  if (!counts.includes(fields.length)) {
    const expected = dialect === "quartz" ? "6 or 7" : String(counts[0]);
    const order =
      dialect === "unix" || dialect === "kubernetes"
        ? "minute hour day-of-month month day-of-week"
        : `second minute hour day-of-month month day-of-week${dialect === "quartz" ? " [year]" : ""}`;
    return fail(
      `${dialectNames[dialect]} expects ${expected} fields (${order}), got ${fields.length}`,
    );
  }

  const names: CronFieldName[] =
    fields.length === 5
      ? ["minute", "hour", "dayOfMonth", "month", "dayOfWeek"]
      : ([
          "second",
          "minute",
          "hour",
          "dayOfMonth",
          "month",
          "dayOfWeek",
          "year",
        ].slice(0, fields.length) as CronFieldName[]);
  const fieldRules = rules(dialect);
  const parsed: Partial<Record<CronFieldName, CronField>> = {};
  names.forEach((name, index) => {
    const raw = fields[index]!;
    try {
      if (raw.includes("?") && name !== "dayOfMonth" && name !== "dayOfWeek")
        throw new FieldError(
          `"?" is only allowed in day-of-month or day-of-week`,
          raw,
        );
      if (raw.includes("?") && dialect === "unix")
        throw new FieldError(`Unix cron doesn't support "?"; use "*"`, raw);
      parsed[name] = parseField(dialect, fieldRules[name], raw);
    } catch (error) {
      if (!(error instanceof FieldError)) throw error;
      errors.push({ field: name, message: error.message, token: error.token });
    }
  });

  const domText = fields[names.indexOf("dayOfMonth")]!;
  const dowText = fields[names.indexOf("dayOfWeek")]!;
  if (dialect === "quartz" && (domText === "?") === (dowText === "?"))
    errors.push({
      field: domText === "?" ? "dayOfWeek" : "dayOfMonth",
      message:
        domText === "?"
          ? `Quartz allows "?" in only one of day-of-month and day-of-week`
          : `Quartz needs "?" in either day-of-month or day-of-week, e.g. "0 0 12 ? * MON" or "0 0 12 15 * ?"`,
    });
  if (errors.length) return { ok: false, dialect, errors };

  const starts = (value: string) => value.startsWith("*");
  const robfigStar = (field: CronField) =>
    field.parts.some((part) => part.kind === "any" && part.step === 1);
  let dayMatch: "and" | "or" = "and";
  if (dialect === "unix")
    dayMatch = starts(domText) || starts(dowText) ? "and" : "or";
  if (dialect === "kubernetes")
    dayMatch =
      robfigStar(parsed.dayOfMonth!) || robfigStar(parsed.dayOfWeek!)
        ? "and"
        : "or";
  const minuteText = fields[names.indexOf("minute")]!;
  const hourText = fields[names.indexOf("hour")]!;

  return {
    ok: true,
    cron: {
      dialect,
      expression: expression.trim(),
      ...(macro ? { macro } : {}),
      ...(prefixZone ? { prefixZone } : {}),
      ...(parsed.second ? { second: parsed.second } : {}),
      minute: parsed.minute!,
      hour: parsed.hour!,
      dayOfMonth: parsed.dayOfMonth!,
      month: parsed.month!,
      dayOfWeek: parsed.dayOfWeek!,
      ...(parsed.year ? { year: parsed.year } : {}),
      dayMatch,
      fixedTime: dialect === "unix" && !starts(minuteText) && !starts(hourText),
    },
  };
}
