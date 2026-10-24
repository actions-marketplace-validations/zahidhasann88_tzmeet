import { DateTime, IANAZone } from "luxon";
import { timeZoneIdSchema } from "../time-transport.js";
import { scanTransitions } from "../transitions.js";
import { ScheduleInputError } from "../transport-input.js";
import {
  cronDialectName,
  parseCron,
  type CronDialect,
  type CronField,
  type CronPart,
  type ParsedCron,
} from "./parse.js";

export interface CronDialectConversion {
  from: CronDialect;
  to: CronDialect;
  expressions: string[];
  problems: string[];
  notes: string[];
}

export interface CronZonePeriod {
  from: string;
  to: string;
  offsetMinutes: number;
  expressions: string[];
  problems: string[];
}
export interface CronZoneConversion {
  dialect: CronDialect;
  expression: string;
  fromZone: string;
  toZone: string;
  constant: boolean;
  periods: CronZonePeriod[];
  native: string;
  message: string;
}

const dayNames = ["", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const day = 86400000;

function parse(expression: string, dialect?: CronDialect): ParsedCron {
  const parsed = parseCron(expression, dialect);
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
  return parsed.cron;
}

export function compact(
  values: Iterable<number>,
  min: number,
  max: number,
  name: (value: number) => string = String,
): string {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length === max - min + 1) return "*";
  if (sorted.length >= 3) {
    const step = sorted[1]! - sorted[0]!;
    if (
      step > 1 &&
      sorted.every(
        (value, index) => index === 0 || value - sorted[index - 1]! === step,
      ) &&
      sorted.at(-1)! + step > max
    )
      return sorted[0] === min
        ? `*/${step}`
        : `${name(sorted[0]!)}-${name(max)}/${step}`;
  }
  const parts: string[] = [];
  for (let index = 0; index < sorted.length; ) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end]! + 1)
      end++;
    if (end - index >= 2)
      parts.push(`${name(sorted[index]!)}-${name(sorted[end]!)}`);
    else
      for (let item = index; item <= end; item++)
        parts.push(name(sorted[item]!));
    index = end + 1;
  }
  return parts.join(",");
}

function renderField(
  field: CronField,
  min: number,
  max: number,
  wrapOk: boolean,
): string {
  if (
    field.any &&
    field.parts.every((part) => part.kind === "any" && part.step === 1)
  )
    return "*";
  const parts: string[] = [];
  for (const part of field.parts) {
    if (part.kind === "any")
      parts.push(part.step === 1 ? "*" : `*/${part.step}`);
    else if (part.kind === "range") {
      const step = part.step === 1 ? "" : `/${part.step}`;
      if (part.from === part.to) parts.push(String(part.from));
      else if (part.from < part.to)
        parts.push(`${part.from}-${part.to}${step}`);
      else if (wrapOk) parts.push(`${part.from}-${part.to}${step}`);
      else return compact(field.values, min, max);
    }
  }
  return parts.join(",");
}

function renderWeekdays(
  weekdays: Iterable<number>,
  specials: CronPart[],
  dialect: CronDialect,
): string | null {
  const iso = [...new Set(weekdays)];
  const names =
    dialect === "spring" ||
    dialect === "quartz" ||
    dialect === "eventbridge" ||
    dialect === "systemd";
  const extra: string[] = [];
  for (const part of specials) {
    if (!names || dialect === "systemd") return null;
    if (part.kind === "lastWeekdayOf") extra.push(`${dayNames[part.weekday]}L`);
    if (part.kind === "nth") extra.push(`${dayNames[part.weekday]}#${part.n}`);
  }
  if (iso.length === 7 && !extra.length) return "*";
  const quartzOrder = (value: number) => (value % 7) + 1;
  const base = !iso.length
    ? ""
    : dialect === "systemd"
      ? compact(iso, 1, 7, (value) => systemdDays[value]!).replaceAll("-", "..")
      : dialect === "quartz" || dialect === "eventbridge"
        ? compact(
            iso.map(quartzOrder),
            1,
            7,
            (value) => dayNames[value === 1 ? 7 : value - 1]!,
          )
        : names
          ? compact(iso, 1, 7, (value) => dayNames[value]!)
          : compact(
              iso.map((value) => value % 7),
              0,
              6,
            );
  return [base, ...extra].filter(Boolean).join(",");
}

function renderDayOfMonth(
  field: CronField,
  dialect: CronDialect,
): string | null {
  const special = field.parts.filter(
    (part) => part.kind !== "any" && part.kind !== "range",
  );
  if (
    special.length &&
    dialect !== "spring" &&
    dialect !== "quartz" &&
    dialect !== "eventbridge"
  )
    return null;
  const plain: CronField = {
    ...field,
    parts: field.parts.filter(
      (part) => part.kind === "any" || part.kind === "range",
    ),
  };
  const texts = special.map((part) =>
    part.kind === "last"
      ? part.offset
        ? `L-${part.offset}`
        : "L"
      : part.kind === "lastWeekday"
        ? "LW"
        : part.kind === "nearestWeekday"
          ? `${part.day}W`
          : "",
  );
  return [
    plain.parts.length ? renderField(plain, 1, 31, dialect === "quartz") : "",
    ...texts,
  ]
    .filter(Boolean)
    .join(",");
}

interface Texts {
  second: string;
  minute: string;
  hour: string;
  dom: string;
  month: string;
  dow: string;
  year?: string;
}
const systemdDays = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function systemdComponent(
  text: string,
  min: number,
  max: number,
  pad: boolean,
): string {
  const two = (value: string) =>
    pad && /^\d$/.test(value) ? `0${value}` : value;
  return text
    .split(",")
    .map((item) => {
      if (item === "*" || item === "?") return "*";
      const step = /^(?:\*|(\d+)(?:-(\d+))?)\/(\d+)$/.exec(item);
      if (step) {
        const from = Number(step[1] ?? min);
        const to = Number(step[2] ?? max);
        if (to === max) return `${two(String(from))}/${step[3]}`;
        const values: string[] = [];
        for (let value = from; value <= to; value += Number(step[3]))
          values.push(two(String(value)));
        return values.join(",");
      }
      const range = /^(\d+)-(\d+)$/.exec(item);
      return range ? `${two(range[1]!)}..${two(range[2]!)}` : two(item);
    })
    .join(",");
}
const assemble = (dialect: CronDialect, texts: Texts) => {
  if (dialect === "systemd") {
    const date = `${systemdComponent(texts.year ?? "*", 1970, 2199, false)}-${systemdComponent(texts.month, 1, 12, true)}-${systemdComponent(texts.dom, 1, 31, true)}`;
    const time = `${systemdComponent(texts.hour, 0, 23, true)}:${systemdComponent(texts.minute, 0, 59, true)}:${systemdComponent(texts.second, 0, 59, true)}`;
    return `${texts.dow === "*" ? "" : `${texts.dow} `}${date} ${time}`;
  }
  if (dialect === "eventbridge")
    return `cron(${[texts.minute, texts.hour, texts.dom, texts.month, texts.dow, texts.year ?? "*"].join(" ")})`;
  return (
    dialect === "unix" ||
    dialect === "kubernetes" ||
    dialect === "github" ||
    dialect === "jenkins"
      ? [texts.minute, texts.hour, texts.dom, texts.month, texts.dow]
      : [
          texts.second,
          texts.minute,
          texts.hour,
          texts.dom,
          texts.month,
          texts.dow,
          ...(dialect === "quartz" && texts.year ? [texts.year] : []),
        ]
  ).join(" ");
};
/** Dialects whose expressions have no seconds field. */
const minuteOnly = (dialect: CronDialect) =>
  ["unix", "kubernetes", "github", "jenkins", "eventbridge"].includes(dialect);
const sundayFirst = (dialect: CronDialect) =>
  dialect === "quartz" || dialect === "eventbridge";

export function convertCronDialect(
  expression: string,
  options: { from?: CronDialect; to: CronDialect },
): CronDialectConversion {
  const cron = parse(expression, options.from);
  const to = options.to;
  const result: CronDialectConversion = {
    from: cron.dialect,
    to,
    expressions: [],
    problems: [],
    notes: [],
  };
  const target = cronDialectName(to);
  const minuteResolution = minuteOnly(to);
  if (cron.macro) result.notes.push(`${cron.macro} is written out in full.`);
  if (cron.hashed?.length)
    result.notes.push(
      "Jenkins H was replaced by the first possible value; Jenkins itself picks one per job from its name.",
    );
  if (cron.prefixZone)
    result.notes.push(
      `Set the time zone (${cron.prefixZone}) in the scheduler; it isn't part of the expression.`,
    );

  let second = "0";
  if (cron.second) {
    const zeroOnly = cron.second.values.size === 1 && cron.second.values.has(0);
    if (minuteResolution && !zeroOnly)
      result.problems.push(
        `${target} has no seconds field, so it can't run at second ${cron.second.text}.`,
      );
    second = renderField(cron.second, 0, 59, to === "quartz");
  } else if (!minuteResolution)
    result.notes.push(
      `${target} adds a seconds field; runs happen at second 0.`,
    );
  let year: string | undefined;
  if (cron.year && !cron.year.any) {
    if (to !== "quartz" && to !== "eventbridge" && to !== "systemd")
      result.problems.push(
        `${target} has no year field, so it can't limit runs to ${cron.year.text}.`,
      );
    else
      year = renderField(
        cron.year,
        1970,
        to === "quartz" ? 2099 : 2199,
        to === "quartz",
      );
  }

  const minute = renderField(cron.minute, 0, 59, to === "quartz");
  const hour = renderField(cron.hour, 0, 23, to === "quartz");
  const month = renderField(cron.month, 1, 12, to === "quartz");
  const dom = renderDayOfMonth(cron.dayOfMonth, to);
  if (dom === null)
    result.problems.push(
      `${target} doesn't support L or W in day-of-month (${cron.dayOfMonth.text}).`,
    );
  const dowSpecials = cron.dayOfWeek.parts.filter(
    (part) => part.kind === "lastWeekdayOf" || part.kind === "nth",
  );
  const dow = renderWeekdays(cron.dayOfWeek.values, dowSpecials, to);
  if (dow === null)
    result.problems.push(
      `${target} doesn't support L or # in day-of-week (${cron.dayOfWeek.text}).`,
    );
  if (
    sundayFirst(cron.dialect) &&
    !sundayFirst(to) &&
    /\d/.test(cron.dayOfWeek.text)
  )
    result.notes.push(
      `Day-of-week numbers are converted: ${cronDialectName(cron.dialect)} counts Sunday as 1, ${target} counts Monday as 1.`,
    );
  if (result.problems.length) return result;

  const domRestricted = !cron.dayOfMonth.any;
  const dowRestricted = !cron.dayOfWeek.any;
  const build = (domText: string, dowText: string) =>
    assemble(to, {
      second,
      minute,
      hour,
      dom: domText,
      month,
      dow: dowText,
      ...(year ? { year } : {}),
    });
  const quartzDays = (domText: string, dowText: string) =>
    dowText === "*"
      ? [domText, "?"]
      : domText === "*"
        ? ["?", dowText]
        : [domText, dowText];
  const single = (domText: string, dowText: string) => {
    const [d, w] = sundayFirst(to)
      ? quartzDays(domText, dowText)
      : [domText, dowText];
    return build(d!, w!);
  };

  if (!(domRestricted && dowRestricted)) {
    result.expressions.push(
      single(domRestricted ? dom! : "*", dowRestricted ? dow! : "*"),
    );
    return result;
  }
  const twoSchedules = () => {
    result.expressions.push(single(dom!, "*"), single("*", dow!));
    result.notes.push(
      `${target} can't say "day ${cron.dayOfMonth.text} or ${renderWeekdays(cron.dayOfWeek.values, dowSpecials, "quartz")}" in one expression, so this needs two schedules.`,
    );
  };

  const orsDays = to === "unix" || to === "kubernetes" || to === "github";
  if (cron.dayMatch === "or") {
    if (orsDays) result.expressions.push(build(dom!, dow!));
    else twoSchedules();
  } else if (to === "spring" || to === "jenkins" || to === "systemd")
    result.expressions.push(build(dom!, dow!));
  else if ((to === "unix" || to === "github") && dom!.startsWith("*"))
    result.expressions.push(build(dom!, dow!));
  else
    result.problems.push(
      `${target} can't require both day-of-month (${cron.dayOfMonth.text}) and day-of-week (${cron.dayOfWeek.text}); ${sundayFirst(to) ? `${target} allows only one of them` : "it runs when either matches"}.`,
    );
  return result;
}

interface Block {
  dayOffset: number;
  minutes: number[];
  hours: number[];
}

function shiftBlocks(cron: ParsedCron, offset: number): Block[] {
  const everyDay =
    cron.dayOfMonth.any && cron.dayOfWeek.any && cron.month.any && !cron.year;
  const byDay = new Map<number, Map<number, Set<number>>>();
  for (const hour of cron.hour.values)
    for (const minute of cron.minute.values) {
      const total = hour * 60 + minute + offset;
      const dayOffset = everyDay ? 0 : Math.floor(total / 1440);
      const local = ((total % 1440) + 1440) % 1440;
      const hours = byDay.get(dayOffset) ?? new Map<number, Set<number>>();
      const minutes = hours.get(Math.floor(local / 60)) ?? new Set<number>();
      minutes.add(local % 60);
      hours.set(Math.floor(local / 60), minutes);
      byDay.set(dayOffset, hours);
    }
  const blocks: Block[] = [];
  for (const [dayOffset, hours] of [...byDay].sort((a, b) => a[0] - b[0])) {
    const groups = new Map<string, { minutes: number[]; hours: number[] }>();
    for (const [hour, minutes] of [...hours].sort((a, b) => a[0] - b[0])) {
      const sorted = [...minutes].sort((a, b) => a - b);
      const key = sorted.join(",");
      const group = groups.get(key) ?? { minutes: sorted, hours: [] };
      group.hours.push(hour);
      groups.set(key, group);
    }
    for (const group of groups.values()) blocks.push({ dayOffset, ...group });
  }
  return blocks;
}

function shiftedExpressions(
  cron: ParsedCron,
  offset: number,
): { expressions: string[]; problems: string[] } {
  const problems: string[] = [];
  const blocks = shiftBlocks(cron, offset);
  if (blocks.length > 6)
    return {
      expressions: [],
      problems: ["The shifted schedule would need more than 6 expressions."],
    };
  const domRestricted = !cron.dayOfMonth.any;
  const dowSpecial = cron.dayOfWeek.parts.some(
    (part) => part.kind === "lastWeekdayOf" || part.kind === "nth",
  );
  const keepDom = cron.dayOfMonth.text;
  const keepDow = cron.dayOfWeek.text;
  const second = cron.second ? cron.second.text : "0";
  const expressions = blocks.map((block) => {
    let dow = keepDow;
    if (block.dayOffset !== 0) {
      if (domRestricted)
        problems.push(
          `Runs move to the ${block.dayOffset > 0 ? "next" : "previous"} day, which day-of-month (${keepDom}) can't follow.`,
        );
      if (dowSpecial)
        problems.push(
          `Runs move to the ${block.dayOffset > 0 ? "next" : "previous"} day, which ${keepDow} can't follow.`,
        );
      if (!cron.dayOfWeek.any && !dowSpecial)
        dow = renderWeekdays(
          [...cron.dayOfWeek.values].map(
            (value) => ((value - 1 + block.dayOffset + 7) % 7) + 1,
          ),
          [],
          cron.dialect,
        )!;
      if (!cron.month.any && !domRestricted)
        problems.push(
          `Runs near the start or end of a month move into the neighbouring month on ${block.dayOffset > 0 ? "the last day" : "the first day"}.`,
        );
    }
    return assemble(cron.dialect, {
      second,
      minute: compact(block.minutes, 0, 59),
      hour: compact(block.hours, 0, 23),
      dom: keepDom,
      month: cron.month.text,
      dow,
      ...(cron.year ? { year: cron.year.text } : {}),
    });
  });
  return {
    expressions: problems.length ? [] : expressions,
    problems: [...new Set(problems)],
  };
}

export function nativeSetting(
  dialect: CronDialect,
  expression: string,
  zone: string,
): string {
  switch (dialect) {
    case "unix":
      return `CRON_TZ=${zone}\n${expression}`;
    case "kubernetes":
      return `spec:\n  timeZone: "${zone}"\n  schedule: "${expression}"`;
    case "spring":
      return `@Scheduled(cron = "${expression}", zone = "${zone}")`;
    case "quartz":
      return `CronScheduleBuilder.cronSchedule("${expression}")\n    .inTimeZone(TimeZone.getTimeZone("${zone}"))`;
    case "eventbridge": {
      const wrapped = /^cron\(/i.test(expression)
        ? expression
        : `cron(${expression})`;
      return `ScheduleExpression: "${wrapped}"\nScheduleExpressionTimezone: "${zone}"`;
    }
    case "github":
      return `on:\n  schedule:\n    - cron: "${expression}"\n      timezone: "${zone}"`;
    case "jenkins":
      return `TZ=${zone}\n${expression}`;
    case "systemd":
      return `OnCalendar=${expression.replace(/\s+(?:UTC|[A-Za-z_]+\/[A-Za-z_/+-]+)$/, "")} ${zone}`;
  }
}

export function convertCronZone(input: {
  expression: string;
  dialect?: CronDialect;
  fromZone: string;
  toZone: string;
  from: string;
}): CronZoneConversion {
  for (const [path, zone] of [
    ["fromZone", input.fromZone],
    ["toZone", input.toZone],
  ] as const)
    if (!timeZoneIdSchema.safeParse(zone).success)
      throw new ScheduleInputError([
        { path, message: "Unknown IANA time zone", value: zone },
      ]);
  const start = DateTime.fromISO(input.from, { setZone: true });
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(input.from) || !start.isValid)
    throw new ScheduleInputError([
      {
        path: "from",
        message: "from must be an ISO instant with Z or an explicit offset",
        value: input.from,
      },
    ]);
  const cron = parse(input.expression, input.dialect);
  const source = IANAZone.create(input.fromZone);
  const target = IANAZone.create(input.toZone);
  const begin = start.toMillis();
  const end = begin + 366 * day;
  const difference = (millis: number) =>
    target.offset(millis) - source.offset(millis);
  const changes = [
    ...new Set(
      [
        ...scanTransitions(source, begin, end),
        ...scanTransitions(target, begin, end),
      ].map((change) => change.at),
    ),
  ].sort((a, b) => a - b);
  const boundaries = [
    begin,
    ...changes.filter((at) => difference(at) !== difference(at - 1)),
    end,
  ];
  const dateOf = (millis: number) =>
    DateTime.fromMillis(millis, { zone: input.fromZone }).toISODate()!;
  const periods: CronZonePeriod[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const offsetMinutes = difference(boundaries[index]!);
    const shifted = shiftedExpressions(cron, offsetMinutes);
    periods.push({
      from: dateOf(boundaries[index]!),
      to: dateOf(boundaries[index + 1]! - 1),
      offsetMinutes,
      ...shifted,
    });
  }
  const constant =
    new Set(periods.map((period) => period.offsetMinutes)).size === 1;
  const native = nativeSetting(
    cron.dialect,
    cron.expression.replace(/^(?:CRON_)?TZ=\S+\s+/i, ""),
    input.fromZone,
  );
  const gap = (minutes: number) => {
    if (!minutes) return "the same time as";
    const size = Math.abs(minutes);
    const hoursPart = Math.floor(size / 60)
      ? `${Math.floor(size / 60)} hour${Math.floor(size / 60) === 1 ? "" : "s"}`
      : "";
    const minutesPart = size % 60 ? `${size % 60} minutes` : "";
    return `${[hoursPart, minutesPart].filter(Boolean).join(" ")} ${minutes > 0 ? "ahead of" : "behind"}`;
  };

  const gaps = (offsets: number[]) => {
    const unique = [...new Set(offsets)].sort(
      (a, b) => Math.abs(a) - Math.abs(b),
    );
    const sameSide =
      unique.every((value) => value > 0) || unique.every((value) => value < 0);
    if (!sameSide || unique.some((value) => value % 60))
      return unique.map(gap).join(" or ");
    return `${unique.map((value) => Math.abs(value) / 60).join(" or ")} hours ${unique[0]! > 0 ? "ahead of" : "behind"}`;
  };
  const first = periods[0]!;
  const message = constant
    ? first.problems.length
      ? `${input.toZone} is always ${gap(first.offsetMinutes)} ${input.fromZone}, but the schedule can't be shifted exactly. Set the scheduler's time zone instead.`
      : `${input.toZone} is always ${gap(first.offsetMinutes)} ${input.fromZone}, so one expression works all year.`
    : `${input.toZone} is ${gaps(periods.map((period) => period.offsetMinutes))} ${input.fromZone}, depending on daylight saving, so no single expression matches all year. Keep the original schedule and set the scheduler's time zone, or switch expressions on the dates shown.`;
  return {
    dialect: cron.dialect,
    expression: cron.expression,
    fromZone: input.fromZone,
    toZone: input.toZone,
    constant,
    periods,
    native,
    message,
  };
}
