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
| `--holiday-preset` | Public holidays for one city: `BD`, `GB-ENG` (England and Wales) or `US`, e.g. `Asia/Dhaka=BD`. Islamic dates are approximate | |
| `--busy` | Block busy times from a calendar export for one city, e.g. `Asia/Dhaka=me.ics`. Titles aren't read | |
| `--prayer-location` | Avoid prayer times for a city or `lat,long` | off |
| `--prayer-method` | Prayer calculation method | Karachi |
| `--prayer-buffer` | Minutes to keep free around prayer | 10 |
| `--json` | Print JSON instead of a table | |
| `--config` | Load settings from a JSON file | |

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
