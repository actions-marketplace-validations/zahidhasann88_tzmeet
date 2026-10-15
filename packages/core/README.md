# @tzmeet/core

Pure TypeScript meeting-slot search for browsers and Node, using Luxon, adhan and zod. The source imports no Node APIs, reads no environmental clock, and makes no network requests.

## Local installation

Use it as a pnpm workspace dependency, or build/pack it locally:

```sh
pnpm --filter @tzmeet/core build
pnpm --dir packages/core pack
# From a consuming project:
npm install /path/to/tzmeet/packages/core/tzmeet-core-0.2.0.tgz
```

The normal ESM export includes TypeScript declarations and can be bundled by browser tools.

## Usage

```ts
import { findSlots, validateInput, type FindSlotsInput } from '@tzmeet/core';

const input: FindSlotsInput = {
  zones: [
    { id: 'Asia/Dhaka', label: 'Dhaka', weekend: [5, 6] },
    { id: 'America/New_York', label: 'New York' },
    { id: 'Europe/London', label: 'London' },
  ],
  startDate: '2026-11-02',
  days: 5,
  durationMinutes: 30,
  stepMinutes: 15,
};

const validation = validateInput(input);
if (!validation.success) {
  console.error(validation.errors);
} else {
  const result = findSlots(validation.data);
  console.log(result.slots.slice(0, 10));
  if (!result.slots.length) {
    console.log(result.diagnostics.message, result.diagnostics.suggestion);
  }
}
```

## API

- `findSlots(input)`: ranked slots, UTC range and full-scan diagnostics. Throws a path-specific `InputValidationError` on invalid input; no results is a valid return.
- `validateInput(unknown)`: success + normalized defaults, or failure + readable path/message errors.
- `listTimeZones(search?)`: sorted runtime IANA names, including UTC.
- `findSlotsSchema`, `configSchema`, `zoneSchema`, `prayerSchema`: shared strict zod schemas.
- `classifySpan(zone, startISO, endISO, prayer?)`: full-span ideal/acceptable/blocked result for explicit-offset ISO instants.
- `classifySpans(zone, spans, prayer?)`: batch equivalent with reusable per-call caches, each span `{ start, end }`.
- `getPrayerWindows(date, rule)`: five buffered UTC prayer instants.
- `cities`, `prayerMethods`, and fully typed public interfaces. Every public function/type is documented with JSDoc in source/declarations.

## Exact rules

The first zone anchors the date range. Scan elapsed UTC minutes at the requested step and include only entire meetings that fit in that range. Partition each zone's span at local midnight, work/quiet boundaries and DST transitions; check both endpoints and all interiors. Repeated wall times remain separate instants; nonexistent wall times are skipped naturally.

A zone is ideal only when the whole span is inside work hours with no weekend/prayer block; acceptable when outside work but inside allowed hours; blocked on a weekend, quiet-hour violation or prayer overlap. No blocked participant is allowed in returned slots. Work/quiet boundaries are inclusive. A weekend midnight endpoint blocks; touching a buffered prayer boundary blocks.

Base score = sum of ideal:2 / acceptable:1. Tie-break = `0.06 * E + 0.03 * P`, where `E` is one minus the start's fractional elapsed distance through the UTC range, and `P = max(0, 1 - abs(first-zone meeting-midpoint clock minutes - work-midpoint clock minutes)/720)`. Sort descending score then ascending UTC start. The tie-break never outweighs one classification point.

Diagnostics count every violated zone/constraint; counts are not mutually exclusive. The largest bucket is the dominant constraint, accompanied by weekend context and a suggestion. Suggestions do not silently relax schedules.

Defaults: 5 days, 30-minute duration, 15-minute step; 09:00–18:00 work and 08:00–21:00 allowed hours. Weekends default to Sat/Sun, except Fri/Sat (`[5, 6]`) for Dhaka and other Friday/Saturday countries; see `defaultWeekend(id)`. An explicit `weekend` always wins. Work must fit inside allowed hours; either window may run past midnight (start later than end, e.g. 22:00–06:00). Optional per-zone `holidays` (YYYY-MM-DD) block whole local days. Limits: 20 zones, 31 days, 1–1440 integer duration/step minutes, prayer buffer 0–180.

Prayer locations can be coordinates or Dhaka, London, New York, Karachi, Makkah, Dubai, Singapore. Methods include Karachi, UmmAlQura, MWL and other supported adhan methods. A global location supplies common real instants to all zones; a per-zone rule overrides it. Prayer times are approximate, not mosque timetables. Default adhan Asr convention and method adjustments apply; unresolved polar calculations fail explicitly. Runtime ICU/IANA versions affect zone data; historical offset detection assumes transitions are separated by more than an hour.

See the monorepo README for full details and known limitations. License: MIT.


## Additive transport/format helpers

The optional REST package reuses this engine unchanged. `parseScheduleInput(options, config)` shares CLI-style work/weekend/quiet/prayer controls with GET transport; it requires an explicit/config date and never chooses today. `parseIntegerOption` and structured `ScheduleInputError.issues` support exact transport errors.

`convertTime({time,from,to,disambiguation?})`, `getTimeZoneInfo(id, at)` and `suggestTimeZone(id)` are Luxon/runtime-IANA helpers. Explicit instants/offsets are required where applicable; gaps reject and folds need explicit resolution.

`inviteText(slot)`, `foldLine(line)`, `calendarText(slot, created)` and `calendarCollectionText(slots, created)` share the browser invite/ICS formatter. Core calendar helpers require an explicit creation timestamp; the browser wrapper owns its optional now default. Collection events are tentative; the original single-event helper retains confirmed status. These helpers add no runtime dependencies, Node/network APIs or scheduling logic.
