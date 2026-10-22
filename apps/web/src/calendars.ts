import { DateTime } from "luxon";
import {
  parseIcsBusy,
  type IcsBusyResult,
  type NormalizedInput,
} from "@tzmeet/core";

export interface ImportedCalendar {
  name: string;
  text: string;
}
export type CalendarResult = IcsBusyResult | { error: string };
export const RECURRING_WEEKS = 26;
export const MAX_CALENDAR_BYTES = 5 * 1024 * 1024;

export function readCalendars(
  calendars: Record<string, ImportedCalendar>,
  input: NormalizedInput,
): Record<string, CalendarResult> {
  const anchor = input.zones[0]?.id;
  const start = anchor
    ? DateTime.fromISO(input.startDate, { zone: anchor })
    : DateTime.invalid("no zones");
  const results: Record<string, CalendarResult> = {};
  for (const [id, calendar] of Object.entries(calendars)) {
    if (!input.zones.some((zone) => zone.id === id)) continue;
    if (!start.isValid) {
      results[id] = {
        error: "Set a valid starting date to read this calendar.",
      };
      continue;
    }
    const from = start.minus({ days: 1 });
    const to = from.plus({
      days: Math.max(input.days, RECURRING_WEEKS * 7) + 2,
    });
    try {
      results[id] = parseIcsBusy(calendar.text, {
        from: from.toUTC().toISO()!,
        to: to.toUTC().toISO()!,
        defaultZone: id,
      });
    } catch (error) {
      results[id] = {
        error:
          error instanceof Error
            ? error.message
            : "This calendar couldn't be read.",
      };
    }
  }
  return results;
}

export function withBusy(
  input: NormalizedInput,
  results: Record<string, CalendarResult>,
): NormalizedInput {
  return {
    ...input,
    zones: input.zones.map((zone) => {
      const result = results[zone.id];
      if (!result || "error" in result || !result.busy.length) return zone;
      return { ...zone, busy: [...(zone.busy ?? []), ...result.busy] };
    }),
  };
}
