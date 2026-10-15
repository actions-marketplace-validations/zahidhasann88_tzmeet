import { DateTime, IANAZone } from 'luxon';
import { z } from 'zod';

/** Built-in coordinates; prayer calculations are approximate, not mosque timetables. */
export const cities = {
  Dhaka: { lat: 23.8103, lng: 90.4125 },
  London: { lat: 51.5074, lng: -0.1278 },
  'New York': { lat: 40.7128, lng: -74.006 },
  Karachi: { lat: 24.8607, lng: 67.0011 },
  Makkah: { lat: 21.3891, lng: 39.8579 },
  Dubai: { lat: 25.2048, lng: 55.2708 },
  Singapore: { lat: 1.3521, lng: 103.8198 }
} as const;

/** Supported adhan calculation methods; MWL is MuslimWorldLeague. */
export const prayerMethods = ['Karachi', 'UmmAlQura', 'MWL', 'Egyptian', 'Dubai', 'MoonsightingCommittee', 'NorthAmerica', 'Kuwait', 'Qatar', 'Singapore', 'Tehran', 'Turkey'] as const;
const cityNames = Object.keys(cities) as [keyof typeof cities, ...(keyof typeof cities)[]];
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Time must use HH:mm (00:00–23:59)');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD').refine(
  value => DateTime.fromISO(value, { zone: 'UTC' }).isValid,
  'Date is not a valid calendar date'
);

/** Shared schema for an optional location-specific prayer rule. */
export const prayerSchema = z.object({
  location: z.union([z.enum(cityNames), z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) }).strict()]),
  method: z.enum(prayerMethods).default('Karachi'),
  bufferMinutes: z.number().int().min(0).max(180).default(10)
}).strict();

/** Zones whose working week is Sunday–Thursday. Every other zone defaults to a Sat/Sun weekend. */
const fridaySaturdayZones = new Set(['Asia/Dhaka', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Jerusalem']);

/** Regional default weekend (ISO weekdays) used when a zone omits `weekend`: [5, 6] for Fri/Sat regions, otherwise [6, 7]. */
export function defaultWeekend(id: string): number[] {
  return fridaySaturdayZones.has(id) ? [5, 6] : [6, 7];
}

const zoneObject = z.object({
  id: z.string().refine(id => IANAZone.isValidZone(id), 'Unknown IANA time zone'),
  label: z.string().trim().min(1).max(80).optional(),
  workStart: timeSchema.default('09:00'),
  workEnd: timeSchema.default('18:00'),
  weekend: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  quietBefore: timeSchema.default('08:00'),
  quietAfter: timeSchema.default('21:00'),
  prayer: prayerSchema.optional()
}).strict();

/** Non-overnight daily windows, with work hours contained inside allowed hours. */
export const zoneSchema = zoneObject.superRefine((zone, ctx) => {
  if (zone.workStart >= zone.workEnd) ctx.addIssue({ code: 'custom', path: ['workEnd'], message: 'workEnd must be after workStart (overnight work windows are not supported)' });
  if (zone.quietBefore >= zone.quietAfter) ctx.addIssue({ code: 'custom', path: ['quietAfter'], message: 'quietAfter must be after quietBefore' });
  if (zone.workStart < zone.quietBefore || zone.workEnd > zone.quietAfter) ctx.addIssue({ code: 'custom', path: ['workStart'], message: 'Work hours must fit inside quietBefore–quietAfter' });
  if (zone.weekend && new Set(zone.weekend).size !== zone.weekend.length) ctx.addIssue({ code: 'custom', path: ['weekend'], message: 'Weekend days must be unique' });
}).transform(zone => ({ ...zone, weekend: zone.weekend ?? defaultWeekend(zone.id) }));

const zonesSchema = z.array(zoneSchema).min(1, 'Add at least one zone').max(20).refine(
  zones => new Set(zones.map(zone => zone.id)).size === zones.length,
  'Time zones must be unique'
);
const fields = {
  zones: zonesSchema,
  startDate: dateSchema,
  days: z.number().int().min(1).max(31).default(5),
  durationMinutes: z.number().int().min(1).max(1440).default(30),
  stepMinutes: z.number().int().min(1).max(1440).default(15),
  prayer: prayerSchema.optional()
};

/** Shared input schema used by the library, CLI, and browser. */
export const findSlotsSchema = z.object(fields).strict();
/** JSON config schema. Omitted zones/date may be supplied by CLI flags. */
export const configSchema = z.object({ ...fields, zones: zonesSchema.optional(), startDate: dateSchema.optional(), top: z.number().int().min(1).max(1000).default(10) }).strict();

/** Input fields with optional defaults (09–18 work, 08–21 allowed, regional weekend via defaultWeekend()). */
export type ZoneRule = z.input<typeof zoneSchema>;
/** Location, adhan method and a symmetric buffer around five obligatory prayers. */
export type PrayerRule = z.input<typeof prayerSchema>;
/** The date range is interpreted in zones[0]; defaults are 5 days / 30 minutes / 15 minute step. */
export type FindSlotsInput = z.input<typeof findSlotsSchema>;
/** Validated input with every default resolved. */
export type NormalizedInput = z.output<typeof findSlotsSchema>;
/** Shared CLI/web JSON configuration. */
export type Config = z.input<typeof configSchema>;

/** Validate without throwing; errors include the exact input path and a human-readable message. */
export function validateInput(input: unknown):
  | { success: true; data: NormalizedInput }
  | { success: false; errors: { path: string; message: string }[] } {
  const result = findSlotsSchema.safeParse(input);
  if (!result.success) return { success: false, errors: result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) };
  const start = DateTime.fromISO(result.data.startDate, { zone: result.data.zones[0]!.id }).startOf('day');
  if (!start.isValid || start.toISODate() !== result.data.startDate) {
    return { success: false, errors: [{ path: 'startDate', message: 'This civil date does not exist in the first zone' }] };
  }
  return { success: true, data: result.data };
}

/** List searchable IANA identifiers available in the runtime's ICU database, including UTC. */
export function listTimeZones(search = ''): string[] {
  const supported = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['Asia/Dhaka', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'];
  return [...new Set(['UTC', ...supported])].filter(id => id.toLowerCase().includes(search.toLowerCase())).sort();
}
