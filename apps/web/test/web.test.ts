import { describe, expect, it } from 'vitest';
import { classifySpan, classifySpans, findSlots, type Slot } from '@tzmeet/core';
import { calendarText, foldLine, inviteText } from '../src/invite';
import { decodeState, defaultState, encodeState, parseState, persistState, regionalZone, restoreState, STORAGE_KEY } from '../src/state';
import { makeTimeline } from '../src/timeline';

function fixture(): Slot {
  const open = { workStart: '00:00', workEnd: '23:59', quietBefore: '00:00', quietAfter: '23:59', weekend: [] };
  const result = findSlots({ zones: ['Asia/Dhaka', 'Europe/London', 'America/New_York'].map(id => ({ ...open, id })), startDate: '2026-11-03', days: 1 });
  return result.slots.find(slot => slot.start === '2026-11-02T18:15:00.000Z')!;
}

describe('shareable and persistent state', () => {
  it('round-trips every input/view setting, zone order, and custom prayer coordinates', () => {
    const state = defaultState();
    state.input.startDate = '2026-11-02';
    state.input.zones.reverse();
    state.input.zones[0]!.label = 'Team A & B / ঢাকা';
    state.prayerDraft = { location: { lat: 23.8103, lng: 90.4125 }, method: 'MWL', bufferMinutes: 17 };
    state.input.prayer = state.prayerDraft;
    state.theme = 'dark';
    state.customDuration = true;
    state.input.durationMinutes = 37;
    state.day = '2026-11-03';
    state.selected = '2026-11-03T12:00:00.000Z';
    state.expanded = state.selected;
    state.panels = state.input.zones.map(zone => zone.id);
    state.shown = 30;
    expect(decodeState(`?${encodeState(state)}`)).toEqual(state);
  });

  it('prioritizes the URL over storage and ignores malformed stored data', () => {
    const state = defaultState();
    state.theme = 'dark';
    expect(restoreState(`?${encodeState(state)}`, { getItem: () => 'broken JSON' }).state.theme).toBe('dark');
    expect(restoreState('', { getItem: () => 'broken JSON' }).state.input.zones).toHaveLength(3);
    expect(restoreState('?state=broken', null).notice).toContain('invalid settings');
  });

  it('handles denied storage on read/write without throwing', () => {
    expect(restoreState('', { getItem: () => { throw new Error('denied'); } }).state).toBeDefined();
    expect(() => persistState(defaultState(), { setItem: () => { throw new Error('denied'); } })).not.toThrow();
    let saved = '';
    persistState(defaultState(), { setItem: (key, value) => { expect(key).toBe(STORAGE_KEY); saved = value; } });
    expect(parseState(JSON.parse(saved)).v).toBe(1);
  });

  it('rejects unknown versions, bad zones and nonexistent civil dates', () => {
    const state = defaultState();
    expect(() => parseState({ ...state, v: 2 })).toThrow();
    state.input.zones[0]!.id = 'Mars/Olympus';
    expect(() => encodeState(state)).toThrow();
    state.input.zones = [regionalZone('Pacific/Apia')];
    state.input.startDate = '2011-12-30';
    expect(() => encodeState(state)).toThrow(/civil date/);
  });

  it('sets Dhaka regional defaults without changing conventional weekends elsewhere', () => {
    expect(regionalZone('Asia/Dhaka').weekend).toEqual([5, 6]);
    expect(regionalZone('America/New_York').weekend).toEqual([6, 7]);
    expect(regionalZone('Europe/London').workStart).toBe('09:00');
  });
});

describe('invite and calendar exports', () => {
  it('includes every zone and disambiguates differing local dates', () => {
    const text = inviteText(fixture());
    expect(text).toContain('Tue 3 Nov 2026');
    expect(text).toContain('00:15–00:45 Dhaka');
    expect(text).toContain('18:15–18:45 London (Mon 2 Nov)');
    expect(text).toContain('13:15–13:45 New York (Mon 2 Nov)');
  });

  it('uses UTC calendar instants, stable UID, CRLF and an explicit creation timestamp', () => {
    const slot = fixture();
    const content = calendarText(slot, '2026-10-14T12:00:00Z');
    expect(content).toContain('DTSTART:20261102T181500Z\r\n');
    expect(content).toContain('DTEND:20261102T184500Z\r\n');
    expect(content).toContain('DTSTAMP:20261014T120000Z\r\n');
    expect(content).toMatch(/UID:20261102T181500Z-\w+@tzmeet.local\r\n/);
    expect(content.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(content).toBe(calendarText(slot, '2026-10-14T12:00:00Z'));
  });

  it('escapes untrusted text rather than allowing ICS property injection', () => {
    const slot = fixture();
    slot.reason = 'Hello, world; test\\path\nATTENDEE:bad';
    const content = calendarText(slot, '2026-10-14T12:00:00Z').replaceAll('\r\n ', '');
    expect(content).toContain('Hello\\, world\\; test\\\\path\\nATTENDEE:bad');
    expect(content).not.toContain('\r\nATTENDEE:bad');
  });

  it('folds multi-byte text by UTF-8 bytes without splitting a codepoint', () => {
    const text = 'DESCRIPTION:' + 'ঢাকা 😀'.repeat(30);
    const folded = foldLine(text);
    expect(folded.replaceAll('\r\n ', '')).toBe(text);
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe('shared full-span timeline evaluation', () => {
  it('bulk evaluation is identical to independent span evaluation across a DST fold', () => {
    const rule = { id: 'America/New_York', weekend: [], workStart: '01:30', workEnd: '04:00', quietBefore: '01:15' };
    const spans = [
      { start: '2026-11-01T05:45:00Z', end: '2026-11-01T06:45:00Z' },
      { start: '2026-11-01T07:00:00Z', end: '2026-11-01T07:30:00Z' }
    ];
    expect(classifySpans(rule, spans)).toEqual(spans.map(span => classifySpan(rule, span.start, span.end)));
  });

  it('bulk spans also enforce unambiguous instants and positive durations', () => {
    expect(() => classifySpans({ id: 'UTC' }, [{ start: '2026-11-02T09:00:00', end: '2026-11-02T10:00:00' }])).toThrow(/offset/);
    expect(() => classifySpans({ id: 'UTC' }, [{ start: '2026-11-02T10:00:00Z', end: '2026-11-02T09:00:00Z' }])).toThrow(/end after start/);
  });

  it('covers the complete shared UTC axis and retains weekend/prayer colors', () => {
    const input = defaultState().input;
    input.prayer = { location: 'Dhaka', method: 'Karachi', bufferMinutes: 10 };
    const rows = makeTimeline(input, '2026-11-02');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.segments.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(100, 8);
    expect(rows[0]!.segments.some(segment => segment.kind === 'prayer')).toBe(true);
    expect(rows[2]!.segments.some(segment => segment.kind === 'weekend')).toBe(true); // NY is still Sunday at 00:00 UTC.
    expect(rows[0]!.origin).toContain('06:00');
  });
});
