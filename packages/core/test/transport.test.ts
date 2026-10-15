import { describe, expect, it } from 'vitest';
import { convertTime, getTimeZoneInfo, parseIntegerOption, parseScheduleInput, ScheduleInputError, suggestTimeZone } from '../src/index.js';

describe('shared transport parser (browser-safe, no scheduling)', () => {
  it('resolves defaults with an explicit date and never invents today', () => {
    const input = parseScheduleInput({ zones: 'Asia/Dhaka,Europe/London', date: '2026-11-02' });
    expect(input).toMatchObject({ startDate: '2026-11-02', durationMinutes: 30, days: 5, stepMinutes: 15 });
    expect(input.zones[0]).toMatchObject({ workStart: '09:00', workEnd: '18:00', quietBefore: '08:00', quietAfter: '21:00', weekend: [5, 6] });
    expect(input.zones[1]!.weekend).toEqual([6, 7]);
    expect(() => parseScheduleInput({ zones: 'UTC' })).toThrow('date is required');
  });
  it('keeps config labels/rules when replacing zone order and applies overrides in order', () => {
    const config = { zones: [{ id: 'Asia/Dhaka', label: 'Home', weekend: [5, 6] }, { id: 'Europe/London', label: 'Office' }], startDate: '2026-11-01', durationMinutes: 60, top: 42 };
    const before = JSON.stringify(config);
    const input = parseScheduleInput({ zones: 'Europe/London,Asia/Dhaka', date: '2026-11-02', duration: '45', work: '08:00-19:00', zoneWork: ['Asia/Dhaka=09:00-17:00', 'Asia/Dhaka=10:00-18:00'], weekend: ['Europe/London=none'], quiet: '07:00-22:00', step: '5' }, config);
    expect(input).toMatchObject({ startDate: '2026-11-02', durationMinutes: 45, stepMinutes: 5, zones: [{ id: 'Europe/London', label: 'Office', weekend: [], workStart: '08:00', workEnd: '19:00' }, { id: 'Asia/Dhaka', label: 'Home', weekend: [5, 6], workStart: '10:00', workEnd: '18:00' }] });
    expect(JSON.stringify(config)).toBe(before);
  });
  it('supports weekday names/numbers, city/coordinate prayers and config prayer overrides', () => {
    const input = parseScheduleInput({ weekend: ['Asia/Dhaka=friday,6'], prayerLocation: '23.8103,90.4125', prayerMethod: 'MWL', prayerBuffer: '15' }, { zones: [{ id: 'Asia/Dhaka' }], startDate: '2026-11-02' });
    expect(input.zones[0]!.weekend).toEqual([5, 6]);
    expect(input.prayer).toEqual({ location: { lat: 23.8103, lng: 90.4125 }, method: 'MWL', bufferMinutes: 15 });
    expect(parseScheduleInput({ prayerBuffer: '0' }, { zones: [{ id: 'UTC' }], startDate: '2026-11-02', prayer: { location: 'Dhaka' } }).prayer).toEqual({ location: 'Dhaka', method: 'Karachi', bufferMinutes: 0 });
  });
  it.each(['1.5', '1e2', '-5', 'NaN', '', '9007199254740993'])('rejects non-strict integer %j', value => {
    expect(() => parseIntegerOption(value, 'days', 5)).toThrow(ScheduleInputError);
  });
  it('parses per-zone holiday lists, including none', () => {
    const input = parseScheduleInput({ zones: 'Asia/Dhaka,Europe/London', date: '2026-12-14', holiday: ['Asia/Dhaka=2026-12-16, 2026-12-25', 'Europe/London=2026-12-25', 'Europe/London=none'] });
    expect(input.zones.map(zone => zone.holidays)).toEqual([['2026-12-16', '2026-12-25'], []]);
  });
  it('reports unknown zone values and exact schema paths', () => {
    try { parseScheduleInput({ zones: 'UTC,Asia/Dhka', date: '2026-11-02' }); }
    catch (error) {
      expect(error).toBeInstanceOf(ScheduleInputError);
      expect((error as ScheduleInputError).issues).toContainEqual(expect.objectContaining({ path: 'zones.1.id', value: 'Asia/Dhka' }));
      return;
    }
    throw new Error('Expected invalid zone');
  });
  it.each([
    [{ zones: 'UTC', date: '2026-02-30' }, 'calendar date'],
    [{ zones: 'UTC', date: '2026-11-02', work: '9-17' }, 'HH:mm-HH:mm'],
    [{ zones: 'UTC', date: '2026-11-02', zoneWork: ['Europe/London=09:00-17:00'] }, 'not a selected zone'],
    [{ zones: 'UTC', date: '2026-11-02', weekend: ['UTC=funday'] }, 'Unknown weekend day'],
    [{ zones: 'UTC', date: '2026-11-02', weekend: ['UTC=mon,1'] }, 'unique'],
    [{ zones: 'UTC', date: '2026-11-02', holiday: ['UTC=2026-12-32'] }, 'calendar date'],
    [{ zones: 'UTC', date: '2026-11-02', holiday: ['Asia/Dhaka=2026-12-16'] }, 'not a selected zone'],
    [{ zones: 'UTC', date: '2026-11-02', prayerMethod: 'Karachi' }, 'required'],
    [{ zones: 'UTC', date: '2026-11-02', prayerLocation: 'a,b' }, 'latitude,longitude'],
    [{ zones: 'UTC', date: '2026-11-02', prayerLocation: '91,0' }, '90']
  ])('rejects invalid string options %j', (options, message) => expect(() => parseScheduleInput(options)).toThrow(message));
});

describe('Luxon timezone transport helpers', () => {
  it('converts the requested Dhaka/London/New York winter example', () => {
    expect(convertTime({ time: '2026-11-02T10:00', from: 'Asia/Dhaka', to: ['Europe/London', 'America/New_York'] })).toMatchObject({
      source: { localTime: '2026-11-02T10:00:00.000+06:00', offsetMinutes: 360 }, utc: '2026-11-02T04:00:00.000Z',
      conversions: [{ localTime: '2026-11-02T04:00:00.000+00:00', offsetMinutes: 0 }, { localTime: '2026-11-01T23:00:00.000-05:00', offsetMinutes: -300 }]
    });
  });
  it.each([
    ['2026-03-23T10:00', 0, -240], ['2026-03-30T10:00', 60, -240],
    ['2026-10-26T10:00', 0, -240], ['2026-11-02T10:00', 0, -300]
  ])('handles mismatched DST calendars at %s', (time, london, newYork) => {
    expect(convertTime({ time, from: 'Asia/Dhaka', to: ['Europe/London', 'America/New_York'] }).conversions.map(zone => zone.offsetMinutes)).toEqual([london, newYork]);
  });
  it.each([
    ['America/New_York', '2026-03-08T02:30'], ['Europe/London', '2026-03-29T01:30'], ['Pacific/Apia', '2011-12-30T12:00']
  ])('rejects nonexistent civil times in %s', (from, time) => expect(() => convertTime({ time, from, to: ['UTC'] })).toThrow('does not exist'));
  it('rejects ambiguous folds unless earlier/later or an exact explicit offset resolves them', () => {
    const input = { time: '2026-11-01T01:30', from: 'America/New_York', to: ['UTC'] };
    expect(() => convertTime(input)).toThrow('ambiguous');
    expect(convertTime({ ...input, disambiguation: 'earlier' }).utc).toBe('2026-11-01T05:30:00.000Z');
    expect(convertTime({ ...input, disambiguation: 'later' }).utc).toBe('2026-11-01T06:30:00.000Z');
    expect(convertTime({ ...input, time: `${input.time}-04:00` }).utc).toBe('2026-11-01T05:30:00.000Z');
    expect(convertTime({ ...input, time: `${input.time}-05:00` }).utc).toBe('2026-11-01T06:30:00.000Z');
    expect(() => convertTime({ ...input, time: `${input.time}-06:00` })).toThrow('explicit offset does not match');
  });
  it('rejects calendar rollover, invalid instants and duplicate destinations', () => {
    expect(() => convertTime({ time: '2026-02-30T10:00', from: 'UTC', to: ['UTC'] })).toThrow('calendar date/time');
    expect(() => getTimeZoneInfo('UTC', '2026-11-02T10:00')).toThrow('explicit offset');
    expect(() => convertTime({ time: '2026-11-02T10:00', from: 'UTC', to: ['UTC', 'UTC'] })).toThrow('unique');
  });
  it('formats metadata at the supplied instant, never server today', () => {
    expect(getTimeZoneInfo('America/New_York', '2026-07-01T00:00:00Z')).toEqual({ id: 'America/New_York', label: 'New York', offset: '-04:00', offsetMinutes: -240 });
    expect(getTimeZoneInfo('America/New_York', '2026-12-01T00:00:00Z').offset).toBe('-05:00');
    expect(getTimeZoneInfo('Asia/Dhaka', '2026-11-02T00:00:00Z').offset).toBe('+06:00');
  });
  it('suggests a closest runtime ID, but never accepts it or searches unbounded input', () => {
    expect(suggestTimeZone('Asia/Dhka')).toBe('Asia/Dhaka');
    expect(suggestTimeZone('totally-nonexistent')).toBeNull();
    expect(suggestTimeZone('x'.repeat(101))).toBeNull();
    expect(() => getTimeZoneInfo('Asia/Dhka', '2026-11-02T00:00:00Z')).toThrow('Unknown IANA');
  });
});
