import { describe, expect, it } from 'vitest';
import { findSlots, parseScheduleInput, type FindSlotsInput } from '@tzmeet/core';
import { createApp } from '../src/app.js';
import { conversionResultSchema, errorSchema, healthSchema, slotsResultSchema } from '../src/schemas.js';

const clock = () => new Date('2026-10-14T12:00:00.000Z');
const app = createApp({ now: clock, log: () => {}, rateLimit: { limit: 10000 } });
const input: FindSlotsInput = {
  zones: [{ id: 'Asia/Dhaka', weekend: [5, 6] }, { id: 'America/New_York' }, { id: 'Europe/London' }],
  startDate: '2026-11-02', days: 1, durationMinutes: 30, stepMinutes: 30
};
const post = (body: unknown, query = '') => app.request(`/v1/slots${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const queryUrl = (path: string, query: Record<string, string>) => `${path}?${new URLSearchParams(query)}`;

async function publicError(response: Response, status = 400) {
  expect(response.status).toBe(status);
  expect(response.headers.get('Content-Type')).toContain('application/json');
  const body = errorSchema.parse(await response.json());
  expect(body).not.toHaveProperty('stack');
  return body.error;
}

describe('stateless JSON routes (in-process app.request only)', () => {
  it('returns fixed-clock health and zones snapshots', async () => {
    const health = await app.request('/v1/health');
    expect(health.status).toBe(200);
    expect(healthSchema.parse(await health.json())).toMatchSnapshot();
    const zones = await app.request('/v1/zones?search=dhaka');
    expect(zones.status).toBe(200);
    expect(await zones.json()).toMatchSnapshot();
  });
  it('POST is exactly core scheduling output with only top/envelope added', async () => {
    const response = await post(input, '?top=2');
    expect(response.status).toBe(200);
    const body = slotsResultSchema.parse(await response.json());
    const core = findSlots(input);
    expect(body.slots).toEqual(core.slots.slice(0, 2));
    expect(body.diagnostics).toEqual(core.diagnostics);
    expect(body.meta).toEqual({ count: 2, generatedAt: clock().toISOString(), version: '0.1.0' });
    expect(body).toMatchSnapshot();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('GET shares the CLI parser, including repeated zoneWork/weekend and global prayers', async () => {
    const options = { zones: 'Asia/Dhaka,Europe/London', date: '2026-11-02', days: '1', duration: '30', step: '30', work: '09:00-18:00', quiet: '07:00-22:00', zoneWork: ['Asia/Dhaka=09:00-17:00', 'Europe/London=10:00-18:00'], weekend: ['Asia/Dhaka=fri,sat', 'Europe/London=sat,sun'], prayerLocation: 'Dhaka', prayerMethod: 'MWL', prayerBuffer: '5' };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) {
      for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
    }
    query.set('top', '2');
    const response = await app.request(`/v1/slots?${query}`);
    expect(response.status).toBe(200);
    const body = slotsResultSchema.parse(await response.json());
    const core = findSlots(parseScheduleInput(options));
    expect(body.slots).toEqual(core.slots.slice(0, 2));
    expect(body.diagnostics).toEqual(core.diagnostics);
    expect(body).toMatchSnapshot();
  });
  it('preserves per-zone prayer/work/weekend rules and global fallback exactly', async () => {
    const body: FindSlotsInput = {
      ...input,
      zones: [{ id: 'Asia/Dhaka', label: 'Home', weekend: [], workStart: '10:00', workEnd: '17:00', quietBefore: '07:00', quietAfter: '22:00', prayer: { location: 'Dhaka', method: 'MWL', bufferMinutes: 15 } }, { id: 'Europe/London', label: 'Office', prayer: { location: 'London', method: 'NorthAmerica', bufferMinutes: 5 } }],
      prayer: { location: 'Dhaka', method: 'Karachi', bufferMinutes: 10 }
    };
    const response = await post(body, '?top=50');
    expect(response.status).toBe(200);
    const result = slotsResultSchema.parse(await response.json());
    const core = findSlots(body);
    expect(result.slots).toEqual(core.slots.slice(0, 50));
    expect(result.diagnostics).toEqual(core.diagnostics);
  });
  it('treats no available slots as 200 with empty results and diagnostics', async () => {
    const response = await post({ zones: [{ id: 'Asia/Dhaka' }], startDate: '2026-10-30', days: 1 });
    expect(response.status).toBe(200);
    const body = slotsResultSchema.parse(await response.json());
    expect(body.slots).toEqual([]);
    expect(body.meta.count).toBe(0);
    expect(body.diagnostics.mostRestrictive?.constraint).toBe('weekend');
    expect(body).toMatchSnapshot();
  });
  it('returns the requested conversion snapshot', async () => {
    const response = await app.request(queryUrl('/v1/convert', { time: '2026-11-02T10:00', from: 'Asia/Dhaka', to: 'Europe/London,America/New_York' }));
    expect(response.status).toBe(200);
    expect(conversionResultSchema.parse(await response.json())).toMatchSnapshot();
  });
  it.each([
    ['2026-03-23T10:00', 0, -240], ['2026-03-30T10:00', 60, -240], ['2026-10-26T10:00', 0, -240], ['2026-11-02T10:00', 0, -300]
  ])('converts mismatched Dhaka/NY/London DST dates: %s', async (time, london, ny) => {
    const response = await app.request(queryUrl('/v1/convert', { time, from: 'Asia/Dhaka', to: 'Europe/London,America/New_York' }));
    expect(response.status).toBe(200);
    const body = conversionResultSchema.parse(await response.json());
    expect(body.conversions.map(zone => zone.offsetMinutes)).toEqual([london, ny]);
  });
  it('resolves an ambiguous fold explicitly, but rejects folds and gaps by default', async () => {
    const options = { time: '2026-11-01T01:30', from: 'America/New_York', to: 'UTC' };
    expect((await publicError(await app.request(queryUrl('/v1/convert', options)))).details).toContainEqual(expect.objectContaining({ field: 'time', message: expect.stringContaining('ambiguous') }));
    const earlier = await app.request(queryUrl('/v1/convert', { ...options, disambiguation: 'earlier' }));
    expect(conversionResultSchema.parse(await earlier.json()).utc).toBe('2026-11-01T05:30:00.000Z');
    const later = await app.request(queryUrl('/v1/convert', { ...options, disambiguation: 'later' }));
    expect(conversionResultSchema.parse(await later.json()).utc).toBe('2026-11-01T06:30:00.000Z');
    expect((await publicError(await app.request(queryUrl('/v1/convert', { ...options, time: '2026-03-08T02:30' })))).message).toContain('does not exist');
  });
  it('generates OpenAPI from the shared schemas', async () => {
    const response = await app.request('/openapi.json');
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ openapi: '3.0.3', info: { title: 'tzmeet REST API', version: '0.1.0' }, paths: { '/v1/slots': { get: {}, post: {} }, '/v1/convert': { get: {} }, '/v1/zones': { get: {} }, '/v1/health': { get: {} } } });
  });
});

describe('precise, sanitized transport errors', () => {
  it('suggests unknown zones with bracket-indexed POST fields and no duplicate prefixes', async () => {
    const error = await publicError(await post({ ...input, zones: [{ id: 'UTC' }, { id: 'Asia/Dhka' }] }));
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual([{ field: 'zones[1].id', message: "'Asia/Dhka' is not a valid IANA time zone. Did you mean 'Asia/Dhaka'?", suggestion: 'Asia/Dhaka' }]);
    expect(error.message).toBe("zones[1].id: 'Asia/Dhka' is not a valid IANA time zone. Did you mean 'Asia/Dhaka'?");
  });
  it('gives the same precise unknown-zone suggestion on GET', async () => {
    const error = await publicError(await app.request('/v1/slots?zones=UTC,Asia/Dhka&date=2026-11-02'));
    expect(error.details).toContainEqual(expect.objectContaining({ field: 'zones[1].id', suggestion: 'Asia/Dhaka' }));
  });
  it('suggests conversion source/destination typos', async () => {
    const source = await publicError(await app.request(queryUrl('/v1/convert', { time: '2026-11-02T10:00', from: 'Asia/Dhka', to: 'UTC' })));
    expect(source.details).toContainEqual(expect.objectContaining({ field: 'from', suggestion: 'Asia/Dhaka' }));
    const destination = await publicError(await app.request(queryUrl('/v1/convert', { time: '2026-11-02T10:00', from: 'UTC', to: 'Europe/London,Asia/Dhka' })));
    expect(destination.details).toContainEqual(expect.objectContaining({ field: 'to[1]', suggestion: 'Asia/Dhaka' }));
  });
  it.each([
    ['days', 15], ['stepMinutes', 4], ['durationMinutes', 4], ['durationMinutes', 481]
  ])('enforces API-only POST limits for %s=%s', async (field, value) => {
    const error = await publicError(await post({ ...input, [field]: value }));
    expect(error.details).toContainEqual(expect.objectContaining({ field }));
  });
  it.each([
    ['days', '15'], ['days', '0'], ['step', '4'], ['duration', '481'], ['duration', '4'], ['top', '51'], ['top', '0'], ['top', '2.5'], ['days', '1e1']
  ])('enforces exact GET field bounds/syntax for %s=%s', async (field, value) => {
    const error = await publicError(await app.request(queryUrl('/v1/slots', { zones: 'UTC', date: '2026-11-02', [field]: value })));
    expect(error.details).toContainEqual(expect.objectContaining({ field }));
  });
  it('caps participants and conversion destinations at eight', async () => {
    const ids = ['UTC', 'Asia/Dhaka', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/Paris', 'Asia/Singapore', 'Asia/Dubai'];
    expect((await publicError(await post({ ...input, zones: ids.map(id => ({ id })) }))).details).toContainEqual(expect.objectContaining({ field: 'zones', message: 'zones must contain at most 8 participants' }));
    expect((await publicError(await app.request(queryUrl('/v1/slots', { zones: ids.join(','), date: '2026-11-02' })))).details).toContainEqual(expect.objectContaining({ field: 'zones', message: 'zones must contain at most 8 participants' }));
    expect((await publicError(await app.request(queryUrl('/v1/convert', { time: '2026-11-02T10:00', from: 'UTC', to: ids.join(',') })))).details).toContainEqual(expect.objectContaining({ field: 'to', message: 'to must contain at most 8 destination zones' }));
  });
  it('does not leak the library’s higher zone cap into API errors', async () => {
    const tooMany = Array.from({ length: 21 }, () => ({ id: 'UTC' }));
    expect((await publicError(await post({ ...input, zones: tooMany }))).details).toEqual([{ field: 'zones', message: 'zones must contain at most 8 participants' }]);
    expect((await publicError(await app.request(queryUrl('/v1/convert', { time: '2026-11-02T10:00', from: 'UTC', to: tooMany.map(zone => zone.id).join(',') })))).details).toEqual([{ field: 'to', message: 'to must contain at most 8 destination zones' }]);
  });
  it('maps CLI flag errors to actual GET query field names', async () => {
    const error = await publicError(await app.request(queryUrl('/v1/slots', { zones: 'UTC', date: '2026-11-02', zoneWork: 'Europe/London=09:00-17:00' })));
    expect(error.details).toEqual([{ field: 'zoneWork', message: 'Europe/London is not a selected zone; add it with --zones first' }]);
    expect(error.message).not.toContain('zone-work:');
  });
  it('requires a date, rejects civil date skips, and rejects duplicate zones', async () => {
    expect((await publicError(await app.request('/v1/slots?zones=UTC'))).details).toContainEqual(expect.objectContaining({ field: 'date' }));
    expect((await publicError(await post({ zones: [{ id: 'Pacific/Apia' }], startDate: '2011-12-30' }))).details).toContainEqual(expect.objectContaining({ field: 'startDate', message: 'This civil date does not exist in the first zone' }));
    expect((await publicError(await post({ ...input, zones: [{ id: 'UTC' }, { id: 'UTC' }] }))).message).toContain('unique');
  });
  it('rejects unknown fields instead of silently accepting them', async () => {
    expect((await publicError(await post({ ...input, typo: 1 }))).details).toContainEqual({ field: 'typo', message: 'Unknown field' });
    expect((await publicError(await app.request('/v1/slots?zones=UTC&date=2026-11-02&typo=1'))).details).toContainEqual({ field: 'typo', message: 'Unknown field' });
  });
  it('uses clear JSON/content-type errors and rejects non-object JSON', async () => {
    const malformed = await app.request('/v1/slots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect((await publicError(malformed)).code).toBe('INVALID_JSON');
    const wrongType = await app.request('/v1/slots', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(input) });
    expect((await publicError(wrongType)).code).toBe('UNSUPPORTED_CONTENT_TYPE');
    expect((await publicError(await post(null))).details).toContainEqual(expect.objectContaining({ field: 'body' }));
  });
  it('returns JSON 404, JSON 405 with Allow, and valid empty HEAD responses', async () => {
    expect((await publicError(await app.request('/unknown'), 404)).code).toBe('NOT_FOUND');
    const response = await app.request('/v1/slots', { method: 'PUT' });
    expect((await publicError(response, 405)).code).toBe('METHOD_NOT_ALLOWED');
    expect(response.headers.get('Allow')).toBe('GET, POST, HEAD');
    const head = await app.request('/v1/health', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });
  it('never leaks unexpected exception messages or stacks', async () => {
    const broken = createApp({ now: () => { throw new Error('PRIVATE_INTERNAL_TOKEN stack /secret/path'); }, log: () => {} });
    const response = await broken.request('/v1/zones?search=dhaka');
    const error = await publicError(response, 500);
    expect(error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  });
  it('rejects unknown output formats', async () => {
    expect((await publicError(await post(input, '?format=xml'))).details).toContainEqual(expect.objectContaining({ field: 'format' }));
  });
});
