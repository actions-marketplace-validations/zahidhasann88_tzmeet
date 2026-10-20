# @tzmeet/core

The scheduling engine behind tzmeet. Finds meeting times that work across time zones. Runs in Node and the browser, with no network requests.

## Usage

```ts
import { findSlots } from '@tzmeet/core';

const result = findSlots({
  zones: [
    { id: 'Asia/Dhaka', label: 'Dhaka' },
    { id: 'America/New_York', label: 'New York', workStart: '08:00', workEnd: '17:00' },
    { id: 'Europe/London', label: 'London' },
  ],
  startDate: '2026-11-02',
  durationMinutes: 30,
});

for (const slot of result.slots.slice(0, 5)) {
  console.log(slot.reason);
}

if (result.slots.length === 0) {
  console.log(result.diagnostics.message, result.diagnostics.suggestion);
}
```

## Main functions

- `findSlots(input)` – returns the best meeting times, best first.
- `validateInput(input)` – checks input and returns friendly error messages.
- `listTimeZones(search?)` – lists time zone names.
- `convertTime({ time, from, to })` – converts a local time to other zones.
- `getPrayerWindows(date, rule)` – prayer times for a day.
- `inviteText(slot)`, `calendarText(slot, created)` – invite text and `.ics` content.

## Zone options

| Option | Default |
| --- | --- |
| `workStart` / `workEnd` | 09:00 / 18:00 |
| `quietBefore` / `quietAfter` (acceptable hours) | 08:00 / 21:00 |
| `weekend` (ISO days, 1 = Mon) | `[6, 7]`, or `[5, 6]` in Fri/Sat countries |
| `holidays` | `[]` (dates as YYYY-MM-DD) |
| `prayer` | off |

## How scoring works

Each city gets **ideal** (inside work hours, 2 points), **acceptable** (inside acceptable hours, 1 point) or **blocked** (weekend, holiday, too early/late, or prayer). A time is only shown if no city is blocked. Higher scores come first. Daylight saving changes are handled for you.

License: MIT
