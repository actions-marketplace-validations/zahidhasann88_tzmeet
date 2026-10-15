import { DateTime } from 'luxon';
import type { FindSlotsResult, NormalizedInput, ZoneSlot } from '@tzmeet/core';

/** JSON and table share the same capped slots; diagnostics cover the entire scan. */
export interface CliResult extends FindSlotsResult {
  totalSlots: number;
}

export function selectTop(result: FindSlotsResult, top: number): CliResult {
  return { ...result, slots: result.slots.slice(0, top), totalSlots: result.slots.length };
}

function printable(text: string): string {
  // Do not allow labels from JSON configuration to inject terminal controls.
  return [...text].map(character => {
    const code = character.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
  }).join('');
}

function localCell(zone: ZoneSlot): string {
  const start = DateTime.fromISO(zone.localStart, { setZone: true }).setLocale('en');
  const end = DateTime.fromISO(zone.localEnd, { setZone: true }).setLocale('en');
  const endLabel = start.toISODate() === end.toISODate() ? end.toFormat('HH:mm') : end.toFormat('ccc d LLL HH:mm');
  const offset = start.offset === end.offset ? start.toFormat('ZZZ') : `${start.toFormat('ZZZ')}/${end.toFormat('ZZZ')}`;
  return `${start.toFormat('ccc d LLL HH:mm')}-${endLabel} ${offset} ${zone.classification === 'ideal' ? '*' : '~'}`;
}

/** Deterministic plain-text table. Dates and offsets remain visible across DST/midnight. */
export function formatTable(result: CliResult, input: NormalizedInput): string {
  if (!result.slots.length) return `${result.diagnostics.message}\nSuggestion: ${result.diagnostics.suggestion}\n`;
  const headers = ['Rank', 'Date (first zone)', ...result.slots[0]!.zones.map(zone => `${zone.label} (${zone.id})`), 'Reason'];
  const rows = result.slots.map((slot, rank) => [String(rank + 1), slot.date, ...slot.zones.map(localCell), slot.reason]);
  const allRows = [headers, ...rows].map(row => row.map(printable));
  const widths = headers.map((_, i) => Math.max(...allRows.map(row => row[i]!.length)));
  const line = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i]!)).join(' | ').trimEnd();
  const divider = widths.map(width => '-'.repeat(width)).join('-+-');
  return [
    `tzmeet | ${input.durationMinutes}-minute meetings | ${input.stepMinutes}-minute grid`,
    `Showing ${result.slots.length} of ${result.totalSlots} slots. * ideal / ~ acceptable`,
    '',
    line(allRows[0]!),
    divider,
    ...allRows.slice(1).map(line),
    '',
    'Date column uses the first zone. Each zone shows its own local date and UTC offset.',
    result.diagnostics.message,
    ''
  ].join('\n');
}
