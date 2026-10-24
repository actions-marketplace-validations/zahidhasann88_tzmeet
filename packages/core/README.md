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
- `listTransitions(zone, from, to)` – daylight saving and other clock changes in a date range, each marked `gap` (clocks jump forward) or `fold` (clocks repeat).
- `resolveLocal(zone, localDateTime)` – tells you whether a local time is `ok`, `skipped` (inside a gap) or `ambiguous` (happens twice), with the real instants.
- `explainCron({ expression, from, zone?, dialect?, count?, displayZones? })` – explains a Unix, Kubernetes, Spring, Quartz, AWS EventBridge, GitHub Actions, Jenkins (`H`) or systemd `OnCalendar=` expression in plain English, lists its next runs in any zones, and warns about runs that daylight saving skips or repeats. Each engine's own DST behaviour is applied.
- `parseCron(expression, dialect?)` – checks a cron expression and returns field-by-field errors.
- `convertCronDialect(expression, { from?, to })` – converts between any of these syntaxes, and says what the target can't express.
- `parseNaturalCron(text, { dialect? })` – turns plain English ("every weekday at 9am Dhaka") into cron, with the zone it names and the scheduler's time-zone setting.
- `recurringCalendarText(impact, { created, title? })` – a weekly meeting from `recurringImpact` as an `.ics` series that calendars keep right through daylight saving.
- `convertCronZone({ expression, fromZone, toZone, from })` – rewrites a schedule for a scheduler in another time zone, with one expression per daylight saving period and the scheduler's own time-zone setting as the recommended fix.
- `recurringImpact({ zones, startDate, time, weeks?, durationMinutes? })` – follows a weekly meeting (fixed at `time` in the first zone) through the coming weeks and shows where each zone's local time moves because of daylight saving, and why.
- `fairRotation(result, { size: 2 | 3 })` – picks times from a search to alternate week by week, so the inconvenient slot is shared instead of always falling on the same city.
- `holidayCalendarText(preset, { years, created })` – a holiday preset as an `.ics` calendar of all-day events, with stable IDs so subscribed calendars update instead of duplicating.
- `getPrayerWindows(date, rule)` – prayer times for a day.
- `inviteText(slot)`, `calendarText(slot, created)` – invite text and `.ics` content.

## Zone options

| Option | Default |
| --- | --- |
| `workStart` / `workEnd` | 09:00 / 18:00 |
| `quietBefore` / `quietAfter` (acceptable hours) | 08:00 / 21:00 |
| `weekend` (ISO days, 1 = Mon) | `[6, 7]`, or `[5, 6]` in Fri/Sat countries |
| `holidays` | `[]` (dates as YYYY-MM-DD) |
| `holidayPreset` | off (`BD`, `GB-ENG`, `IN`, `PK`, `AE` or `US`; see `presetHolidays(preset, year)` and `presetNote(preset, year)`) |
| `busy` | `[]` (`{ start, end }` ISO instants; read them from an `.ics` file with `parseIcsBusy(text, { from, to, defaultZone })`) |
| `specialHours` | `[]` (`{ label?, from, to, workStart, workEnd, quietBefore?, quietAfter? }`; `ramadanDates(year, preset?)` gives approximate Ramadan dates) |
| `optional` | off (`true`: this zone never blocks a time; times it can attend rank higher) |
| `prayer` | off |

## How scoring works

Each city gets **ideal** (inside work hours, 2 points), **acceptable** (inside acceptable hours, 1 point) or **blocked** (weekend, holiday, too early/late, or prayer). A time is only shown if no city is blocked. Higher scores come first. Daylight saving changes are handled for you.

License: MIT
