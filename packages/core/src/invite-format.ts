import { DateTime } from 'luxon';
import type { Slot } from './types.js';

export function inviteText(slot: Slot): string {
  const first = DateTime.fromISO(slot.zones[0]!.localStart, { setZone: true }).setLocale('en');
  const lines = slot.zones.map(zone => {
    const start = DateTime.fromISO(zone.localStart, { setZone: true }).setLocale('en');
    const end = DateTime.fromISO(zone.localEnd, { setZone: true }).setLocale('en');
    const suffix = start.toISODate() === first.toISODate() ? '' : ` (${start.toFormat('ccc d LLL')})`;
    const endDay = end.toISODate() === start.toISODate() ? '' : ` (${end.toFormat('ccc d LLL')})`;
    return `${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}${endDay} ${zone.label}${suffix}`;
  });
  return `${first.toFormat('ccc d LLL yyyy')}: ${lines.join(' / ')}\n${slot.reason}\nUTC: ${slot.start} → ${slot.end}`;
}
const escapeText = (text: string) => text.replaceAll('\\', '\\\\').replace(/\r\n|\r|\n/g, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');
const stamp = (iso: string) => DateTime.fromISO(iso, { zone: 'UTC' }).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");

/** RFC 5545 line folding by UTF-8 octets, including the continuation space. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  let current = '';
  let length = 0;
  const lines: string[] = [];
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) {
      lines.push(current);
      current = ' ';
      length = 1;
    }
    current += character;
    length += bytes;
  }
  lines.push(current);
  return lines.join('\r\n');
}

/** UTC instants preserve DST folds/gaps without timezone definitions or a server. */
export function calendarText(slot: Slot, created: string): string {
  let hash = 2166136261;
  for (const char of JSON.stringify([slot.start, slot.end, slot.zones.map(zone => zone.id)])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tzmeet//Meeting slots//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${stamp(slot.start)}-${hash.toString(16)}@tzmeet.local`, `DTSTAMP:${stamp(created)}`,
    `DTSTART:${stamp(slot.start)}`, `DTEND:${stamp(slot.end)}`,
    'SUMMARY:Team meeting', `DESCRIPTION:${escapeText(inviteText(slot))}`,
    'STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR'
  ].map(foldLine).join('\r\n') + '\r\n';
}

/** One RFC 5545 calendar containing all selected tentative slots. Explicit clock only. */
export function calendarCollectionText(slots: readonly Slot[], created: string): string {
  const events = slots.map(slot => {
    const calendar = calendarText(slot, created);
    const begin = calendar.indexOf('BEGIN:VEVENT');
    const end = calendar.indexOf('END:VEVENT') + 'END:VEVENT'.length;
    return calendar.slice(begin, end).replace('\r\nSTATUS:CONFIRMED\r\n', '\r\nSTATUS:TENTATIVE\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tzmeet//Meeting slots//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
