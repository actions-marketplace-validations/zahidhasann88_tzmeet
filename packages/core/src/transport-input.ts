import { configSchema, validateInput, type NormalizedInput, type ZoneRule } from './schema.js';

/** String-valued scheduling controls shared by CLI flags and REST query parameters. */
export interface ScheduleTextOptions {
  zones?: string;
  date?: string;
  duration?: string;
  days?: string;
  step?: string;
  work?: string;
  zoneWork?: readonly string[];
  weekend?: readonly string[];
  quiet?: string;
  prayerBuffer?: string;
  prayerLocation?: string;
  prayerMethod?: string;
}
/** A parse/validation error pointing to an input field, optionally including its value. */
export interface ScheduleInputIssue { path: string; message: string; value?: unknown }
/** Structured errors for string-based transports; no Node APIs or scheduling calculations. */
export class ScheduleInputError extends Error {
  constructor(public readonly issues: readonly ScheduleInputIssue[]) {
    super(issues.map(issue => issue.message).join('; '));
    this.name = 'ScheduleInputError';
  }
}
const fail = (path: string, message: string, value?: unknown): never => { throw new ScheduleInputError([{ path, message, value }]); };

/** Strict integer syntax (no decimals/exponents), shared with the CLI. Bounds belong to schemas. */
export function parseIntegerOption(value: string | undefined, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return fail(field, `--${field} must be an integer, received ${JSON.stringify(value)}`, value);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fail(field, `--${field} must be a safe integer`, value);
  return number;
}
function window(value: string, field: string): [string, string] {
  const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(value);
  if (!match) return fail(field, `--${field} must use HH:mm-HH:mm, received ${JSON.stringify(value)}`, value);
  return [match[1]!, match[2]!];
}
function assignment(value: string, field: string, zones: ZoneRule[]): { zone: ZoneRule; value: string } {
  const match = /^([^=]+)=(.*)$/.exec(value);
  if (!match) return fail(field, `--${field} must use IANA_ZONE=value`, value);
  const id = match[1]!.trim();
  const zone = zones.find(zone => zone.id === id);
  if (!zone) return fail(field, `--${field}: ${id} is not a selected zone; add it with --zones first`, value);
  return { zone, value: match[2]!.trim() };
}
const weekdayNames: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7
};
function weekends(value: string): number[] {
  if (value === '' || value.toLowerCase() === 'none') return [];
  return value.split(',').map(token => {
    const normalized = token.trim().toLowerCase();
    const weekday = weekdayNames[normalized] ?? (/^[1-7]$/.test(normalized) ? Number(normalized) : undefined);
    if (weekday === undefined) return fail('weekend', `Unknown weekend day ${JSON.stringify(token)}; use mon,tue,wed,thu,fri,sat,sun or none`, token);
    return weekday;
  });
}
function location(value: string): unknown {
  if (!value.includes(',')) return value;
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return fail('prayerLocation', '--prayer-location must be a built-in city or latitude,longitude', value);
  return { lat: Number(match[1]), lng: Number(match[2]) };
}
function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value);
}

/**
 * Parse CLI-style scheduling strings into validated core input. Config/defaults <
 * global options < per-zone options; repeated overrides apply in order. Zone
 * membership/order replacements retain matching config settings. Date must be
 * explicitly provided or present in config: this helper never reads the clock.
 * Calls the existing shared schemas/validateInput; never implements scheduling.
 */
export function parseScheduleInput(options: ScheduleTextOptions, config: unknown = {}): NormalizedInput {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) throw new ScheduleInputError(parsed.error.issues.map(issue => ({ path: ['config', ...issue.path].join('.'), message: `Invalid config: ${issue.path.join('.') || 'config'}: ${issue.message}` })));
  const defaults = parsed.data;
  const configured = defaults.zones ?? [];
  const zones: ZoneRule[] = options.zones === undefined ? configured.map(zone => ({ ...zone })) : options.zones.split(',').map(id => {
    id = id.trim();
    return { ...(configured.find(zone => zone.id === id) ?? {}), id };
  });
  if (!zones.length) return fail('zones', 'Select at least one time zone with --zones Asia/Dhaka,Europe/London or zones in tzmeet.config.json');
  if (options.work !== undefined) {
    const [workStart, workEnd] = window(options.work, 'work');
    zones.forEach(zone => Object.assign(zone, { workStart, workEnd }));
  }
  if (options.quiet !== undefined) {
    const [quietBefore, quietAfter] = window(options.quiet, 'quiet');
    zones.forEach(zone => Object.assign(zone, { quietBefore, quietAfter }));
  }
  for (const override of options.zoneWork ?? []) {
    const { zone, value } = assignment(override, 'zone-work', zones);
    const [workStart, workEnd] = window(value, 'zone-work');
    Object.assign(zone, { workStart, workEnd });
  }
  for (const override of options.weekend ?? []) {
    const { zone, value } = assignment(override, 'weekend', zones);
    zone.weekend = weekends(value);
  }
  let prayer: unknown = defaults.prayer;
  if ([options.prayerLocation, options.prayerMethod, options.prayerBuffer].some(value => value !== undefined)) {
    if (options.prayerLocation === undefined && defaults.prayer === undefined) return fail('prayerLocation', '--prayer-location is required when enabling prayer times; supply a city or latitude,longitude');
    prayer = {
      ...defaults.prayer,
      location: options.prayerLocation === undefined ? defaults.prayer!.location : location(options.prayerLocation),
      method: options.prayerMethod ?? defaults.prayer?.method ?? 'Karachi',
      bufferMinutes: parseIntegerOption(options.prayerBuffer, 'prayer-buffer', defaults.prayer?.bufferMinutes ?? 10)
    };
  }
  const startDate = options.date ?? defaults.startDate;
  if (startDate === undefined) return fail('date', 'date is required in YYYY-MM-DD form');
  const input = {
    zones, startDate, prayer,
    days: parseIntegerOption(options.days, 'days', defaults.days),
    durationMinutes: parseIntegerOption(options.duration, 'duration', defaults.durationMinutes),
    stepMinutes: parseIntegerOption(options.step, 'step', defaults.stepMinutes)
  };
  const checked = validateInput(input);
  if (!checked.success) throw new ScheduleInputError(checked.errors.map(issue => ({ ...issue, message: `${issue.path}: ${issue.message}`, value: valueAtPath(input, issue.path) })));
  return checked.data;
}
