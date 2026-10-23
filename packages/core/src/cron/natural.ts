import { listTimeZones } from "../schema.js";
import { timeZoneIdSchema } from "../time-transport.js";
import { compact, convertCronDialect, nativeSetting } from "./convert.js";
import { describeCron } from "./describe.js";
import { parseCron, type CronDialect } from "./parse.js";

export interface NaturalCron {
  input: string;
  dialect: CronDialect;
  expressions: string[];
  zone?: string;
  description: string;
  native?: string;
  problems: string[];
  notes: string[];
}

const dayWords: Record<string, number> = {
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
  sunday: 7,
  sun: 7,
};
const dayNames = ["", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const monthWords = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const ordinals: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
};
const cityAliases: Record<string, string> = {
  utc: "UTC",
  gmt: "UTC",
  "new york city": "America/New_York",
  nyc: "America/New_York",
  "san francisco": "America/Los_Angeles",
  "los angeles": "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  boston: "America/New_York",
  washington: "America/New_York",
  delhi: "Asia/Kolkata",
  "new delhi": "Asia/Kolkata",
  mumbai: "Asia/Kolkata",
  bangalore: "Asia/Kolkata",
  bengaluru: "Asia/Kolkata",
  kolkata: "Asia/Kolkata",
  calcutta: "Asia/Kolkata",
  chennai: "Asia/Kolkata",
  hyderabad: "Asia/Kolkata",
  beijing: "Asia/Shanghai",
  "hong kong": "Asia/Hong_Kong",
  "abu dhabi": "Asia/Dubai",
  lahore: "Asia/Karachi",
  islamabad: "Asia/Karachi",
  chittagong: "Asia/Dhaka",
  "sao paulo": "America/Sao_Paulo",
  toronto: "America/Toronto",
  sydney: "Australia/Sydney",
  melbourne: "Australia/Melbourne",
};
const stopwords = new Set([
  "every",
  "each",
  "at",
  "on",
  "the",
  "of",
  "and",
  "in",
  "a",
  "an",
  "time",
  "o'clock",
  "oclock",
  "run",
  "runs",
  "job",
  "please",
  "day",
  "days",
  "month",
  "to",
]);

export function looksLikeNaturalCron(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("@")) return false;
  if (parseCron(trimmed).ok) return false;
  return /\b(every|each|at|daily|weekly|monthly|hourly|yearly|weekdays?|weekends?|noon|midnight|minutes?|hours?|on|am|pm)\b/i.test(
    trimmed,
  );
}

let zoneIndex: Map<string, string> | undefined;
function zonesByName(): Map<string, string> {
  if (!zoneIndex) {
    zoneIndex = new Map(Object.entries(cityAliases));
    for (const id of listTimeZones()) {
      const name = id.split("/").at(-1)!.replaceAll("_", " ").toLowerCase();
      if (!zoneIndex.has(name)) zoneIndex.set(name, id);
    }
  }
  return zoneIndex;
}

interface Time {
  hour: number;
  minute: number;
}
const timePattern = String.raw`(?:noon|midday|midnight|\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))`;
function readTime(text: string): Time | null {
  const value = text.trim();
  if (value === "noon" || value === "midday") return { hour: 12, minute: 0 };
  if (value === "midnight") return { hour: 0, minute: 0 };
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(value);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match[3] === "pm" ? 12 : 0);
  }
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function parseNaturalCron(
  input: string,
  options: { dialect?: CronDialect } = {},
): NaturalCron {
  const dialect = options.dialect ?? "unix";
  const problems: string[] = [];
  const notes: string[] = [];
  let text = ` ${input
    .toLowerCase()
    .replace(/[,;.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  const take = (pattern: RegExp, use: (match: RegExpExecArray) => void) => {
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      use(match);
      text =
        text.slice(0, match.index) +
        " " +
        text.slice(match.index + match[0].length);
    }
  };

  let zone: string | undefined;
  take(
    /\s(?:in\s)?([a-z]+\/[a-z_]+(?:\/[a-z_]+)?)(?:\stime)?(?=\s)/i,
    (match) => {
      const id = listTimeZones().find(
        (candidate) => candidate.toLowerCase() === match[1]!.toLowerCase(),
      );
      if (id && timeZoneIdSchema.safeParse(id).success) zone = id;
      else problems.push(`Unknown time zone "${match[1]}".`);
    },
  );
  if (!zone) {
    const words = text.trim().split(" ");
    for (let size = 3; size >= 1 && !zone; size--)
      for (let start = 0; start + size <= words.length && !zone; start++) {
        const phrase = words.slice(start, start + size).join(" ");
        const id = zonesByName().get(phrase);
        if (id && !(phrase in dayWords) && !monthWords.includes(phrase)) {
          zone = id;
          const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          take(
            new RegExp(String.raw`\s(?:in\s)?${escaped}(?:\stime)?(?=\s)`),
            () => {},
          );
        }
      }
  }

  let window: [Time, Time] | undefined;
  take(
    new RegExp(
      String.raw`\s(?:between|from)\s(${timePattern}|\d{1,2})\s(?:and|to|until|-)\s(${timePattern}|\d{1,2})(?=\s)`,
    ),
    (match) => {
      const from = readTime(match[1]!);
      const to = readTime(match[2]!);
      if (from && to && from.hour <= to.hour) window = [from, to];
      else problems.push(`Couldn't read the time window "${match[0].trim()}".`);
    },
  );

  let special: string | undefined;
  take(
    /\s(?:on\s)?(?:the\s)?last\s(week)?day\sof\s(?:the\s|each\s|every\s)?month(?=\s)/,
    (match) => {
      special = match[1] ? "dom:LW" : "dom:L";
    },
  );
  take(
    /\s(?:on\s)?(?:the\s)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last)\s(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\s(?:of\s)?(?:the\s|each\s|every\s)?month(?=\s)/,
    (match) => {
      const weekday = dayNames[dayWords[match[2]!]!]!;
      special =
        match[1] === "last"
          ? `dow:${weekday}L`
          : `dow:${weekday}#${ordinals[match[1]!]}`;
    },
  );

  const monthDays = new Set<number>();
  take(
    /\s(?:on\s)?(?:the\s)?(\d{1,2}(?:st|nd|rd|th)(?:\s(?:and\s)?\d{1,2}(?:st|nd|rd|th))*)(?:\s(?:day\s)?of\s(?:the\s|each\s|every\s)?month)?(?=\s)/,
    (match) => {
      for (const day of match[1]!.match(/\d{1,2}/g)!)
        monthDays.add(Number(day));
    },
  );
  take(
    /\sday\s(\d{1,2})(?:\sof\s(?:the\s|each\s|every\s)?month)?(?=\s)/,
    (match) => monthDays.add(Number(match[1])),
  );
  for (const day of monthDays)
    if (day < 1 || day > 31) problems.push(`There's no day ${day} in a month.`);

  let minuteStep: number | undefined;
  let hourStep: number | undefined;
  let dayStep: number | undefined;
  let everyMinute = false;
  let everyHour = false;
  take(/\severy\s(\d+)\s(minute|min|hour|hr|day)s?(?=\s)/, (match) => {
    const value = Number(match[1]);
    if (match[2]!.startsWith("min")) minuteStep = value;
    else if (match[2]!.startsWith("h")) hourStep = value;
    else dayStep = value;
  });
  take(/\s(?:every|each)\sminute(?=\s)/, () => (everyMinute = true));
  take(/\s(?:every|each)\shour(?=\s)|\shourly(?=\s)/, () => (everyHour = true));
  take(/\severy\sother\s(\w+)(?=\s)/, (match) =>
    problems.push(
      `Cron can't do "every other ${match[1]}"; it has no memory of the previous run.`,
    ),
  );

  const times: Time[] = [];
  let atMinute: number | undefined;
  take(
    /\sat\s:(\d{2})(?=\s)|\sat\s(\d{1,2})\s(?:minutes\s)?past(?:\sthe\shour)?(?=\s)/,
    (match) => (atMinute = Number(match[1] ?? match[2])),
  );
  take(
    new RegExp(
      String.raw`\s(?:at\s)?(${timePattern})((?:\s(?:and\s)?(?:${timePattern}))*)(?=\s)`,
    ),
    (match) => {
      for (const value of [
        match[1]!,
        ...(match[2]!.match(new RegExp(timePattern, "g")) ?? []),
      ]) {
        const time = readTime(value);
        if (time) times.push(time);
        else problems.push(`Couldn't read the time "${value}".`);
      }
    },
  );
  take(/\sat\s(\d{1,2})(?=\s)/, (match) => {
    const time = readTime(match[1]!);
    if (time) times.push(time);
    else problems.push(`Couldn't read the time "${match[1]}".`);
  });

  const weekdays = new Set<number>();
  const dayPattern = Object.keys(dayWords).join("|");
  take(
    new RegExp(
      String.raw`\s(${dayPattern})s?\s(?:to|through|thru|-)\s(${dayPattern})s?(?=\s)`,
    ),
    (match) => {
      const from = dayWords[match[1]!]!;
      const to = dayWords[match[2]!]!;
      for (let day = from; ; day = (day % 7) + 1) {
        weekdays.add(day);
        if (day === to) break;
      }
    },
  );
  take(
    /\s(?:every\s|on\s)?(?:weekdays?|workdays?|work\sdays?|business\sdays?)(?=\s)/,
    () => [1, 2, 3, 4, 5].forEach((day) => weekdays.add(day)),
  );
  take(/\s(?:every\s|on\s)?(?:the\s)?weekends?(?=\s)/, () =>
    [6, 7].forEach((day) => weekdays.add(day)),
  );
  take(
    new RegExp(String.raw`\s(?:every\s|on\s)?(${dayPattern})s?(?=\s)`),
    (match) => weekdays.add(dayWords[match[1]!]!),
  );

  const months = new Set<number>();
  take(
    new RegExp(
      String.raw`\s(?:in\s|every\s|each\s)?(${monthWords.join("|")})(?=\s)`,
    ),
    (match) => months.add(monthWords.indexOf(match[1]!) + 1),
  );
  let frequency: "daily" | "weekly" | "monthly" | "yearly" | undefined;
  take(
    /\s(?:daily|nightly|every\s(?:day|night)|each\sday)(?=\s)/,
    () => (frequency ??= "daily"),
  );
  take(
    /\s(?:weekly|every\sweek|each\sweek)(?=\s)/,
    () => (frequency = "weekly"),
  );
  take(
    /\s(?:monthly|every\smonth|each\smonth)(?=\s)/,
    () => (frequency = "monthly"),
  );
  take(
    /\s(?:yearly|annually|every\syear|each\syear)(?=\s)/,
    () => (frequency = "yearly"),
  );

  const leftover = text
    .trim()
    .split(" ")
    .filter((word) => word && !stopwords.has(word));
  if (leftover.length)
    problems.push(
      `Didn't understand: ${leftover.map((word) => `"${word}"`).join(", ")}.`,
    );

  let minute = "0";
  let hours = "*";
  const windowHours = window
    ? window[0].hour === window[1].hour
      ? String(window[0].hour)
      : `${window[0].hour}-${window[1].hour}`
    : "*";
  if (window && window[1].minute > 0)
    notes.push(
      `Runs stop at ${window[1].hour}:00 plus the last step inside that hour.`,
    );
  const minuteGroups = new Map<number, number[]>();
  for (const time of times)
    minuteGroups.set(time.minute, [
      ...(minuteGroups.get(time.minute) ?? []),
      time.hour,
    ]);
  if (everyMinute) {
    minute = "*";
    hours = windowHours;
  } else if (minuteStep) {
    if (minuteStep > 59)
      problems.push("Use hours for steps of 60 minutes or more.");
    minute = `*/${minuteStep}`;
    hours = windowHours;
  } else if (hourStep) {
    if (hourStep > 23) problems.push("Use days for steps of 24 hours or more.");
    minute = String(atMinute ?? times[0]?.minute ?? 0);
    hours = window
      ? `${window[0].hour}-${window[1].hour}/${hourStep}`
      : `*/${hourStep}`;
  } else if (everyHour) {
    minute = String(atMinute ?? 0);
    hours = windowHours;
  } else if (atMinute !== undefined && !times.length) {
    minute = String(atMinute);
    hours = windowHours;
  } else if (times.length) {
    if (window)
      problems.push(
        `A time window only makes sense with a step, e.g. "every 15 minutes between 9am and 5pm".`,
      );
  } else if (!window) {
    if (
      frequency ||
      weekdays.size ||
      monthDays.size ||
      months.size ||
      special ||
      dayStep
    )
      notes.push("No time given, so it runs at midnight (00:00).");
    else problems.push("Couldn't find a time or how often to run.");
    hours = "0";
  }

  let dom = "*";
  let dow = "*";
  let month = months.size ? [...months].sort((a, b) => a - b).join(",") : "*";
  if (dayStep) {
    dom = `*/${dayStep}`;
    notes.push(
      `"Every ${dayStep} days" restarts each month (cron counts days of the month).`,
    );
  }
  if (monthDays.size) dom = [...monthDays].sort((a, b) => a - b).join(",");
  if (weekdays.size)
    dow = compact(
      [...weekdays].map((day) => day % 7),
      0,
      6,
    );
  if (frequency === "weekly" && !weekdays.size) {
    dow = "0";
    notes.push("Weekly runs on Sunday, like @weekly.");
  }
  if (frequency === "monthly" && !monthDays.size && !special) dom = "1";
  if (frequency === "yearly") {
    if (!monthDays.size) dom = "1";
    if (!months.size) month = "1";
  }

  const result = (expressions: string[], extra: string[] = []): NaturalCron => {
    const first = expressions[0] ? parseCron(expressions[0], dialect) : null;
    return {
      input,
      dialect,
      expressions,
      ...(zone ? { zone } : {}),
      description: first?.ok
        ? describeCron(first.cron) + (zone ? ` (${zone})` : "")
        : "",
      ...(zone && expressions[0]
        ? { native: nativeSetting(dialect, expressions[0], zone) }
        : {}),
      problems: [...problems, ...extra],
      notes,
    };
  };
  if (special && (dialect === "unix" || dialect === "kubernetes"))
    problems.push(
      `${special.startsWith("dom") ? "The last day of the month" : "A weekday's position in the month"} needs Spring or Quartz syntax; ${dialect === "unix" ? "Unix cron" : "Kubernetes"} can't express it.`,
    );
  if (problems.length) return result([]);

  const hourLists =
    times.length && !everyMinute && !minuteStep && !hourStep && !everyHour
      ? [...minuteGroups]
      : [[Number(minute), []] as [number, number[]]];
  const built: string[] = [];
  const extra: string[] = [];
  for (const [groupMinute, groupHours] of hourLists) {
    const minuteText = groupHours.length ? String(groupMinute) : minute;
    const hourText = groupHours.length
      ? [...new Set(groupHours)].sort((a, b) => a - b).join(",")
      : hours;
    let source: string;
    let from: CronDialect;
    if (special) {
      const [field, value] = special.split(":") as ["dom" | "dow", string];
      const springDays = [...weekdays]
        .sort((a, b) => a - b)
        .map((day) => dayNames[day])
        .join(",");
      source = `0 ${minuteText} ${hourText} ${field === "dom" ? value : dom} ${month} ${field === "dow" ? value : springDays || "*"}`;
      from = "spring";
    } else {
      source = `${minuteText} ${hourText} ${dom} ${month} ${dow}`;
      from = "unix";
    }
    if (from === dialect) built.push(source);
    else {
      const converted = convertCronDialect(source, { from, to: dialect });
      built.push(...converted.expressions);
      extra.push(...converted.problems);
      for (const note of converted.notes)
        if (!notes.includes(note)) notes.push(note);
    }
  }
  if (hourLists.length > 1)
    notes.push("Times with different minutes need one schedule each.");
  return result(extra.length ? [] : built, extra);
}
