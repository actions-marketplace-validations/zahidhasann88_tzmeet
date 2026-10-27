# @tzmeet/core

Scheduling engine for finding meeting times across time zones and working with cron schedules.

## Features

- Ranked meeting slots with per-zone work hours, weekends, holidays, busy times and prayer times.
- Daylight saving aware: clock-change detection, recurring meetings and cron DST warnings.
- Cron parsing, explanation and conversion for eight dialects, including plain English input.
- `.ics` output for slots, weekly series and holiday calendars.

## Installation

Not published to npm. Inside the tzmeet monorepo, add it as a workspace dependency:

```json
{ "dependencies": { "@tzmeet/core": "workspace:*" } }
```

## Quick start

```ts
import { findSlots } from "@tzmeet/core";

const result = findSlots({
  zones: [
    { id: "Asia/Dhaka" },
    { id: "America/New_York", workStart: "08:00", workEnd: "17:00" },
  ],
  startDate: "2026-11-02",
});

console.log(result.slots[0]?.reason ?? result.diagnostics.message);
```

## API

| Function | Returns |
| --- | --- |
| `findSlots(input)` | Ranked slots, plus diagnostics when none are found |
| `validateInput(input)` | Validation result with readable messages |
| `fairRotation(result, { size })` | 2 or 3 slots to rotate weekly |
| `recurringImpact({ zones, startDate, time, weeks? })` | Each zone's local time per week for a weekly meeting |
| `availabilityNow(zone, at)` | Working, off, weekend or holiday at an instant |
| `listTimeZones(search?)` | IANA zone names |
| `convertTime({ time, from, to })` | A local time in other zones |
| `listTransitions(zone, from, to)` | Clock changes, marked `gap` or `fold` |
| `resolveLocal(zone, localDateTime)` | `ok`, `skipped` or `ambiguous`, with instants |
| `explainCron({ expression, from, zone?, dialect? })` | Description, next runs and DST warnings |
| `parseCron(expression, dialect?)` | Field-by-field validation |
| `convertCronDialect(expression, { to })` | The expression in another dialect |
| `convertCronZone({ expression, fromZone, toZone, from })` | The schedule for a scheduler in another zone |
| `parseNaturalCron(text, { dialect? })` | A cron expression from plain English |
| `inviteText(slot)`, `calendarText(slot, created)` | Invite text and an `.ics` event |
| `recurringCalendarText(impact, { created })` | An `.ics` weekly series |
| `holidayCalendarText(preset, { years, created })` | An `.ics` holiday calendar |
| `parseIcsBusy(text, { from, to, defaultZone })` | Busy intervals from an `.ics` export |
| `badgeSvg({ label, status, zone })` | A status badge as SVG text |

Invalid input to `findSlots` throws `InputValidationError`; call `validateInput` first to get messages instead.

## Configuration

Zone options for `findSlots`:

| Option | Default |
| --- | --- |
| `workStart` / `workEnd` | `"09:00"` / `"18:00"` |
| `quietBefore` / `quietAfter` (acceptable hours) | `"08:00"` / `"21:00"` |
| `weekend` (ISO days, 1 = Monday) | `[6, 7]`, or `[5, 6]` in Fri/Sat countries |
| `holidays` | `[]` (`YYYY-MM-DD` dates) |
| `holidayPreset` | `BD`, `GB-ENG`, `IN`, `PK`, `AE` or `US` |
| `busy` | `[]` (`{ start, end }` ISO instants) |
| `specialHours` | `[]` (`{ from, to, workStart, workEnd }`) |
| `optional` | `false` |
| `prayer` | off |

A slot is ideal for a zone inside work hours (2 points) and acceptable inside acceptable hours (1 point). Slots that any required zone can't attend are dropped.

## Compatibility

Runs in Node.js and browsers. Uses no Node.js or network APIs.

## License

[MIT](LICENSE)
