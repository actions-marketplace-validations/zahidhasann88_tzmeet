import { DateTime, IANAZone } from "luxon";
import { ScheduleInputError } from "./transport-input.js";

export interface BusyInterval {
  start: string;
  end: string;
}
export interface IcsBusyOptions {
  from: string;
  to: string;
  defaultZone: string;
}
export interface IcsBusyResult {
  busy: BusyInterval[];
  events: number;
  warnings: string[];
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}
interface When {
  millis: number;
  allDay: boolean;
  zone: string;
  local: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

const day = 86400000;
const maxIntervals = 5000;
const maxIterations = 20000;
const windowsZones: Record<string, string> = {
  UTC: "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau",
  "GTB Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "Turkey Standard Time": "Europe/Istanbul",
  "Russian Standard Time": "Europe/Moscow",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "Canada Central Standard Time": "America/Regina",
  "SA Pacific Standard Time": "America/Bogota",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Buenos_Aires",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "India Standard Time": "Asia/Calcutta",
  "Pakistan Standard Time": "Asia/Karachi",
  "Arabian Standard Time": "Asia/Dubai",
  "Arab Standard Time": "Asia/Riyadh",
  "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "E. Africa Standard Time": "Africa/Nairobi",
  "Israel Standard Time": "Asia/Jerusalem",
  "Iran Standard Time": "Asia/Tehran",
  "Nepal Standard Time": "Asia/Katmandu",
  "Myanmar Standard Time": "Asia/Rangoon",
  "SE Asia Standard Time": "Asia/Bangkok",
  "Singapore Standard Time": "Asia/Singapore",
  "China Standard Time": "Asia/Shanghai",
  "Taipei Standard Time": "Asia/Taipei",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "W. Australia Standard Time": "Australia/Perth",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
};
const weekdayCodes: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};

function parseLine(line: string): Property | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const parts: string[] = [];
  let current = "";
  quoted = false;
  for (const character of line.slice(0, colon)) {
    if (character === '"') quoted = !quoted;
    if (character === ";" && !quoted) {
      parts.push(current);
      current = "";
    } else current += character;
  }
  parts.push(current);
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const equals = part.indexOf("=");
    if (equals > 0)
      params[part.slice(0, equals).toUpperCase()] = part
        .slice(equals + 1)
        .replace(/^"|"$/g, "");
  }
  return {
    name: parts[0]!.toUpperCase(),
    params,
    value: line.slice(colon + 1),
  };
}

function zoneFor(tzid: string | undefined, fallback: string): string | null {
  if (!tzid) return fallback;
  const id = tzid.trim();
  if (IANAZone.isValidZone(id)) return id;
  if (windowsZones[id]) return windowsZones[id]!;
  const segments = id.split("/");
  for (let index = 1; index < segments.length; index++) {
    const candidate = segments.slice(index).join("/");
    if (IANAZone.isValidZone(candidate)) return candidate;
  }
  return null;
}

function parseWhen(
  value: string,
  params: Record<string, string>,
  fallback: string,
): When | "zone" | null {
  const text = value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (date) {
    const local = {
      year: +date[1]!,
      month: +date[2]!,
      day: +date[3]!,
      hour: 0,
      minute: 0,
      second: 0,
    };
    const time = DateTime.fromObject(local, { zone: fallback });
    return time.isValid
      ? { millis: time.toMillis(), allDay: true, zone: fallback, local }
      : null;
  }
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(text);
  if (!stamp) return null;
  const zone = stamp[7] ? "UTC" : zoneFor(params.TZID, fallback);
  if (!zone) return "zone";
  const local = {
    year: +stamp[1]!,
    month: +stamp[2]!,
    day: +stamp[3]!,
    hour: +stamp[4]!,
    minute: +stamp[5]!,
    second: +stamp[6]!,
  };
  const time = DateTime.fromObject(local, { zone });
  return time.isValid
    ? { millis: time.toMillis(), allDay: false, zone, local }
    : null;
}

function parseDuration(value: string): { days: number; millis: number } | null {
  const match =
    /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value.trim(),
    );
  if (!match || value.trim() === "P" || value.trim().endsWith("T")) return null;
  const [weeks, days, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => Number(part ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return {
    days: weeks * 7 + days,
    millis: ((hours * 60 + minutes) * 60 + seconds) * 1000,
  };
}

interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: number;
  byDay: { n?: number; weekday: number }[];
  byMonthDay: number[];
  byMonth: number[];
}

function parseRule(text: string, start: When): Rule | string {
  const parts = Object.fromEntries(
    text
      .split(";")
      .filter(Boolean)
      .map((part) => {
        const [key, value = ""] = part.split("=");
        return [key!.toUpperCase(), value.toUpperCase()];
      }),
  );
  const freq = parts.FREQ;
  if (
    freq !== "DAILY" &&
    freq !== "WEEKLY" &&
    freq !== "MONTHLY" &&
    freq !== "YEARLY"
  )
    return `FREQ=${freq ?? "missing"}`;
  const unsupported = [
    "BYSETPOS",
    "BYWEEKNO",
    "BYYEARDAY",
    "BYHOUR",
    "BYMINUTE",
    "BYSECOND",
  ].filter((key) => key in parts);
  if (unsupported.length) return unsupported.join(", ");
  const byDay = (parts.BYDAY ? parts.BYDAY.split(",") : []).map((token) => {
    const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(token);
    return match
      ? {
          ...(match[1] ? { n: Number(match[1]) } : {}),
          weekday: weekdayCodes[match[2]!]!,
        }
      : null;
  });
  if (byDay.some((entry) => entry === null)) return `BYDAY=${parts.BYDAY}`;
  if (freq === "YEARLY" && byDay.length) return "BYDAY with FREQ=YEARLY";
  if (freq !== "MONTHLY" && byDay.some((entry) => entry!.n !== undefined))
    return `BYDAY=${parts.BYDAY}`;
  let until: number | undefined;
  if (parts.UNTIL) {
    const parsed = parseWhen(parts.UNTIL, {}, start.zone);
    if (!parsed || parsed === "zone") return `UNTIL=${parts.UNTIL}`;
    until = parsed.allDay ? parsed.millis + day - 1 : parsed.millis;
  }
  const numbers = (value?: string) =>
    value ? value.split(",").map(Number) : [];
  return {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
    ...(parts.COUNT ? { count: Number(parts.COUNT) } : {}),
    ...(until !== undefined ? { until } : {}),
    byDay: byDay as Rule["byDay"],
    byMonthDay: numbers(parts.BYMONTHDAY),
    byMonth: numbers(parts.BYMONTH),
  };
}

function expand(start: When, rule: Rule, end: number): number[] {
  const base = DateTime.fromObject(start.local, { zone: start.zone });
  const at = (date: DateTime) =>
    DateTime.fromObject(
      {
        year: date.year,
        month: date.month,
        day: date.day,
        hour: start.local.hour,
        minute: start.local.minute,
        second: start.local.second,
      },
      { zone: start.zone },
    );
  const results: number[] = [start.millis];
  const limit = Math.min(end, rule.until ?? Infinity);
  const unit = {
    DAILY: "day",
    WEEKLY: "week",
    MONTHLY: "month",
    YEARLY: "year",
  } as const;
  const step = {
    DAILY: "days",
    WEEKLY: "weeks",
    MONTHLY: "months",
    YEARLY: "years",
  } as const;
  for (let period = 0; period < maxIterations; period++) {
    const begin = base
      .startOf(unit[rule.freq])
      .plus({ [step[rule.freq]]: period * rule.interval });
    if (begin.toMillis() > limit) return results;
    let dates: DateTime[] = [];
    if (rule.freq === "DAILY") {
      dates = [begin];
    } else if (rule.freq === "WEEKLY") {
      const weekdays = rule.byDay.length
        ? rule.byDay.map((entry) => entry.weekday)
        : [base.weekday];
      dates = weekdays.map((weekday) => begin.plus({ days: weekday - 1 }));
    } else if (rule.freq === "MONTHLY") {
      const size = begin.daysInMonth!;
      if (rule.byMonthDay.length) {
        dates = rule.byMonthDay
          .map((value) => (value < 0 ? size + value + 1 : value))
          .filter((value) => value >= 1 && value <= size)
          .map((value) => begin.set({ day: value }));
      } else if (rule.byDay.length) {
        for (const { n, weekday } of rule.byDay) {
          const matches = Array.from({ length: size }, (_, index) =>
            begin.plus({ days: index }),
          ).filter((date) => date.weekday === weekday);
          if (n === undefined) dates.push(...matches);
          else {
            const match = matches[n > 0 ? n - 1 : matches.length + n];
            if (match) dates.push(match);
          }
        }
      } else if (base.day <= size) dates = [begin.set({ day: base.day })];
    } else {
      for (const month of rule.byMonth.length ? rule.byMonth : [base.month]) {
        const first = begin.set({ month });
        for (const value of rule.byMonthDay.length
          ? rule.byMonthDay
          : [base.day]) {
          const dayOfMonth = value < 0 ? first.daysInMonth! + value + 1 : value;
          if (dayOfMonth >= 1 && dayOfMonth <= first.daysInMonth!)
            dates.push(first.set({ day: dayOfMonth }));
        }
      }
    }
    if (rule.freq === "DAILY" && rule.byDay.length)
      dates = dates.filter((date) =>
        rule.byDay.some((entry) => entry.weekday === date.weekday),
      );
    if (rule.freq === "DAILY" && rule.byMonthDay.length)
      dates = dates.filter((date) => rule.byMonthDay.includes(date.day));
    if (rule.freq !== "YEARLY" && rule.byMonth.length)
      dates = dates.filter((date) => rule.byMonth.includes(date.month));
    for (const millis of dates
      .map((date) => at(date).toMillis())
      .sort((x, y) => x - y)) {
      if (millis <= start.millis) continue;
      if (millis > limit) return results;
      results.push(millis);
      if (rule.count !== undefined && results.length >= rule.count)
        return results;
    }
  }
  return results;
}

export function parseIcsBusy(
  text: string,
  options: IcsBusyOptions,
): IcsBusyResult {
  const from = Date.parse(options.from);
  const to = Date.parse(options.to);
  if (!(to > from))
    throw new ScheduleInputError([
      {
        path: "to",
        message: "to must be a valid ISO instant after from",
        value: options.to,
      },
    ]);
  if (!IANAZone.isValidZone(options.defaultZone))
    throw new ScheduleInputError([
      {
        path: "defaultZone",
        message: "Unknown IANA time zone",
        value: options.defaultZone,
      },
    ]);
  if (!/BEGIN:VCALENDAR/i.test(text))
    throw new ScheduleInputError([
      {
        path: "ics",
        message: "This doesn't look like an iCalendar (.ics) file",
      },
    ]);

  const events: Property[][] = [];
  const stack: string[] = [];
  let current: Property[] | null = null;
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    const property = parseLine(line);
    if (!property) continue;
    if (property.name === "BEGIN") {
      stack.push(property.value.trim().toUpperCase());
      if (stack.at(-1) === "VEVENT") current = [];
    } else if (property.name === "END") {
      if (stack.pop() === "VEVENT" && current) {
        events.push(current);
        current = null;
      }
    } else if (current && stack.at(-1) === "VEVENT") current.push(property);
  }

  const unknownZones = new Set<string>();
  const unsupported = new Map<string, number>();
  let unreadable = 0;
  const read = (property: Property | undefined) => {
    if (!property) return null;
    const when = parseWhen(
      property.value,
      property.params,
      options.defaultZone,
    );
    if (when === "zone") {
      unknownZones.add(property.params.TZID ?? "");
      return null;
    }
    return when;
  };

  const overridden = new Map<string, Set<number>>();
  for (const event of events) {
    const uid = event.find((property) => property.name === "UID")?.value ?? "";
    const when = read(
      event.find((property) => property.name === "RECURRENCE-ID"),
    );
    if (when)
      overridden.set(uid, (overridden.get(uid) ?? new Set()).add(when.millis));
  }

  const spans: [number, number][] = [];
  let busyEvents = 0;
  let truncated = false;
  for (const event of events) {
    const get = (name: string) =>
      event.find((property) => property.name === name);
    if (get("STATUS")?.value.trim().toUpperCase() === "CANCELLED") continue;
    if (get("TRANSP")?.value.trim().toUpperCase() === "TRANSPARENT") continue;
    if (
      get("X-MICROSOFT-CDO-BUSYSTATUS")?.value.trim().toUpperCase() === "FREE"
    )
      continue;
    const startProperty = get("DTSTART");
    const start = read(startProperty);
    if (!start) {
      if (
        startProperty &&
        parseWhen(
          startProperty.value,
          startProperty.params,
          options.defaultZone,
        ) !== "zone"
      )
        unreadable++;
      continue;
    }
    const endProperty = get("DTEND");
    const durationProperty = get("DURATION");
    let length: { days: number; millis: number };
    if (endProperty) {
      const end = read(endProperty);
      if (!end) {
        if (
          parseWhen(
            endProperty.value,
            endProperty.params,
            options.defaultZone,
          ) !== "zone"
        )
          unreadable++;
        continue;
      }
      length =
        start.allDay && end.allDay
          ? {
              days: Math.round(
                DateTime.fromObject(end.local, { zone: "UTC" }).diff(
                  DateTime.fromObject(start.local, { zone: "UTC" }),
                  "days",
                ).days,
              ),
              millis: 0,
            }
          : { days: 0, millis: end.millis - start.millis };
    } else if (durationProperty) {
      const duration = parseDuration(durationProperty.value);
      if (!duration) {
        unreadable++;
        continue;
      }
      length = duration;
    } else
      length = start.allDay ? { days: 1, millis: 0 } : { days: 0, millis: 0 };
    if (length.days <= 0 && length.millis <= 0) continue;
    busyEvents++;

    let starts = [start.millis];
    const ruleProperty = get("RRULE");
    if (ruleProperty && !get("RECURRENCE-ID")) {
      const rule = parseRule(ruleProperty.value, start);
      if (typeof rule === "string")
        unsupported.set(rule, (unsupported.get(rule) ?? 0) + 1);
      else starts = expand(start, rule, to);
      const excluded = new Set(overridden.get(get("UID")?.value ?? "") ?? []);
      for (const property of event.filter((item) => item.name === "EXDATE")) {
        for (const value of property.value.split(",")) {
          const when = parseWhen(value, property.params, start.zone);
          if (when && when !== "zone")
            excluded.add(
              when.allDay && !start.allDay
                ? DateTime.fromObject(
                    {
                      ...when.local,
                      hour: start.local.hour,
                      minute: start.local.minute,
                      second: start.local.second,
                    },
                    { zone: start.zone },
                  ).toMillis()
                : when.millis,
            );
        }
      }
      starts = starts.filter((millis) => !excluded.has(millis));
    }
    for (const millis of starts) {
      const end = length.days
        ? DateTime.fromMillis(millis, { zone: start.zone })
            .plus({ days: length.days })
            .toMillis() + length.millis
        : millis + length.millis;
      if (end <= from || millis >= to) continue;
      if (spans.length >= maxIntervals) {
        truncated = true;
        break;
      }
      spans.push([millis, end]);
    }
  }

  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  const warnings: string[] = [];
  if (unknownZones.size)
    warnings.push(
      `Skipped events in unknown time zones: ${[...unknownZones].map((zone) => JSON.stringify(zone)).join(", ")}.`,
    );
  for (const [reason, count] of unsupported)
    warnings.push(
      `${count} repeating event${count === 1 ? "" : "s"} use${count === 1 ? "s" : ""} an unsupported rule (${reason}); only the first occurrence is used.`,
    );
  if (unreadable)
    warnings.push(
      `Skipped ${unreadable} event${unreadable === 1 ? "" : "s"} with dates that couldn't be read.`,
    );
  if (truncated)
    warnings.push(`Only the first ${maxIntervals} busy times are used.`);
  const iso = (millis: number) => new Date(millis).toISOString();
  return {
    busy: merged.map(([start, end]) => ({ start: iso(start), end: iso(end) })),
    events: busyEvents,
    warnings,
  };
}
