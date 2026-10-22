import { DateTime } from "luxon";
import {
  parseIcsBusy,
  type IcsBusyResult,
  type NormalizedInput,
} from "@tzmeet/core";

export interface ImportedCalendar {
  name: string;
  text: string;
  remember?: boolean;
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

export const CALENDAR_STORAGE_KEY = "tzmeet:calendars:v1";
export const MAX_REMEMBERED_BYTES = 2 * 1024 * 1024;

export function loadRememberedCalendars(
  storage: Pick<Storage, "getItem"> | null,
): Record<string, ImportedCalendar> {
  try {
    const raw = storage?.getItem(CALENDAR_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const calendars: Record<string, ImportedCalendar> = {};
    for (const [id, value] of Object.entries(parsed)) {
      const calendar = value as Partial<ImportedCalendar>;
      if (
        typeof calendar?.name === "string" &&
        typeof calendar.text === "string"
      )
        calendars[id] = {
          name: calendar.name,
          text: calendar.text,
          remember: true,
        };
    }
    return calendars;
  } catch {
    return {};
  }
}

export function saveRememberedCalendars(
  calendars: Record<string, ImportedCalendar>,
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
): boolean {
  const kept = Object.fromEntries(
    Object.entries(calendars)
      .filter(([, calendar]) => calendar.remember)
      .map(([id, { name, text }]) => [id, { name, text }]),
  );
  try {
    if (!Object.keys(kept).length) {
      storage?.removeItem(CALENDAR_STORAGE_KEY);
      return true;
    }
    const json = JSON.stringify(kept);
    if (!storage || json.length > MAX_REMEMBERED_BYTES) return false;
    storage.setItem(CALENDAR_STORAGE_KEY, json);
    return true;
  } catch {
    return false;
  }
}
