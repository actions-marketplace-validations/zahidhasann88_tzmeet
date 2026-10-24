import { holidayCalendarText, type HolidayPreset } from "@tzmeet/core";
import { downloadIcs } from "./invite";

export const API_URL = "https://tzmeet-api.onrender.com";

export function holidayFeedUrl(preset: HolidayPreset): string {
  return `${API_URL}/v1/holidays.ics?preset=${encodeURIComponent(preset)}`;
}

export function webcalUrl(preset: HolidayPreset): string {
  return holidayFeedUrl(preset).replace(/^https:/, "webcal:");
}
export function googleSubscribeUrl(preset: HolidayPreset): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(preset))}`;
}

export function downloadHolidays(
  preset: HolidayPreset,
  now = new Date(),
): void {
  const year = now.getFullYear();
  downloadIcs(
    holidayCalendarText(preset, {
      years: [year, year + 1],
      created: now.toISOString(),
    }),
    `tzmeet-holidays-${preset}-${year}-${year + 1}.ics`,
  );
}
