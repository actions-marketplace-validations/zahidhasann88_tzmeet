import { DateTime } from "luxon";
import {
  classifySpans,
  defaultWeekend,
  holidayPresetIds,
  presetHolidays,
  timeZoneIdSchema,
  zoneSchema,
  type HolidayPreset,
  type ZoneRule,
} from "@tzmeet/core";

export interface MeState {
  name: string;
  zone: string;
  workStart: string;
  workEnd: string;
  weekend: number[];
  holidayPreset?: HolidayPreset;
}

export const ME_ROUTE = "#/me";
export const isMeRoute = (hash: string) =>
  hash === ME_ROUTE || hash.startsWith(`${ME_ROUTE}?`);

export function defaultMeState(zone: string): MeState {
  return {
    name: "",
    zone,
    workStart: "09:00",
    workEnd: "18:00",
    weekend: defaultWeekend(zone),
  };
}

export function meZoneRule(state: MeState): ZoneRule {
  const shift = (time: string, minutes: number) =>
    DateTime.fromFormat(time, "HH:mm", { zone: "UTC" })
      .plus({ minutes })
      .toFormat("HH:mm");
  return {
    id: state.zone,
    label: state.name || state.zone.split("/").at(-1)!.replaceAll("_", " "),
    workStart: state.workStart,
    workEnd: state.workEnd,
    quietBefore: shift(state.workStart, -60),
    quietAfter: shift(state.workEnd, 60),
    weekend: state.weekend,
    ...(state.holidayPreset ? { holidayPreset: state.holidayPreset } : {}),
  };
}

export function parseMeHash(hash: string): MeState | null {
  if (!isMeRoute(hash)) return null;
  const params = new URLSearchParams(hash.slice(ME_ROUTE.length + 1));
  const zone = params.get("z");
  if (!zone || !timeZoneIdSchema.safeParse(zone).success) return null;
  const state = defaultMeState(zone);
  state.name = (params.get("n") ?? "").slice(0, 40);
  const work = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(params.get("w") ?? "");
  if (work) [state.workStart, state.workEnd] = [work[1]!, work[2]!];
  const days = params.get("d");
  if (days !== null && /^[1-7]*$/.test(days))
    state.weekend = [...new Set([...days].map(Number))].sort();
  const preset = params.get("h");
  if (preset && (holidayPresetIds as readonly string[]).includes(preset))
    state.holidayPreset = preset as HolidayPreset;
  return zoneSchema.safeParse(meZoneRule(state)).success ? state : null;
}

export function meHash(state: MeState): string {
  const params = new URLSearchParams();
  if (state.name) params.set("n", state.name);
  params.set("z", state.zone);
  params.set("w", `${state.workStart}-${state.workEnd}`);
  params.set("d", state.weekend.join(""));
  if (state.holidayPreset) params.set("h", state.holidayPreset);
  return `${ME_ROUTE}?${params}`;
}

export function meShareLink(state: MeState, href: string): string {
  return `${new URL("me/", href.split(/[?#]/)[0]).href}#${meHash(state).split("?")[1]}`;
}

export type Availability = "work" | "reachable" | "off";
const kindOf = (classification: string): Availability =>
  classification === "ideal"
    ? "work"
    : classification === "acceptable"
      ? "reachable"
      : "off";

export function availabilityGrid(
  state: MeState,
  viewerZone: string,
  now: Date,
  days = 7,
): { date: string; label: string; cells: Availability[] }[] {
  const first = DateTime.fromJSDate(now, { zone: viewerZone }).startOf("day");
  const rows = Array.from({ length: days }, (_, index) =>
    first.plus({ days: index }),
  );
  const spans = rows.flatMap((row) =>
    Array.from({ length: 48 }, (_, cell) => {
      const start = row.set({
        hour: Math.floor(cell / 2),
        minute: (cell % 2) * 30,
      });
      return {
        start: start.toUTC().toISO()!,
        end: start.plus({ minutes: 30 }).toUTC().toISO()!,
      };
    }),
  );
  const kinds = classifySpans(meZoneRule(state), spans).map((evaluation) =>
    kindOf(evaluation.classification),
  );
  return rows.map((row, index) => ({
    date: row.toISODate()!,
    label: row.setLocale("en").toFormat("ccc d LLL"),
    cells: kinds.slice(index * 48, index * 48 + 48),
  }));
}

export function statusNow(
  state: MeState,
  now: Date,
): { kind: Availability; local: string } {
  const start = DateTime.fromJSDate(now).toUTC();
  const [evaluation] = classifySpans(meZoneRule(state), [
    { start: start.toISO()!, end: start.plus({ minutes: 1 }).toISO()! },
  ]);
  return {
    kind: kindOf(evaluation!.classification),
    local: start.setZone(state.zone).setLocale("en").toFormat("ccc HH:mm"),
  };
}

export function nextWorkingTime(state: MeState, now: Date): string | null {
  const start = DateTime.fromJSDate(now).toUTC().startOf("minute");
  const first = start.plus({ minutes: (15 - (start.minute % 15)) % 15 });
  const spans = Array.from({ length: 14 * 96 }, (_, index) => {
    const at = first.plus({ minutes: index * 15 });
    return { start: at.toISO()!, end: at.plus({ minutes: 15 }).toISO()! };
  });
  const evaluations = classifySpans(meZoneRule(state), spans);
  const index = evaluations.findIndex(
    (evaluation) => evaluation.classification === "ideal",
  );
  return index < 0 ? null : spans[index]!.start;
}

export function upcomingHolidays(
  state: MeState,
  now: Date,
  days = 30,
): { date: string; name: string }[] {
  if (!state.holidayPreset) return [];
  const today = DateTime.fromJSDate(now, { zone: state.zone }).toISODate()!;
  const until = DateTime.fromJSDate(now, { zone: state.zone })
    .plus({ days })
    .toISODate()!;
  const year = Number(today.slice(0, 4));
  return [
    ...presetHolidays(state.holidayPreset, year),
    ...presetHolidays(state.holidayPreset, year + 1),
  ]
    .filter((holiday) => holiday.date >= today && holiday.date <= until)
    .map(({ date, name }) => ({ date, name }));
}
