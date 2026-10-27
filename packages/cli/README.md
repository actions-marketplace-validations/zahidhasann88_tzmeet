# tzmeet

Find meeting times across time zones and check cron schedules for daylight saving problems, from the command line.

## Features

- Ranks meeting times by work hours, weekends, public holidays and prayer times in every zone.
- Follows a weekly meeting through daylight saving changes and exports it as an `.ics` series.
- Explains and converts cron schedules for Unix, Kubernetes, Spring, Quartz, AWS EventBridge, GitHub Actions, Jenkins and systemd.
- Checks schedule files in CI, with GitHub, GitLab Code Quality and SARIF output.

## Installation

```sh
npm install --global tzmeet
npx tzmeet --help   # or run it without installing
```

## Quick start

```sh
tzmeet --zones Asia/Dhaka,Europe/London,America/New_York --date 2026-11-02 --top 5
```

In the output, `*` marks an ideal time (inside work hours) and `~` an acceptable one.

## Commands

```sh
tzmeet --zones Asia/Dhaka,Europe/London --holiday-preset Asia/Dhaka=BD --prayer-location Dhaka
tzmeet zones london                                       # search time zone names
tzmeet recurring --zones Europe/London,America/New_York --date 2026-10-12 --time 14:00 --ics > sync.ics
tzmeet cron "30 2 * * *" --zone America/New_York          # explain, next runs, DST warnings
tzmeet cron "0 9 * * 1-5" --to quartz                     # convert syntax
tzmeet cron "0 9 * * *" --zone Asia/Dhaka --to-zone UTC   # convert time zone
tzmeet cron "every weekday at 9am Dhaka" --to kubernetes  # plain English
```

Quote cron expressions so the shell doesn't expand `*`. Run `tzmeet <command> --help` for every option.

## Options

| Option | Description | Default |
| --- | --- | --- |
| `--zones` | Comma-separated IANA zones; the first one sets the date | required |
| `--date` | Start date (`YYYY-MM-DD`) | today |
| `--duration` / `--days` / `--top` | Meeting minutes / days to search / results | 30 / 5 / 10 |
| `--work` / `--quiet` | Work hours / acceptable hours for every zone | 09:00-18:00 / 08:00-21:00 |
| `--zone-work`, `--weekend`, `--holiday` | Per-zone hours, weekend and holiday dates (`ZONE=value`) | |
| `--holiday-preset` | `BD`, `GB-ENG`, `IN`, `PK`, `AE` or `US` (`ZONE=BD`) | |
| `--busy` | Busy times from an `.ics` export (`ZONE=file.ics`) | |
| `--special-hours`, `--ramadan` | Different hours for a date range or for Ramadan | |
| `--optional` | Zone whose attendees never block a time | |
| `--rotation` | Also suggest `2` or `3` times to rotate weekly | |
| `--prayer-location`, `--prayer-method`, `--prayer-buffer` | Avoid prayer times | off / Karachi / 10 |
| `--json`, `--config` | JSON output; load a config file | |

Exit code is `0` when the search runs, even with no results, and `1` for invalid input.

## Configuration

A `tzmeet.config.json` in the current folder is loaded automatically. Command-line options override it.

```json
{
  "zones": [
    { "id": "Asia/Dhaka", "label": "Dhaka" },
    { "id": "America/New_York", "workStart": "08:00", "workEnd": "17:00" }
  ],
  "durationMinutes": 30
}
```

## Checking cron schedules in CI

`tzmeet cron --check <paths>` scans crontabs, Kubernetes CronJobs, GitHub Actions workflows, systemd timers, Jenkinsfiles and EventBridge schedules. It exits with `1` when a daylight saving change would skip or repeat a run. Add `--strict` to fail on warnings and `--format github|gitlab|sarif` for CI reports.

```yaml
# GitHub Actions
- uses: zahidhasann88/tzmeet@v0.6.0
  with:
    paths: k8s/
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/zahidhasann88/tzmeet
    rev: v0.6.0
    hooks:
      - id: tzmeet-cron-check
```

For GitLab CI, include `https://raw.githubusercontent.com/zahidhasann88/tzmeet/v0.6.0/templates/tzmeet-cron-check.gitlab-ci.yml`.

## Compatibility

Node.js 22.12 or later.

## License

[MIT](LICENSE)
