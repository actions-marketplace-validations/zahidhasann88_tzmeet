import { DateTime } from 'luxon';
import { classifySpans, type NormalizedInput } from '@tzmeet/core';

export type TimelineKind = 'work' | 'acceptable' | 'quiet' | 'weekend' | 'holiday' | 'prayer';
export interface TimelineSegment { left: number; width: number; kind: TimelineKind; description: string }
export interface TimelineRow { id: string; label: string; origin: string; segments: TimelineSegment[] }

/** Exactly 24 elapsed UTC hours; local dates/offsets can change inside each row. */
export function makeTimeline(input: NormalizedInput, date: string): TimelineRow[] {
  const start = DateTime.fromISO(date, { zone: 'UTC' }).startOf('day');
  const cells = Array.from({ length: 288 }, (_, i) => ({
    start: start.plus({ minutes: i * 5 }).toISO()!,
    end: start.plus({ minutes: (i + 1) * 5 }).toISO()!
  }));
  return input.zones.map(zone => {
    const evaluations = classifySpans(zone, cells, input.prayer);
    const segments: TimelineSegment[] = [];
    evaluations.forEach((evaluation, i) => {
      const kind: TimelineKind = evaluation.constraints.includes('weekend') ? 'weekend'
        : evaluation.constraints.includes('holiday') ? 'holiday'
        : evaluation.constraints.includes('prayer') ? 'prayer'
          : evaluation.constraints.includes('quiet') ? 'quiet'
            : evaluation.classification === 'ideal' ? 'work' : 'acceptable';
      const current = segments.at(-1);
      if (current?.kind === kind) current.width += 100 / 288;
      else segments.push({ left: i / 288 * 100, width: 100 / 288, kind, description: '' });
    });
    segments.forEach(segment => {
      const from = start.plus({ minutes: segment.left / 100 * 1440 }).setZone(zone.id).setLocale('en');
      const to = start.plus({ minutes: (segment.left + segment.width) / 100 * 1440 }).setZone(zone.id).setLocale('en');
      segment.description = `${zone.label ?? zone.id}: ${segment.kind}, ${from.toFormat('ccc HH:mm ZZZ')}–${to.toFormat('ccc HH:mm ZZZ')}`;
    });
    const local = start.setZone(zone.id).setLocale('en');
    return { id: zone.id, label: zone.label ?? zone.id, origin: `${local.toFormat('ccc d LLL, HH:mm')} at 00:00 UTC`, segments };
  });
}
