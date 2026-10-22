# tzmeet

Find a meeting time that works across time zones, right from your terminal. Needs Node 20+.

Web app and source: [github.com/zahidhasann88/tzmeet](https://github.com/zahidhasann88/tzmeet)

## Quick start

```sh
npx tzmeet --zones Asia/Dhaka,Europe/London --date 2026-11-02
```

Or install it:

```sh
npm install --global tzmeet
```

In the results, `*` means **ideal** (during work hours) and `~` means **acceptable** (a little early or late).

## Examples

```sh
# Top 5 half-hour slots
tzmeet --zones Asia/Dhaka,America/New_York,Europe/London --date 2026-11-02 --top 5

# New York works 08:00-17:00
tzmeet --zones Asia/Dhaka,America/New_York --zone-work America/New_York=08:00-17:00

# Avoid prayer times (10 minutes either side)
tzmeet --zones Asia/Dhaka,Europe/London --prayer-location Dhaka --prayer-buffer 10

# Find a time zone name
tzmeet zones london
```

## Options

| Option | What it does | Default |
| --- | --- | --- |
| `--zones` | Cities as time zone names, comma-separated | required |
| `--date` | Start date (YYYY-MM-DD) | today |
| `--duration` | Meeting length in minutes | 30 |
| `--days` | How many days to search | 5 |
| `--top` | How many results to show | 10 |
| `--work` | Work hours for everyone | 09:00-18:00 |
| `--zone-work` | Work hours for one city, e.g. `Europe/London=10:00-19:00` | |
| `--quiet` | Earliest and latest acceptable time | 08:00-21:00 |
| `--weekend` | Weekend for one city, e.g. `Europe/London=sat,sun` or `=none` | Sat/Sun (Fri/Sat in Fri/Sat countries) |
| `--holiday` | Days off for one city, e.g. `Asia/Dhaka=2026-12-16` | |
| `--holiday-preset` | Public holidays for one city: `BD` (Bangladesh), `GB-ENG` (England and Wales), `IN` (India, central government), `PK` (Pakistan), `AE` (UAE) or `US`, e.g. `Asia/Dhaka=BD`. Islamic dates are approximate; India's festival dates are included for 2026–2027 | |
| `--busy` | Block busy times from a calendar export for one city, e.g. `Asia/Dhaka=me.ics`. Titles aren't read | |
| `--special-hours` | Different work hours for a date range, e.g. `Europe/London=2026-12-21..2026-12-31@10:00-16:00` | |
| `--ramadan` | Work hours during Ramadan for one city, e.g. `Asia/Dhaka=09:00-15:30`. Dates are calculated and approximate | |
| `--optional` | Attendees in this city are optional: they never block a time, but times they can attend rank higher, e.g. `America/New_York` | |
| `--rotation` | Also suggest `2` or `3` times to alternate weekly, so no city always gets the early or late slot | |
| `--prayer-location` | Avoid prayer times for a city or `lat,long` | off |
| `--prayer-method` | Prayer calculation method | Karachi |
| `--prayer-buffer` | Minutes to keep free around prayer | 10 |
| `--json` | Print JSON instead of a table | |
| `--config` | Load settings from a JSON file | |

## Cron schedules

Quote the expression so your shell doesn't expand `*`.

```sh
# Explain a schedule: plain English, next runs, DST warnings
tzmeet cron "30 2 * * *" --zone America/New_York

# Convert between Unix, Kubernetes, Spring and Quartz syntax
tzmeet cron "0 9 * * 1-5" --to quartz          # 0 0 9 ? * MON-FRI

# "I want 09:00 Dhaka, but the server runs in UTC"
tzmeet cron "0 9 * * *" --zone Asia/Dhaka --to-zone UTC
```

When daylight saving changes the gap between the zones, `--to-zone` lists one expression per period and recommends setting the scheduler's own time zone instead (`CRON_TZ`, `spec.timeZone`, `@Scheduled(zone)`, Quartz `inTimeZone`).

### Check schedules in CI

```sh
tzmeet cron --check . --zone America/New_York
```

Scans crontabs (`crontab`, `*.crontab`, `*.cron`, honouring `CRON_TZ=` lines) and Kubernetes CronJob YAML (`*.yaml`, `*.yml`). It exits with 1 when a run would be skipped, delayed or doubled by a clock change, or a schedule is invalid. Warnings (a CronJob without `spec.timeZone`, day-of-month and day-of-week both set) fail only with `--strict`. `--zone` is used where a file sets no time zone. Use `--format github` for pull-request annotations, or `--json`.

As a GitHub Action:

```yaml
- uses: zahidhasann88/tzmeet@v0.4.0
  with:
    paths: k8s/ deploy/crontab
    zone: America/New_York   # where no time zone is set
    strict: true             # also fail on warnings
```

## Config file

Put a `tzmeet.config.json` in your folder and it loads automatically. Command-line options override it.

```json
{
  "zones": [
    { "id": "Asia/Dhaka", "label": "Dhaka" },
    { "id": "America/New_York", "workStart": "08:00", "workEnd": "17:00" },
    { "id": "Europe/London" }
  ],
  "durationMinutes": 30,
  "top": 10
}
```

## Notes

- Exit code is `0` when the search runs (even with no results) and `1` for invalid input.
- If no slots are found, tzmeet tells you why and what to relax.
- Prayer times are approximate.

License: MIT
