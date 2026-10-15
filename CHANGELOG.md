# Changelog

Notable changes are recorded here. Package versions follow semantic versioning.

## [Unreleased]

### Changed

- Zones without an explicit `weekend` now default to Fri/Sat for Dhaka, Riyadh, Qatar, Kuwait, Bahrain and Jerusalem, and Sat/Sun elsewhere. This applies to the library, CLI, API and web app alike; new `defaultWeekend(id)` export.
- Web avatars use word initials for multi-word names ("New York" → "NY").
- Package metadata links to the GitHub repository, issues and live demo.
- The web app now builds with Vite only (the spec's stack); the Next.js static-export entry and `next` dependency were removed. Output is still `apps/web/out`, and `TZMEET_BASE_PATH` still sets the GitHub Pages base path.
- GHCR image publishing moved from `ci.yml` into a separate tag-triggered `docker.yml` workflow. CI still builds and smoke-tests the image, without registry write access.
- The root README gained "API" and "Deploying" sections.
- The API Docker image now uses `node:22-alpine` (355 MB → 266 MB); behaviour and full ICU time-zone data are unchanged.

## [0.1.0] - 2026-10-14

Initial release.

### Added

- pnpm TypeScript workspaces for `@tzmeet/core`, the `tzmeet` npm CLI, and the static web app.
- Pure browser-safe core with Luxon timezone conversion, zod validation/config schema, IANA zone discovery, deterministic scoring, local ISO/format output, human reasons and counted diagnostics.
- UTC candidate scanning over first-zone calendar-day ranges with whole-span work/quiet/weekend checks, DST folds/gaps, non-hour transitions, and documented inclusive endpoint rules.
- Optional adhan prayer constraints with built-in cities or coordinates, calculation methods, symmetric buffers and per-zone overrides.
- Single- and batch-span classification for shared UTC timelines.
- Commander CLI with all requested flags, cwd-only config discovery, explicit config paths, tested flag precedence, table/JSON output, zone search and consistent exit codes.
- Bundled npm CLI artifact with MIT and third-party license notices; isolated install smoke check without a separately published core package.
- One React app with Next.js static-export and Vite development/build entries, TypeScript and Tailwind/PostCSS.
- Searchable zone picker, add/remove/reorder, per-zone schedule controls, date/duration/grid/prayer controls and ranked, expandable slot details.
- Shared 24-hour UTC availability timeline, exact selected/candidate spans, conservative five-minute color cells, responsive layout and light/dark themes.
- Plain-text invite copying, manual clipboard fallback and RFC 5545 `.ics` downloads using UTC instants, escaping and byte-aware UTF-8 line folding.
- Versioned URL state, guarded localStorage, validation/empty states, keyboard controls and storage/link error recovery.
- Core/CLI/web/workflow regression tests and desktop/mobile Playwright tests, including offline behavior, production request checks and automated light/dark accessibility audits.
- CI on pushes/PRs for Node 20/22/24, actionlint workflow validation, npm artifact verification and browser failure traces.
- GitHub Pages workflow that uses real Pages base-path metadata, validates/tests the exact static export, and deploys only from `main` with scoped permissions.
- User/developer documentation, examples and MIT license.

### Known limitations

- Prayer times are approximate; default adhan Asr convention is used and local timetable/Ramadan adjustments are not automatic.
- Work/allowed windows are non-overnight. No holidays, calendar busy events, accounts or attendee scheduling integrations.
- Browser timezone data depends on runtime ICU/IANA versions. Historical transition detection assumes transitions are separated by more than an hour.
- Timeline colors use conservative five-minute cells; exact returned meeting spans are authoritative.
- Large searches run on the browser main thread; at most 1,000 result cards are rendered.
- Shared URLs are plaintext and can be long; no server tokens, encryption or service-worker offline reload support.
- Automated accessibility checks do not constitute a complete accessibility certification.
