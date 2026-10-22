import {
  isoWeekday,
  type CronDialect,
  type CronField,
  type CronPart,
  type ParsedCron,
} from "./parse.js";

const weekdays = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const months = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const ordinals = ["", "first", "second", "third", "fourth", "fifth"];
const pad = (value: number) => String(value).padStart(2, "0");

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function singles(field: CronField): number[] | null {
  const values: number[] = [];
  for (const part of field.parts) {
    if (part.kind !== "range" || part.from !== part.to) return null;
    values.push(part.from);
  }
  return values;
}

function rangeText(
  part: Extract<CronPart, { kind: "range" }>,
  name: (value: number) => string,
  unit: string,
  max?: number,
): string {
  if (part.from === part.to) return name(part.from);
  if (part.step > 1 && part.to === max)
    return `every ${part.step} ${unit} starting at ${name(part.from)}`;
  const span = `${name(part.from)} through ${name(part.to)}`;
  return part.step === 1 ? span : `every ${part.step} ${unit} from ${span}`;
}

function generic(
  field: CronField,
  unit: string,
  units: string,
  name: (value: number) => string,
  min: number,
  max: number,
): string {
  return list(
    field.parts.map((part) => {
      if (
        part.kind === "any" ||
        (part.kind === "range" && part.from === min && part.to === max)
      )
        return part.step === 1
          ? `every ${unit}`
          : `every ${part.step} ${units}`;
      if (part.kind === "range") return rangeText(part, name, units, max);
      return "";
    }),
  );
}

function timePhrase(cron: ParsedCron): string {
  const seconds = cron.second ? singles(cron.second) : [0];
  const minutes = singles(cron.minute);
  const hours = singles(cron.hour);
  if (
    seconds?.length === 1 &&
    minutes?.length === 1 &&
    hours &&
    hours.length <= 6
  ) {
    const suffix = seconds[0] ? `:${pad(seconds[0])}` : "";
    return `At ${list(hours.map((hour) => `${pad(hour)}:${pad(minutes[0]!)}${suffix}`))}`;
  }
  const phrases: string[] = [];
  if (cron.second && !(seconds?.length === 1 && seconds[0] === 0))
    phrases.push(
      cron.second.any
        ? "every second"
        : seconds
          ? `at second ${list(seconds.map(String))}`
          : generic(cron.second, "second", "seconds", String, 0, 59),
    );
  if (minutes) phrases.push(`at minute ${list(minutes.map(String))}`);
  else phrases.push(generic(cron.minute, "minute", "minutes", String, 0, 59));
  if (!cron.hour.any) {
    if (hours)
      phrases.push(
        `during the ${list(hours.map((hour) => `${pad(hour)}:00`))} hour${hours.length > 1 ? "s" : ""}`,
      );
    else
      phrases.push(
        list(
          cron.hour.parts.map((part) => {
            if (part.kind === "any") return `every ${part.step} hours`;
            if (
              part.kind === "range" &&
              part.step === 1 &&
              part.from !== part.to
            )
              return `from ${pad(part.from)}:00 through ${pad(part.to)}:59`;
            if (part.kind === "range")
              return rangeText(part, (hour) => `${pad(hour)}:00`, "hours", 23);
            return "";
          }),
        ),
      );
  }
  const text = phrases.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dayOfMonthPhrase(field: CronField): string {
  return list(
    field.parts.map((part) => {
      switch (part.kind) {
        case "last":
          return part.offset
            ? `${part.offset} day${part.offset > 1 ? "s" : ""} before the last day of the month`
            : "the last day of the month";
        case "lastWeekday":
          return "the last weekday of the month";
        case "nearestWeekday":
          return `the weekday nearest day ${part.day}`;
        case "range":
          return part.from === part.to
            ? `day ${part.from}`
            : `${rangeText(part, (day) => `day ${day}`, "days")}`;
        case "any":
          return part.step === 1 ? "every day" : `every ${part.step} days`;
        default:
          return "";
      }
    }),
  ).replace(/^(day \d+(?:, day \d+)*(?: and day \d+)?)$/, "$1 of the month");
}

function dayOfWeekPhrase(field: CronField, dialect: CronDialect): string {
  const name = (value: number) => weekdays[isoWeekday(dialect, value)]!;
  return list(
    field.parts.map((part) => {
      switch (part.kind) {
        case "lastWeekdayOf":
          return `the last ${weekdays[part.weekday]} of the month`;
        case "nth":
          return `the ${ordinals[part.n]} ${weekdays[part.weekday]} of the month`;
        case "range":
          return rangeText(part, name, "days");
        case "any":
          return part.step === 1
            ? "every day"
            : `every ${part.step} days of the week`;
        default:
          return "";
      }
    }),
  );
}

export function describeCron(cron: ParsedCron): string {
  const segments = [timePhrase(cron)];
  const dom = cron.dayOfMonth.any ? "" : dayOfMonthPhrase(cron.dayOfMonth);
  const dow = cron.dayOfWeek.any
    ? ""
    : dayOfWeekPhrase(cron.dayOfWeek, cron.dialect);
  if (dom && dow)
    segments.push(
      cron.dayMatch === "or"
        ? `on ${dom}, or on ${dow}`
        : `on ${dom}, but only if it's ${dow}`,
    );
  else if (dom) segments.push(`on ${dom}`);
  else if (dow)
    segments.push(/^\w+ through \w+$/.test(dow) ? dow : `on ${dow}`);
  if (!cron.month.any)
    segments.push(
      `in ${generic(cron.month, "month", "months", (month) => months[month]!, 1, 12)}`,
    );
  if (cron.year && !cron.year.any)
    segments.push(
      `in ${generic(cron.year, "year", "years", String, 1970, 2099)}`,
    );
  return segments.join(", ");
}
