# Changelog

Notable changes are recorded here. Package versions follow semantic versioning.

## [Unreleased]

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
