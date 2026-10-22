export const holidayPresets = {
  BD: "Bangladesh",
  "GB-ENG": "United Kingdom (England and Wales)",
  US: "United States (federal)",
} as const;
export type HolidayPreset = keyof typeof holidayPresets;
export const holidayPresetIds = Object.keys(holidayPresets) as [
  HolidayPreset,
  ...HolidayPreset[],
];

export interface Holiday {
  date: string;
  name: string;
  approximate: boolean;
}

const day = 86400000;
const iso = (millis: number) => new Date(millis).toISOString().slice(0, 10);
const utc = (year: number, month: number, date: number) =>
  Date.UTC(year, month - 1, date);
const weekday = (millis: number) =>
  ((new Date(millis).getUTCDay() + 6) % 7) + 1;

function nthWeekday(
  year: number,
  month: number,
  isoDay: number,
  n: number,
): number {
  if (n > 0) {
    const first = utc(year, month, 1);
    return first + (((isoDay - weekday(first) + 7) % 7) + (n - 1) * 7) * day;
  }
  const last = utc(year, month + 1, 0);
  return last - ((weekday(last) - isoDay + 7) % 7) * day;
}

function easter(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return utc(year, month, ((h + l - 7 * m + 114) % 31) + 1);
}

function unitedStates(year: number): Holiday[] {
  const observed = (millis: number) =>
    weekday(millis) === 6
      ? millis - day
      : weekday(millis) === 7
        ? millis + day
        : millis;
  const list: [string, number][] = [
    ["New Year's Day", observed(utc(year, 1, 1))],
    ["Martin Luther King Jr. Day", nthWeekday(year, 1, 1, 3)],
    ["Washington's Birthday", nthWeekday(year, 2, 1, 3)],
    ["Memorial Day", nthWeekday(year, 5, 1, -1)],
    ["Juneteenth", observed(utc(year, 6, 19))],
    ["Independence Day", observed(utc(year, 7, 4))],
    ["Labor Day", nthWeekday(year, 9, 1, 1)],
    ["Columbus Day", nthWeekday(year, 10, 1, 2)],
    ["Veterans Day", observed(utc(year, 11, 11))],
    ["Thanksgiving Day", nthWeekday(year, 11, 4, 4)],
    ["Christmas Day", observed(utc(year, 12, 25))],
  ];
  const nextNewYear = observed(utc(year + 1, 1, 1));
  if (new Date(nextNewYear).getUTCFullYear() === year)
    list.push(["New Year's Day (observed)", nextNewYear]);
  return list
    .map(([name, millis]) => ({ date: iso(millis), name, approximate: false }))
    .filter((holiday) => holiday.date.startsWith(String(year)));
}

function englandAndWales(year: number): Holiday[] {
  const nextWeekday = (millis: number) =>
    weekday(millis) === 6
      ? millis + 2 * day
      : weekday(millis) === 7
        ? millis + day
        : millis;
  const sunday = easter(year);
  const christmas = utc(year, 12, 25);
  const christmasDay = nextWeekday(christmas);
  let boxingDay = nextWeekday(christmas + day);
  if (boxingDay <= christmasDay) boxingDay = nextWeekday(christmasDay + day);
  const list: [string, number][] = [
    ["New Year's Day", nextWeekday(utc(year, 1, 1))],
    ["Good Friday", sunday - 2 * day],
    ["Easter Monday", sunday + day],
    ["Early May bank holiday", nthWeekday(year, 5, 1, 1)],
    ["Spring bank holiday", nthWeekday(year, 5, 1, -1)],
    ["Summer bank holiday", nthWeekday(year, 8, 1, -1)],
    ["Christmas Day", christmasDay],
    ["Boxing Day", boxingDay],
  ];
  return list.map(([name, millis]) => ({
    date: iso(millis),
    name,
    approximate: false,
  }));
}

let hijri: Intl.DateTimeFormat | null | undefined;
function hijriDate(millis: number): { month: number; day: number } | null {
  if (hijri === undefined) {
    const format = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
      timeZone: "UTC",
      month: "numeric",
      day: "numeric",
    });
    hijri =
      format.resolvedOptions().calendar === "islamic-umalqura" ? format : null;
  }
  if (!hijri) return null;
  const parts = hijri.formatToParts(new Date(millis));
  return {
    month: Number(parts.find((part) => part.type === "month")!.value),
    day: Number(parts.find((part) => part.type === "day")!.value),
  };
}

function bangladesh(year: number): Holiday[] {
  const fixed: [string, number, number][] = [
    ["Shaheed Day and International Mother Language Day", 2, 21],
    ["Independence Day", 3, 26],
    ["Pohela Boishakh (Bengali New Year)", 4, 14],
    ["May Day", 5, 1],
    ["Victory Day", 12, 16],
    ["Christmas Day", 12, 25],
  ];
  const list: Holiday[] = fixed.map(([name, month, date]) => ({
    date: iso(utc(year, month, date)),
    name,
    approximate: false,
  }));
  const islamic: [string, number, number, number, number][] = [
    ["Eid al-Fitr", 10, 1, 1, 1],
    ["Eid al-Adha", 12, 10, 1, 1],
    ["Ashura", 1, 10, 0, 0],
    ["Eid-e-Milad-un-Nabi", 3, 12, 0, 0],
  ];
  for (
    let t = utc(year, 1, 1) - 3 * day;
    t <= utc(year, 12, 31) + 3 * day;
    t += day
  ) {
    const date = hijriDate(t);
    if (!date) break;
    for (const [name, month, target, before, after] of islamic) {
      if (date.month !== month || date.day !== target) continue;
      const main = t + day;
      for (let offset = -before; offset <= after; offset++) {
        const when = iso(main + offset * day);
        if (when.startsWith(String(year)))
          list.push({
            date: when,
            name: offset ? `${name} holiday` : name,
            approximate: true,
          });
      }
    }
  }
  return list;
}

export function ramadanDates(
  year: number,
  preset?: HolidayPreset,
): { from: string; to: string } | null {
  const shift = preset === "BD" ? day : 0;
  let from: number | undefined;
  for (let t = utc(year, 1, 1); t <= utc(year, 12, 31) + 31 * day; t += day) {
    const date = hijriDate(t);
    if (!date) return null;
    if (
      from === undefined &&
      date.month === 9 &&
      date.day === 1 &&
      new Date(t).getUTCFullYear() === year
    )
      from = t;
    else if (from !== undefined && date.month === 10)
      return { from: iso(from + shift), to: iso(t - day + shift) };
  }
  return null;
}

export function presetHolidays(preset: HolidayPreset, year: number): Holiday[] {
  const list =
    preset === "US"
      ? unitedStates(year)
      : preset === "GB-ENG"
        ? englandAndWales(year)
        : bangladesh(year);
  return list.sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
}

const usZones = new Set([
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "America/Adak",
  "America/Boise",
  "America/Detroit",
  "America/Juneau",
  "America/Sitka",
  "America/Nome",
  "America/Yakutat",
  "America/Metlakatla",
  "America/Menominee",
  "Pacific/Honolulu",
]);

export function suggestHolidayPreset(
  zoneId: string,
): HolidayPreset | undefined {
  if (zoneId === "Asia/Dhaka") return "BD";
  if (zoneId === "Europe/London") return "GB-ENG";
  if (
    usZones.has(zoneId) ||
    /^America\/(?:Indiana|Kentucky|North_Dakota)\//.test(zoneId)
  )
    return "US";
  return undefined;
}
