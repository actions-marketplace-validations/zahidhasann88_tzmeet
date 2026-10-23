import { CalculationMethod, Coordinates, PrayerTimes } from "adhan";
import { DateTime } from "luxon";
import { cities, prayerSchema, type PrayerRule } from "./schema.js";
import type { PrayerWindow } from "./types.js";

export function getPrayerWindows(
  date: string,
  rule: PrayerRule,
): PrayerWindow[] {
  const parsed = prayerSchema.parse(rule);
  const civil = DateTime.fromISO(date, { zone: "UTC" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !civil.isValid)
    throw new Error("Prayer date must be a valid YYYY-MM-DD");
  const location =
    typeof parsed.location === "string"
      ? cities[parsed.location]
      : parsed.location;
  const method = parsed.method === "MWL" ? "MuslimWorldLeague" : parsed.method;
  const parameters = CalculationMethod[method]();
  const calendarDate = new Date(civil.year, civil.month - 1, civil.day, 12);
  calendarDate.setFullYear(civil.year);
  const times = new PrayerTimes(
    new Coordinates(location.lat, location.lng),
    calendarDate,
    parameters,
  );
  return (["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).map((name) => {
    const time = DateTime.fromJSDate(times[name], { zone: "UTC" });
    if (!time.isValid)
      throw new Error(
        `Cannot calculate ${name} on ${date} at this location; disable prayer or choose another location/method`,
      );
    return {
      name,
      time: time.toISO()!,
      start: time.minus({ minutes: parsed.bufferMinutes }).toISO()!,
      end: time.plus({ minutes: parsed.bufferMinutes }).toISO()!,
    };
  });
}
