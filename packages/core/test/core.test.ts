import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { classifySpan, configSchema, findSlots, getPrayerWindows, InputValidationError, listTimeZones, validateInput, type ZoneRule } from '../src/index.js';

const trio: ZoneRule[] = [
  { id: 'Asia/Dhaka', label: 'Dhaka', weekend: [5, 6], quietBefore: '00:00', quietAfter: '23:59' },
  { id: 'America/New_York', label: 'New York', quietBefore: '00:00', quietAfter: '23:59' },
  { id: 'Europe/London', label: 'London', quietBefore: '00:00', quietAfter: '23:59' }
];
const openNY: ZoneRule = { id: 'America/New_York', weekend: [], workStart: '00:00', workEnd: '23:59', quietBefore: '00:00', quietAfter: '23:59' };
const utcRule: ZoneRule = { id: 'UTC', weekend: [] };
const at = (value: string) => DateTime.fromISO(value, { setZone: true });

function fixedSlot(date: string, utcHour = 12) {
  const result = findSlots({ zones: trio, startDate: date, days: 1, stepMinutes: 60 });
  const slot = result.slots.find(slot => at(slot.start).hour === utcHour);
  expect(slot, `No ${utcHour}:00Z slot on ${date}`).toBeDefined();
  return slot!;
}

describe('DST across Dhaka, New York and London', () => {
  it.each([
    ['2026-03-02', -300, 0, '07:00', '12:00'],
    ['2026-03-16', -240, 0, '08:00', '12:00'],
    ['2026-03-30', -240, 60, '08:00', '13:00'],
    ['2026-10-19', -240, 60, '08:00', '13:00'],
    ['2026-10-26', -240, 0, '08:00', '12:00'],
    ['2026-11-02', -300, 0, '07:00', '12:00']
  ])('%s has the correct independent offsets', (date, nyOffset, londonOffset, nyTime, londonTime) => {
    const slot = fixedSlot(date);
    const [dhaka, ny, london] = slot.zones;
    expect(at(dhaka!.localStart).offset).toBe(360);
    expect(at(dhaka!.localStart).toFormat('HH:mm')).toBe('18:00');
    expect(at(ny!.localStart).offset).toBe(nyOffset);
    expect(at(ny!.localStart).toFormat('HH:mm')).toBe(nyTime);
    expect(at(london!.localStart).offset).toBe(londonOffset);
    expect(at(london!.localStart).toFormat('HH:mm')).toBe(londonTime);
  });

  it('skips nonexistent spring-forward wall times by scanning real UTC instants', () => {
    const result = findSlots({ zones: [openNY], startDate: '2026-03-08', days: 1, stepMinutes: 30 });
    const starts = result.slots.map(slot => slot.zones[0]!.localStart);
    expect(starts.some(start => start.includes('T02:'))).toBe(false);
    expect(starts.some(start => start.includes('T03:00:00.000-04:00'))).toBe(true);
    const crossing = result.slots.find(slot => slot.start.startsWith('2026-03-08T06:30'))!;
    expect(crossing.zones[0]!.localStart).toContain('01:30:00.000-05:00');
    expect(crossing.zones[0]!.localEnd).toContain('03:00:00.000-04:00');
    expect(at(crossing.end).diff(at(crossing.start), 'minutes').minutes).toBe(30);
  });

  it('preserves both repeated autumn hours with distinct offsets', () => {
    const result = findSlots({ zones: [openNY], startDate: '2026-11-01', days: 1, stepMinutes: 30 });
    const repeated = result.slots.filter(slot => at(slot.zones[0]!.localStart).toFormat('HH:mm') === '01:30');
    expect(repeated).toHaveLength(2);
    expect(new Set(repeated.map(slot => at(slot.zones[0]!.localStart).offset))).toEqual(new Set([-240, -300]));
  });

  it('catches a hidden boundary inside the fall-back fold, not only endpoints', () => {
    const rule: ZoneRule = { ...openNY, workStart: '01:30', workEnd: '04:00', quietBefore: '01:15' };
    // Endpoints are 01:45 EDT and 01:45 EST, but the span passes 01:00 EST.
    expect(classifySpan(rule, '2026-11-01T05:45:00Z', '2026-11-01T06:45:00Z').constraints).toContain('quiet');
  });

  it('handles non-hour DST changes (Lord Howe shifts by 30 minutes)', () => {
    const zone: ZoneRule = { ...openNY, id: 'Australia/Lord_Howe' };
    const result = findSlots({ zones: [zone], startDate: '2026-10-04', days: 1, stepMinutes: 15 });
    expect(at(result.range.end).diff(at(result.range.start), 'hours').hours).toBe(23.5);
    expect(result.slots.some(slot => at(slot.zones[0]!.localStart).toFormat('HH:mm') === '02:15')).toBe(false);
  });
});

describe('whole-span work, quiet and weekend rules', () => {
  it('combines Friday/Saturday in Dhaka with Saturday/Sunday elsewhere', () => {
    const result = findSlots({ zones: trio, startDate: '2026-11-02', days: 7, stepMinutes: 60 });
    expect(result.slots.length).toBeGreaterThan(0);
    for (const slot of result.slots) {
      for (const zone of slot.zones) {
        const weekends = zone.id === 'Asia/Dhaka' ? [5, 6] : [6, 7];
        expect(weekends).not.toContain(at(zone.localStart).weekday);
        expect(weekends).not.toContain(at(zone.localEnd).weekday);
      }
    }
    expect(result.slots.some(slot => at(slot.zones[0]!.localStart).weekday === 5)).toBe(false);
  });

  it('treats a work-boundary crossing as acceptable, but an exact end as ideal', () => {
    expect(classifySpan(utcRule, '2026-11-02T17:45:00Z', '2026-11-02T18:15:00Z').classification).toBe('acceptable');
    expect(classifySpan(utcRule, '2026-11-02T17:30:00Z', '2026-11-02T18:00:00Z').classification).toBe('ideal');
    expect(classifySpan(utcRule, '2026-11-02T08:45:00Z', '2026-11-02T09:15:00Z').classification).toBe('acceptable');
  });

  it('allows an exact quiet endpoint, blocks a span extending past it', () => {
    expect(classifySpan(utcRule, '2026-11-02T20:30:00Z', '2026-11-02T21:00:00Z').classification).toBe('acceptable');
    expect(classifySpan(utcRule, '2026-11-02T20:45:00Z', '2026-11-02T21:15:00Z').constraints).toContain('quiet');
  });

  it('checks midnight and the next local weekday, including the end instant', () => {
    const rule: ZoneRule = { id: 'UTC', workStart: '00:00', workEnd: '23:59', quietBefore: '00:00', quietAfter: '23:59', weekend: [6, 7] };
    const crossing = classifySpan(rule, '2026-11-06T23:45:00Z', '2026-11-07T00:15:00Z');
    expect(crossing.constraints).toEqual(expect.arrayContaining(['weekend', 'quiet']));
    expect(classifySpan(rule, '2026-11-06T23:30:00Z', '2026-11-07T00:00:00Z').constraints).toContain('weekend');
  });

  it('does not return meetings extending beyond the searched range', () => {
    const result = findSlots({ zones: [utcRule], startDate: '2026-11-02', days: 1, durationMinutes: 1440 });
    expect(result.slots).toEqual([]);
    expect(result.diagnostics.scannedCandidates).toBe(1);
  });

  it('returns an empty list with actionable quiet-hour diagnostics', () => {
    const result = findSlots({ zones: [
      { id: 'Asia/Dhaka', quietBefore: '09:00', quietAfter: '18:00', weekend: [5, 6] },
      { id: 'America/New_York', quietBefore: '09:00', quietAfter: '18:00' }
    ], startDate: '2026-11-02', days: 4 });
    expect(result.slots).toEqual([]);
    expect(result.diagnostics.mostRestrictive?.constraint).toBe('quiet');
    expect(result.diagnostics.message).toContain('Friday/Saturday weekend in Dhaka');
    expect(result.diagnostics.message).toContain('Monday, Tuesday, Wednesday, Thursday');
    expect(result.diagnostics.suggestion).toMatch(/Relax.*cutoff/);
    expect(result.diagnostics.rejectedCandidates).toBe(result.diagnostics.scannedCandidates);
  });

  it('reports weekend as the dominant rejection when all weekdays are blocked', () => {
    const result = findSlots({ zones: [{ ...openNY, weekend: [1, 2, 3, 4, 5, 6, 7] }], startDate: '2026-11-02', days: 1 });
    expect(result.diagnostics.mostRestrictive?.constraint).toBe('weekend');
    expect(result.diagnostics.suggestion).toContain('different week');
  });
});

describe('prayer calculations and overlap', () => {
  const prayer = { location: 'Dhaka' as const, method: 'Karachi' as const, bufferMinutes: 10 };
  const dhaka: ZoneRule = { id: 'Asia/Dhaka', weekend: [5, 6] };

  it('snapshots fixed-date Karachi calculations for Dhaka', () => {
    expect(getPrayerWindows('2026-11-02', prayer)).toMatchSnapshot();
  });

  it.each(['dhuhr', 'asr'])('blocks %s plus the symmetric buffer', name => {
    const window = getPrayerWindows('2026-11-02', prayer).find(window => window.name === name)!;
    const start = at(window.start).minus({ minutes: 5 }).toISO()!;
    const end = at(start).plus({ minutes: 15 }).toISO()!;
    expect(classifySpan(dhaka, start, end).classification).toBe('ideal');
    const blocked = classifySpan(dhaka, start, end, prayer);
    expect(blocked.classification).toBe('blocked');
    expect(blocked.prayers).toContain(name);
    // Ending exactly at the buffered boundary counts as overlap.
    expect(classifySpan(dhaka, at(window.start).minus({ minutes: 30 }).toISO()!, window.start, prayer).classification).toBe('blocked');
    expect(classifySpan(dhaka, at(window.end).plus({ minutes: 1 }).toISO()!, at(window.end).plus({ minutes: 16 }).toISO()!, prayer).classification).toBe('ideal');
  });

  it('filters prayer-conflicting candidates and preserves all others', () => {
    const input = { zones: [dhaka], startDate: '2026-11-02', days: 1, stepMinutes: 15 };
    const before = findSlots(input);
    const after = findSlots({ ...input, prayer });
    expect(after.slots.length).toBeLessThan(before.slots.length);
    for (const slot of after.slots) expect(classifySpan(dhaka, slot.start, slot.end, prayer).classification).not.toBe('blocked');
    expect(after.diagnostics.constraints.some(count => count.constraint === 'prayer')).toBe(true);
  });

  it('supports per-zone location/method overrides', () => {
    const window = getPrayerWindows('2026-11-02', prayer).find(window => window.name === 'dhuhr')!;
    expect(classifySpan({ ...dhaka, prayer }, window.start, window.end).constraints).toContain('prayer');
  });

  it('accepts coordinates and the MWL alias', () => {
    expect(getPrayerWindows('2026-11-02', { location: { lat: 23.8103, lng: 90.4125 }, method: 'MWL' })).toHaveLength(5);
  });
});

describe('ranking and output', () => {
  it('ranks descending, never lets a tie-break outweigh one classification point', () => {
    const result = findSlots({ zones: [{ id: 'Asia/Dhaka', weekend: [5, 6] }], startDate: '2026-11-02', days: 2 });
    expect(result.slots.length).toBeGreaterThan(0);
    result.slots.forEach((slot, i) => {
      expect(slot.score - slot.baseScore).toBeGreaterThanOrEqual(0);
      expect(slot.score - slot.baseScore).toBeLessThan(0.1);
      if (i > 0) expect(result.slots[i - 1]!.score).toBeGreaterThanOrEqual(slot.score);
      expect(slot.zones[0]!.formattedStart).toContain('2026');
      expect(slot.reason).toMatch(/Ideal|acceptable/);
    });
    const ideal = result.slots.filter(slot => slot.baseScore === 2);
    expect(ideal[0]!.date).toBe('2026-11-02');
    expect(at(ideal[0]!.zones[0]!.localStart).toFormat('HH:mm')).toBe('13:15');
  });

  it('is deterministic and does not mutate inputs', () => {
    const input = { zones: [{ id: 'Asia/Dhaka' }], startDate: '2026-11-02', days: 1 };
    const original = structuredClone(input);
    expect(findSlots(input)).toEqual(findSlots(input));
    expect(input).toEqual(original);
  });

  it('fits the range to first-zone calendar days across DST', () => {
    const result = findSlots({ zones: [openNY], startDate: '2026-11-01', days: 1 });
    expect(at(result.range.end).diff(at(result.range.start), 'hours').hours).toBe(25);
  });
});

describe('shared validation and time-zone discovery', () => {
  it.each([
    [{ zones: [{ id: 'Mars/Olympus' }], startDate: '2026-11-02' }, 'Unknown IANA'],
    [{ zones: [{ id: 'UTC', workStart: '9:00' }], startDate: '2026-11-02' }, 'HH:mm'],
    [{ zones: [{ id: 'UTC', quietAfter: '24:00' }], startDate: '2026-11-02' }, 'HH:mm'],
    [{ zones: [{ id: 'UTC', workEnd: '08:00' }], startDate: '2026-11-02' }, 'after workStart'],
    [{ zones: [{ id: 'UTC', quietBefore: '10:00' }], startDate: '2026-11-02' }, 'fit inside'],
    [{ zones: [{ id: 'UTC' }], startDate: '2026-02-30' }, 'calendar date'],
    [{ zones: [{ id: 'UTC' }], startDate: '2026-11-02', stepMinutes: 0 }, 'greater than'],
    [{ zones: [{ id: 'UTC' }, { id: 'UTC' }], startDate: '2026-11-02' }, 'unique']
  ])('reports clear errors for %j', (input, message) => {
    const result = validateInput(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.map(error => error.message).join('; ')).toContain(message);
    expect(() => findSlots(input)).toThrow(InputValidationError);
  });

  it('rejects nonexistent civil dates in the first zone', () => {
    const input = { zones: [{ id: 'Pacific/Apia' }], startDate: '2011-12-30' };
    expect(() => findSlots(input)).toThrow(/civil date does not exist/);
    expect(validateInput(input).success).toBe(false);
  });

  it('resolves defaults and leaves Dhaka weekend explicit at core level', () => {
    const result = validateInput({ zones: [{ id: 'Asia/Dhaka' }], startDate: '2026-11-02' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.zones[0]!.weekend).toEqual([6, 7]);
      expect(result.data.days).toBe(5);
      expect(result.data.durationMinutes).toBe(30);
      expect(result.data.stepMinutes).toBe(15);
    }
  });

  it('shares config defaults, rejects unknown config fields', () => {
    expect(configSchema.parse({ zones: [{ id: 'UTC' }] }).top).toBe(10);
    expect(configSchema.safeParse({ bogus: true }).success).toBe(false);
  });

  it('searches runtime time zones and includes UTC', () => {
    expect(listTimeZones('dhaka')).toContain('Asia/Dhaka');
    expect(listTimeZones('new_york')).toContain('America/New_York');
    expect(listTimeZones('utc')).toEqual(['UTC']);
  });

  it('requires unambiguous ISO instants for independent span evaluation', () => {
    expect(() => classifySpan(openNY, '2026-11-01T01:30:00', '2026-11-01T02:00:00')).toThrow(/offset/);
  });
});
