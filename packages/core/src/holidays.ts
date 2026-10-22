export const holidayPresets = {
  BD: "Bangladesh",
  "GB-ENG": "United Kingdom (England and Wales)",
  IN: "India (central government, Delhi)",
  PK: "Pakistan",
  AE: "United Arab Emirates",
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

// [name, Hijri month, Hijri day, days before, days after]
type IslamicRule = [string, number, number, number, number];

/** Islamic holidays from the Umm al-Qura calendar, moved by `shift` days; all approximate. */
function islamicHolidays(
  year: number,
  rules: IslamicRule[],
  shift: number,
): Holiday[] {
  const list: Holiday[] = [];
  // Scan a little either side so holidays spanning New Year are found.
  for (
    let t = utc(year, 1, 1) - 5 * day;
    t <= utc(year, 12, 31) + 5 * day;
    t += day
  ) {
    const date = hijriDate(t);
    if (!date) break;
    for (const [name, month, target, before, after] of rules) {
      if (date.month !== month || date.day !== target) continue;
      const main = t + shift * day;
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

const fixedDates = (
  year: number,
  fixed: [string, number, number][],
): Holiday[] =>
  fixed.map(([name, month, date]) => ({
    date: iso(utc(year, month, date)),
    name,
    approximate: false,
  }));

/**
 * Holidays from yearly government lists, for festivals on lunisolar calendars that
 * can't be calculated here. [date, name, approximate]
 */
const yearly: Partial<
  Record<HolidayPreset, Record<number, [string, string, boolean][]>>
> = {
  // Bangladesh Bank and government lists for 2026.
  BD: {
    2026: [
      ["2026-05-01", "Buddha Purnima", false],
      ["2026-09-04", "Janmashtami", false],
      ["2026-10-20", "Durga Puja (Nabami)", false],
      ["2026-10-21", "Durga Puja (Bijoya Dashami)", false],
    ],
  },
  // DoPT gazetted holidays for central government offices in Delhi/New Delhi:
  // O.M. of 3 July 2025 (2026) and 16 July 2026 (2027). Islamic dates are tentative.
  IN: {
    2026: [
      ["2026-01-26", "Republic Day", false],
      ["2026-03-04", "Holi", false],
      ["2026-03-21", "Id-ul-Fitr", true],
      ["2026-03-26", "Ram Navami", false],
      ["2026-03-31", "Mahavir Jayanti", false],
      ["2026-04-03", "Good Friday", false],
      ["2026-05-01", "Buddha Purnima", false],
      ["2026-05-27", "Id-ul-Zuha (Bakrid)", true],
      ["2026-06-26", "Muharram", true],
      ["2026-08-15", "Independence Day", false],
      ["2026-08-26", "Milad-un-Nabi", true],
      ["2026-09-04", "Janmashtami", false],
      ["2026-10-02", "Mahatma Gandhi's Birthday", false],
      ["2026-10-20", "Dussehra", false],
      ["2026-11-08", "Diwali", false],
      ["2026-11-24", "Guru Nanak's Birthday", false],
      ["2026-12-25", "Christmas Day", false],
    ],
    2027: [
      ["2027-01-26", "Republic Day", false],
      ["2027-03-10", "Id-ul-Fitr", true],
      ["2027-03-23", "Holi", false],
      ["2027-03-26", "Good Friday", false],
      ["2027-04-15", "Ram Navami", false],
      ["2027-04-19", "Mahavir Jayanti", false],
      ["2027-05-17", "Id-ul-Zuha (Bakrid)", true],
      ["2027-05-20", "Buddha Purnima", false],
      ["2027-06-16", "Muharram", true],
      ["2027-08-15", "Independence Day", false],
      ["2027-08-15", "Milad-un-Nabi", true],
      ["2027-08-25", "Janmashtami", false],
      ["2027-10-02", "Mahatma Gandhi's Birthday", false],
      ["2027-10-09", "Dussehra", false],
      ["2027-10-29", "Diwali", false],
      ["2027-11-14", "Guru Nanak's Birthday", false],
      ["2027-12-25", "Christmas Day", false],
    ],
  },
};
const fromList = (preset: HolidayPreset, year: number): Holiday[] =>
  (yearly[preset]?.[year] ?? []).map(([date, name, approximate]) => ({
    date,
    name,
    approximate,
  }));

/** Years covered by a yearly government list, for presets that need one. */
export function holidayListYears(preset: HolidayPreset): number[] {
  return Object.keys(yearly[preset] ?? {}).map(Number);
}

/** A note when a preset can't include everything for this year, else null. */
export function presetNote(preset: HolidayPreset, year: number): string | null {
  const years = holidayListYears(preset);
  if (!years.length || years.includes(year)) return null;
  const range =
    years.length === 1
      ? String(years[0])
      : `${Math.min(...years)}–${Math.max(...years)}`;
  return preset === "IN"
    ? `Only fixed national holidays and Good Friday are included for ${year}. Festival dates come from the government's yearly list, which tzmeet has for ${range}.`
    : `Hindu and Buddhist holidays come from the government's yearly list, which tzmeet has for ${range}; add ${year}'s dates by hand.`;
}

function bangladesh(year: number): Holiday[] {
  return [
    ...fixedDates(year, [
      ["Shaheed Day and International Mother Language Day", 2, 21],
      ["Independence Day", 3, 26],
      ["Pohela Boishakh (Bengali New Year)", 4, 14],
      ["May Day", 5, 1],
      ["Victory Day", 12, 16],
      ["Christmas Day", 12, 25],
    ]),
    ...islamicHolidays(
      year,
      [
        ["Eid al-Fitr", 10, 1, 1, 1],
        ["Eid al-Adha", 12, 10, 1, 1],
        ["Ashura", 1, 10, 0, 0],
        ["Eid-e-Milad-un-Nabi", 3, 12, 0, 0],
      ],
      1,
    ),
    ...fromList("BD", year),
  ];
}

function india(year: number): Holiday[] {
  if (holidayListYears("IN").includes(year)) return fromList("IN", year);
  return [
    ...fixedDates(year, [
      ["Republic Day", 1, 26],
      ["Independence Day", 8, 15],
      ["Mahatma Gandhi's Birthday", 10, 2],
      ["Christmas Day", 12, 25],
    ]),
    {
      date: iso(easter(year) - 2 * day),
      name: "Good Friday",
      approximate: false,
    },
  ];
}

function pakistan(year: number): Holiday[] {
  return [
    ...fixedDates(year, [
      ["Kashmir Day", 2, 5],
      ["Pakistan Day", 3, 23],
      ["Labour Day", 5, 1],
      ["Youm-e-Takbeer", 5, 28],
      ["Independence Day", 8, 14],
      ["Iqbal Day", 11, 9],
      ["Quaid-e-Azam Day", 12, 25],
    ]),
    ...islamicHolidays(
      year,
      [
        ["Eid ul-Fitr", 10, 1, 0, 2],
        ["Eid ul-Adha", 12, 10, 1, 1],
        ["Ashura", 1, 10, 1, 0],
        ["Eid Milad-un-Nabi", 3, 12, 0, 0],
      ],
      0,
    ),
  ];
}

function unitedArabEmirates(year: number): Holiday[] {
  return [
    ...fixedDates(year, [
      ["New Year's Day", 1, 1],
      ["National Day", 12, 2],
      ["National Day holiday", 12, 3],
    ]),
    ...islamicHolidays(
      year,
      [
        ["Eid al-Fitr", 10, 1, 1, 2],
        ["Arafat Day", 12, 9, 0, 0],
        ["Eid al-Adha", 12, 10, 0, 2],
        ["Islamic New Year", 1, 1, 0, 0],
        ["Prophet Muhammad's Birthday", 3, 12, 0, 0],
      ],
      0,
    ),
  ];
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
  const list = {
    US: unitedStates,
    "GB-ENG": englandAndWales,
    BD: bangladesh,
    IN: india,
    PK: pakistan,
    AE: unitedArabEmirates,
  }[preset](year);
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
  if (zoneId === "Asia/Kolkata" || zoneId === "Asia/Calcutta") return "IN";
  if (zoneId === "Asia/Karachi") return "PK";
  if (zoneId === "Asia/Dubai") return "AE";
  if (
    usZones.has(zoneId) ||
    /^America\/(?:Indiana|Kentucky|North_Dakota)\//.test(zoneId)
  )
    return "US";
  return undefined;
}
