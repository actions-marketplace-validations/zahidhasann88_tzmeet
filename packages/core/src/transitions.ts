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

function zoneOf(id: string): IANAZone {
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
  const transitions: ZoneTransition[] = [];
  for (let cursor = start - 1; cursor < end; cursor += day) {
    const next = Math.min(cursor + day, end);
    const offsetBefore = tz.offset(cursor);
    if (tz.offset(next) === offsetBefore) continue;
    let low = cursor;
    let high = next;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (tz.offset(middle) === offsetBefore) low = middle;
      else high = middle;
    }
    if (high >= end) break;
    const offsetAfter = tz.offset(high);
    transitions.push({
      at: DateTime.fromMillis(high, { zone: "UTC" }).toISO()!,
      kind: offsetAfter > offsetBefore ? "gap" : "fold",
      offsetBefore,
      offsetAfter,
      localBefore: wall(high, offsetBefore),
      localAfter: wall(high, offsetAfter),
    });
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
  const candidates = new Set([
    tz.offset(naive - day),
    tz.offset(naive),
    tz.offset(naive + day),
  ]);
  const matches = [...candidates]
    .map((offset) => naive - offset * 60000)
    .filter((millis) => tz.offset(millis) === (naive - millis) / 60000);
  const instants = [...new Set(matches)]
    .sort((a, b) => a - b)
    .map((millis) => represent(zone, millis));
  if (instants.length === 2)
    return { status: "ambiguous", instants: [instants[0]!, instants[1]!] };
  if (instants.length === 1) return { status: "ok", instants: [instants[0]!] };
  return {
    status: "skipped",
    instants: [],
    nextValid: represent(zone, naive - tz.offset(naive - day) * 60000),
  };
}
