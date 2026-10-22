import { DateTime, IANAZone } from "luxon";
import { timeZoneIdSchema } from "./time-transport.js";
import { ScheduleInputError } from "./transport-input.js";

export interface ZoneTransition {
  at: string;
  kind: "gap" | "fold";
  offsetBefore: number;
  offsetAfter: number;
  localBefore: string;
  localAfter: string;
}

export interface ResolvedInstant {
  utc: string;
  local: string;
  offsetMinutes: number;
}

export type LocalResolution =
  | { status: "ok"; instants: [ResolvedInstant] }
  | { status: "skipped"; instants: []; nextValid: ResolvedInstant }
  | { status: "ambiguous"; instants: [ResolvedInstant, ResolvedInstant] };

const hour = 3600000;
const day = 24 * hour;
const maxRangeYears = 10;

export function zoneOf(id: string): IANAZone {
  if (!timeZoneIdSchema.safeParse(id).success)
    throw new ScheduleInputError([
      { path: "zone", message: "Unknown IANA time zone", value: id },
    ]);
  return IANAZone.create(id);
}
function instant(path: string, iso: string): number {
  const time = DateTime.fromISO(iso, { setZone: true });
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(iso) || !time.isValid)
    throw new ScheduleInputError([
      {
        path,
        message: `${path} must be a valid ISO instant with Z or an explicit offset`,
        value: iso,
      },
    ]);
  return time.toMillis();
}
function represent(id: string, millis: number): ResolvedInstant {
  const local = DateTime.fromMillis(millis, { zone: id });
  return {
    utc: local.toUTC().toISO()!,
    local: local.toISO()!,
    offsetMinutes: local.offset,
  };
}
function locateChange(
  tz: IANAZone,
  low: number,
  high: number,
  offsetBefore: number,
): number {
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (tz.offset(middle) === offsetBefore) low = middle;
    else high = middle;
  }
  return high;
}

/** Instants for a civil time given as naive UTC millis; `change` is set when it falls in a gap. */
export function resolveWall(
  tz: IANAZone,
  naive: number,
): { instants: number[]; change?: number } {
  const before = tz.offset(naive - day);
  const after = tz.offset(naive + day);
  const candidates = new Set([before, tz.offset(naive), after]);
  const instants = [
    ...new Set(
      [...candidates]
        .map((offset) => naive - offset * 60000)
        .filter((millis) => tz.offset(millis) === (naive - millis) / 60000),
    ),
  ].sort((a, b) => a - b);
  if (instants.length) return { instants };
  return {
    instants,
    change: locateChange(
      tz,
      naive - after * 60000,
      naive - before * 60000,
      before,
    ),
  };
}

const wall = (millis: number, offset: number) =>
  DateTime.fromMillis(millis + offset * 60000, { zone: "UTC" }).toFormat(
    "yyyy-MM-dd'T'HH:mm:ss",
  );

export function listTransitions(
  zone: string,
  from: string,
  to: string,
): ZoneTransition[] {
  const tz = zoneOf(zone);
  const start = instant("from", from);
  const end = instant("to", to);
  if (end <= start)
    throw new ScheduleInputError([
      { path: "to", message: "to must be later than from", value: to },
    ]);
  if (end - start > maxRangeYears * 366 * day)
    throw new ScheduleInputError([
      {
        path: "to",
        message: `Range must be at most ${maxRangeYears} years`,
        value: to,
      },
    ]);
  return scanTransitions(tz, start, end).map(({ at, offsetBefore, offsetAfter }) => ({
    at: DateTime.fromMillis(at, { zone: "UTC" }).toISO()!,
    kind: offsetAfter > offsetBefore ? "gap" : "fold",
    offsetBefore,
    offsetAfter,
    localBefore: wall(at, offsetBefore),
    localAfter: wall(at, offsetAfter),
  }));
}

/** Offset changes in [start, end) as millis; assumes changes are more than a day apart. */
export function scanTransitions(
  tz: IANAZone,
  start: number,
  end: number,
): { at: number; offsetBefore: number; offsetAfter: number }[] {
  const transitions: { at: number; offsetBefore: number; offsetAfter: number }[] = [];
  for (let cursor = start - 1; cursor < end; cursor += day) {
    const next = Math.min(cursor + day, end);
    const offsetBefore = tz.offset(cursor);
    if (tz.offset(next) === offsetBefore) continue;
    const at = locateChange(tz, cursor, next, offsetBefore);
    if (at >= end) break;
    transitions.push({ at, offsetBefore, offsetAfter: tz.offset(at) });
  }
  return transitions;
}

export function resolveLocal(
  zone: string,
  localDateTime: string,
): LocalResolution {
  const tz = zoneOf(zone);
  const fail = (): never => {
    throw new ScheduleInputError([
      {
        path: "localDateTime",
        message:
          "localDateTime must be a valid local date/time without offset, e.g. 2026-03-08T02:30",
        value: localDateTime,
      },
    ]);
  };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(localDateTime)) fail();
  const civil = DateTime.fromISO(localDateTime, { zone: "UTC" });
  if (!civil.isValid) fail();
  const naive = civil.toMillis();
  const instants = resolveWall(tz, naive).instants.map((millis) =>
    represent(zone, millis),
  );
  if (instants.length === 2)
    return { status: "ambiguous", instants: [instants[0]!, instants[1]!] };
  if (instants.length === 1) return { status: "ok", instants: [instants[0]!] };
  return {
    status: "skipped",
    instants: [],
    nextValid: represent(zone, naive - tz.offset(naive - day) * 60000),
  };
}
