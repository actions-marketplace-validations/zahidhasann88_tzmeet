import { DateTime, IANAZone } from 'luxon';
import { z } from 'zod';
import { listTimeZones } from './schema.js';
import { ScheduleInputError } from './transport-input.js';

/** Shared additive IANA identifier schema for transport helpers. */
export const timeZoneIdSchema = z.string().refine(id => IANAZone.isValidZone(id), 'Unknown IANA time zone');
/** Validated wall-time conversion parameters. Ambiguous times reject unless explicitly resolved. */
export const conversionSchema = z.object({
  time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/, 'time must be an ISO date/time, e.g. 2026-11-02T10:00'),
  from: timeZoneIdSchema,
  to: z.array(timeZoneIdSchema).min(1).max(20).refine(ids => new Set(ids).size === ids.length, 'Destination zones must be unique'),
  disambiguation: z.enum(['reject', 'earlier', 'later']).default('reject')
}).strict();
/** Parameters for a pure, DST-correct timezone conversion. */
export type ConvertTimeInput = z.input<typeof conversionSchema>;
/** Friendly timezone metadata at a particular, explicitly supplied instant. */
export interface TimeZoneInfo { id: string; label: string; offset: string; offsetMinutes: number }
/** Local ISO/format representation retaining the precise applicable offset. */
export interface ConvertedTime extends TimeZoneInfo { localTime: string; formatted: string }
/** A source civil time resolved to UTC and represented in each destination. */
export interface ConvertTimeResult { source: ConvertedTime; utc: string; conversions: ConvertedTime[] }

function asIssue(error: z.ZodError, input: unknown): ScheduleInputError {
  return new ScheduleInputError(error.issues.map(issue => ({
    path: issue.path.join('.'), message: issue.message,
    value: issue.path.reduce<unknown>((value, key) => value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[String(key)] : undefined, input)
  })));
}
function instant(iso: string): DateTime {
  const time = DateTime.fromISO(iso, { setZone: true });
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(iso) || !time.isValid) throw new ScheduleInputError([{ path: 'at', message: 'at must be a valid ISO instant with Z or an explicit offset', value: iso }]);
  return time;
}
function friendly(id: string): string { return id === 'UTC' ? 'UTC' : id.split('/').at(-1)!.replaceAll('_', ' '); }
function information(id: string, time: DateTime): TimeZoneInfo {
  return { id, label: friendly(id), offset: time.toFormat('ZZ'), offsetMinutes: time.offset };
}

/** Get friendly labels and offsets using Luxon at the supplied instant; never reads "now". */
export function getTimeZoneInfo(id: string, at: string): TimeZoneInfo {
  const valid = timeZoneIdSchema.safeParse(id);
  if (!valid.success) throw new ScheduleInputError([{ path: 'id', message: 'Unknown IANA time zone', value: id }]);
  return information(id, instant(at).setZone(id));
}

/**
 * Convert wall time via Luxon only. Nonexistent spring-gap times are rejected,
 * not silently shifted. Autumn folds reject by default; earlier/later chooses
 * the chronological UTC occurrence. An explicit offset must agree with `from`.
 */
export function convertTime(input: ConvertTimeInput): ConvertTimeResult {
  const parsed = conversionSchema.safeParse(input);
  if (!parsed.success) throw asIssue(parsed.error, input);
  const { time, from, to, disambiguation } = parsed.data;
  let source = DateTime.fromISO(time, { zone: from });
  const civilText = time.replace(/(?:Z|[+-]\d{2}:\d{2})$/, '');
  const civil = DateTime.fromISO(civilText, { zone: 'UTC' });
  const components = (date: DateTime) => [date.year, date.month, date.day, date.hour, date.minute, date.second, date.millisecond];
  const failure = (message: string): never => { throw new ScheduleInputError([{ path: 'time', message, value: time }]); };
  if (!source.isValid || !civil.isValid) return failure('time is not a valid calendar date/time');
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(time)) {
    const explicit = DateTime.fromISO(time, { setZone: true });
    if (explicit.offset !== source.offset || JSON.stringify(components(civil)) !== JSON.stringify(components(source))) return failure(`time's explicit offset does not match ${from} at that local time`);
  } else {
    if (JSON.stringify(components(civil)) !== JSON.stringify(components(source))) return failure(`This local time does not exist in ${from} because of a clock/date change`);
    const possible = source.getPossibleOffsets().sort((a, b) => a.toMillis() - b.toMillis());
    if (possible.length > 1) {
      if (disambiguation === 'reject') return failure(`This local time is ambiguous in ${from}; supply an explicit offset or disambiguation=earlier|later`);
      source = possible[disambiguation === 'earlier' ? 0 : possible.length - 1]!;
    }
  }
  const represent = (id: string): ConvertedTime => {
    const local = source.setZone(id).setLocale('en');
    return { ...information(id, local), localTime: local.toISO()!, formatted: local.toFormat('ccc d LLL yyyy, HH:mm ZZZZ') };
  };
  return { source: represent(from), utc: source.toUTC().toISO()!, conversions: to.map(represent) };
}

/** Small bounded edit-distance suggestion from runtime identifiers; never accepts an invalid ID. */
export function suggestTimeZone(id: string): string | null {
  if (id.length > 100) return null;
  const needle = id.toLowerCase();
  let best: string | null = null;
  let distance = 3;
  for (const candidate of listTimeZones()) {
    const value = candidate.toLowerCase();
    if (Math.abs(value.length - needle.length) > distance) continue;
    let previous = Array.from({ length: needle.length + 1 }, (_, i) => i);
    for (let i = 1; i <= value.length; i++) {
      const current = [i];
      for (let j = 1; j <= needle.length; j++) current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (value[i - 1] === needle[j - 1] ? 0 : 1));
      previous = current;
    }
    const score = previous[needle.length]!;
    if (score < distance || (score === distance && best === null)) { best = candidate; distance = score; }
  }
  return best;
}
