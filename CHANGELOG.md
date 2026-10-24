# Changelog

Notable changes are recorded here. Package versions follow semantic versioning.

## [Unreleased]

### Added

- More cron syntaxes in the explainer, converters, plain-English parser and `--check`: AWS EventBridge `cron(...)` (Quartz-style `?`, `L`, `W`, `#`, year field), GitHub Actions `schedule:` (POSIX fields, `timezone:` or UTC), Jenkins (`H`, `H(0-29)`, `@midnight`, `TZ=` line) and systemd `OnCalendar=` (weekdays, `..` ranges, repetition, shorthands like `weekly`, trailing time zone). Detected automatically, or set with `dialect`. Each engine's DST behaviour was checked against its docs or source: EventBridge skips the missing hour and runs once in the repeated one, GitHub Actions runs the missing hour's job right after the change, Jenkins skips the missing hour and runs twice in the repeated one, systemd skips the missing hour. Where an engine doesn't document the repeated hour, a `dst-maybe-double` warning says it may run twice. Jenkins `H` gets a `jenkins-hash` note.
- `tzmeet cron --check` also scans GitHub Actions workflows, systemd `*.timer` files, Jenkinsfiles and EventBridge schedules in CloudFormation, SAM, Serverless and Terraform files. With `--zone`, UTC-only GitHub and EventBridge schedules get a `utc-shift` warning when their local time moves with DST.
- `tzmeet cron --check --format gitlab` writes a GitLab Code Quality report and `--format sarif` writes SARIF 2.1.0 for GitHub code scanning.
- pre-commit hook `tzmeet-cron-check` (`.pre-commit-hooks.yaml`) that checks the schedule files in each commit.
- GitLab CI template (`templates/tzmeet-cron-check.gitlab-ci.yml`) that fails the pipeline on DST problems and shows them in merge requests.
- Native time-zone snippets for the new engines in `convertCronZone` (`ScheduleExpressionTimezone`, `timezone:`, `TZ=`, `OnCalendar=… zone`).
- Team hours page (`#/team`, shared through a `/team/` page with its own link preview): one link with up to 12 people, each with their own zone, work hours, weekend and public holidays. Shows who's working now, the longest stretches this week when everyone (or the most people) works, and a 7-day grid shaded by how many people are working, in the viewer's time zone. People can be added from their My hours links. "Find a meeting time" opens the meeting finder with the team; people in the same zone become one city with the hours they share.
- Holiday calendars: `GET /v1/holidays?preset=BD&year=2027` (JSON) and `GET /v1/holidays.ics?preset=BD`, a feed for this year and next that calendar apps can subscribe to (all-day events marked free, approximate dates labelled, stable UIDs, daily refresh hint, `ETag` and caching). In the web app, every holiday preset has "Download holidays (.ics)", made in the browser, and "Subscribe in your calendar" links for Google Calendar, Apple Calendar and Outlook; shared My hours pages offer them for that person's country. Also `holidayCalendarText` in `@tzmeet/core`.
- Status badge: `GET /v1/badge.svg` with the same parameters as a My hours link shows whether someone is working now, off, on their weekend or on a holiday (named), cached for 5 minutes with stale copies allowed while the API wakes up. The My hours builder previews the badge in the browser and copies it as Markdown or HTML linked to the hours page. Also `availabilityNow` and `badgeSvg` in `@tzmeet/core`.

### Changed

- On phones, the site's tool menu (Meetings, Cron, My hours, Team) gets its own row under the logo.
- On wide screens, the meeting finder's and cron page's settings stay in view while the results scroll (with their own scrollbar when taller than the screen, shown only while scrolling), and the My hours and Team builders keep the live preview in view while you edit.

## [0.4.0] - 2026-10-23

### Added

- Holiday presets for India (central government, Delhi: DoPT gazetted lists for 2026 and 2027), Pakistan and the UAE. `presetNote(preset, year)` says when a year's festival list isn't available.
- Bangladesh's Hindu and Buddhist public holidays for 2026 (Buddha Purnima, Janmashtami, Durga Puja).
- Imported calendars can be remembered on this device (browser storage only, never in share links).
- Link previews: Open Graph tags and preview images for the site, and a `/cron/` page with its own preview. The cron explainer's "Copy link" now uses it.

- Cron converters: `convertCronDialect` converts between Unix, Kubernetes, Spring and Quartz syntax (seconds and year fields, Quartz `?`, day-of-week numbering, day-of-month/day-of-week meaning), and `convertCronZone` rewrites a schedule for a scheduler in another time zone, with one expression per DST period and the native time-zone setting. Available as `tzmeet cron --to/--to-zone`, `GET /v1/cron/convert` and a Convert panel on the web cron page.
- Cron check for CI: `tzmeet cron --check <files/folders>` scans crontabs and Kubernetes CronJob YAML, fails on runs that DST skips, delays or doubles, warns about missing `spec.timeZone` and day-of-month/day-of-week OR, and prints GitHub annotations with `--format github`. Also a GitHub Action (`action.yml`).

- Plain-English cron: `parseNaturalCron("every weekday at 9am Dhaka")` gives `0 9 * * 1-5` in Asia/Dhaka (times, steps with windows, weekdays, days of the month, last day / nth weekday, months, zones by city or IANA ID) and reports anything it can't translate. `tzmeet cron` and the web cron page accept plain English; also `GET /v1/cron/natural`.
- Recurring calendar invites: `recurringCalendarText(impact)` writes a weekly series fixed in the first zone (`TZID`, `RRULE`, generated `VTIMEZONE`) so calendars keep it right through daylight saving. "Download weekly series" in the web app's "Check over time" panel, `tzmeet recurring --ics` and `/v1/recurring?format=ics`.
- "My hours" page (`#/me`): make a link with your name, time zone, work hours, weekend and public holidays; whoever opens it sees whether you're working now, your next working time and a 7-day grid in their own time zone. Shared through a `/me/` page with its own link preview.

### Changed

- Spring cron schedules now report that a time in the repeated DST hour runs twice, confirmed by running Spring 6.2.19 and 7.0.10. The `fold-maybe-twice` run note and `dst-maybe-double` warning code are removed.

## [0.3.0] - 2026-10-22

### Added

- Daylight saving helpers: `listTransitions` lists a zone's clock changes (gap or fold), and `resolveLocal` says whether a local time exists, is skipped or happens twice.
- Cron explainer for Unix, Kubernetes, Spring and Quartz syntax: plain-English description, next runs in any zones, and warnings about runs that DST skips or repeats, using each engine's own behaviour. Available as `explainCron`, `tzmeet cron`, `GET /v1/cron` and a `#/cron` page in the web app.
- Recurring meeting report: follow a weekly meeting through DST changes and see where each zone's local time moves, and why (`recurringImpact`, `tzmeet recurring`, `GET /v1/recurring`, "Check over time" on each web result).
- Public holiday presets for Bangladesh, the UK (England and Wales) and the US (`holidayPreset`, `--holiday-preset`). Islamic holidays are approximate.
- Busy times from calendar exports (`.ics`), including repeating events (`parseIcsBusy`, `--busy`, per-zone import in the web app, where calendars stay in the browser and aren't shared).
- Special hours for a date range, with a Ramadan shortcut (`specialHours`, `ramadanDates`, `--special-hours`, `--ramadan`).
- Fair rotation: 2 or 3 times to alternate weekly so no city always gets the inconvenient slot (`fairRotation`, `--rotation`, `rotation=` on `/v1/slots`, and a card in the web app).
- Optional attendees, who never block a time but make times they can attend rank higher (`optional`, `--optional`).

### Changed

- The web app runs slot searches in a Web Worker, so long ranges no longer freeze the page.
- Share links use a compact format (`?s=`) that stores only settings that differ from the defaults. Older `?state=` links still open.
- `ZoneSlot.classification` can be `blocked` for optional zones.

### Removed

- Dependabot configuration.

## [0.2.0] - 2026-10-15

### Added

- Per-zone holidays: list local dates (`holidays: ['2026-12-16']`, `--holiday Asia/Dhaka=2026-12-16`, `?holiday=…`) and they block those days like a weekend. Diagnostics report `holiday` as its own constraint, and the web timeline shows holidays in their own pattern.
- Overnight windows: work and allowed hours can run past midnight (e.g. work 22:00–06:00 inside 20:00–08:00) for night shifts. Daytime schedules behave exactly as before.
- Fri/Sat weekend defaults for Egypt, Jordan, Oman, Iraq, Algeria, Yemen, Sudan, Libya, Syria and the Maldives.
- "Copy link" on each web result opens the workspace with that slot selected and in view.
- Dependabot updates for npm packages, GitHub Actions and the API's Docker base image.

## [0.1.0] - 2026-10-15

Initial release. The CLI is published to npm as `tzmeet`; the web app is live on GitHub Pages.

### Added

- Shared core library (`@tzmeet/core`): browser-safe TypeScript with Luxon time zones, zod validation and config schema, IANA zone search, deterministic scoring, readable reasons and diagnostics when nothing fits.
- UTC candidate scanning across first-zone calendar days, with whole-span work/quiet/weekend checks that handle DST gaps, folds and half-hour shifts.
- Regional weekend defaults: Fri/Sat for Dhaka, Riyadh, Qatar, Kuwait, Bahrain and Jerusalem, Sat/Sun elsewhere (`defaultWeekend(id)`).
- Optional prayer-time constraints (adhan) with built-in cities or coordinates, calculation methods, buffers and per-zone overrides.
- `tzmeet` CLI: all scheduling flags, auto-discovered config file, flag-over-config precedence, table and JSON output, zone search and clear exit codes. Core is bundled; only commander is a runtime dependency.
- Static web app (Vite + React + Tailwind): zone picker, per-zone settings, ranked slots, shared 24-hour UTC timeline, invite text, `.ics` download, shareable URLs, light/dark theme and keyboard access. No backend or tracking.
- Stateless REST API (`@tzmeet/api`, Hono): JSON/text/ICS slots, zone search, time conversion, OpenAPI docs, API keys, rate limiting and request size limits. Runs on Node, Docker (Alpine) or Cloudflare Workers.
- Tests for core, CLI, API and web, plus desktop/mobile Playwright tests.
- CI on Node 20/22/24, GitHub Pages deployment, and a tag-triggered GHCR image workflow.

### Known limitations

- Prayer times are approximate; default adhan Asr convention is used and local timetable/Ramadan adjustments are not automatic.
- Work/allowed windows are non-overnight. No holidays, calendar busy events, accounts or attendee scheduling integrations.
- Browser timezone data depends on runtime ICU/IANA versions. Historical transition detection assumes transitions are separated by more than an hour.
- Timeline colors use conservative five-minute cells; exact returned meeting spans are authoritative.
- Large searches run on the browser main thread; at most 1,000 result cards are rendered.
- Shared URLs are plaintext and can be long; no server tokens, encryption or service-worker offline reload support.
- Automated accessibility checks do not constitute a complete accessibility certification.
