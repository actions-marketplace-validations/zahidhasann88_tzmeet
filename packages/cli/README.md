# tzmeet

Find humane meeting slots across teams in different time zones. Node **20+**, no backend, no calendar upload, no tracking. The TypeScript core is bundled into the CLI; only commander is a separate runtime dependency.

## Install

Once published to npm:

```sh
npm install --global tzmeet
```

For an unpublished local build from the monorepo:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/bin.js --help
# Create the installable npm tarball:
pnpm --dir packages/cli pack
npm install --global ./packages/cli/tzmeet-0.1.0.tgz
```

Building/packing does not publish anything. `prepack` rebuilds the core and CLI; the tarball includes the executable, source map, MIT license, third-party notices, and this README.

## Examples

```sh
tzmeet --zones Asia/Dhaka,America/New_York,Europe/London \
  --date 2026-11-02 --duration 30 --days 5 \
  --weekend Asia/Dhaka=fri,sat

tzmeet --zones Asia/Dhaka,America/New_York,Europe/London \
  --date 2026-11-02 --duration 30 \
  --zone-work America/New_York=08:00-17:00 \
  --weekend Asia/Dhaka=fri,sat --quiet 07:00-22:00 --top 5

tzmeet --zones Asia/Dhaka,Europe/London --date 2026-11-02 \
  --weekend Asia/Dhaka=fri,sat \
  --prayer-location Dhaka --prayer-method Karachi --prayer-buffer 10

tzmeet --config ./team.json --date 2026-11-02 --top 3 --json > slots.json

tzmeet zones london
tzmeet zones new_york
tzmeet --json zones dhaka
```

Tables show rank, first-zone date, each zone's **own local date, time range, UTC offset**, and a reason. Markers: `*` **ideal**, `~` **acceptable**. A changed offset across a DST fold is displayed explicitly. No ANSI color is emitted, so tables are safe to pipe or snapshot.

## Flags

| Flag | Meaning / default |
| --- | --- |
| `--zones <ids>` | Comma-separated unique IANA zone IDs; first zone anchors the date range |
| `--date <YYYY-MM-DD>` | Start date in the first zone; defaults to today there |
| `--duration <minutes>` | Meeting duration, default 30 |
| `--days <count>` | 1–31 calendar days, default 5 |
| `--step <minutes>` | UTC candidate grid, default 15 |
| `--work <HH:mm-HH:mm>` | Global work override, core default 09:00–18:00 |
| `--zone-work <zone=HH:mm-HH:mm>` | Repeatable per-zone work override |
| `--weekend <zone=fri,sat>` | Repeatable per-zone ISO weekend; core default Sat/Sun |
| `--quiet <HH:mm-HH:mm>` | Allowed early/late window, core default 08:00–21:00 |
| `--prayer-location <city>` | Enable common prayer instants using a city or `latitude,longitude` |
| `--prayer-method <method>` | Karachi default; MWL and other adhan methods supported |
| `--prayer-buffer <minutes>` | Symmetric buffer, 0–180, default 10 when prayers enabled |
| `--top <count>` | Number of results, 1–1000, default 10 |
| `--config <path>` | Explicit JSON file; otherwise discover `tzmeet.config.json` only in cwd |
| `--json` | Machine-readable result; stdout contains only JSON |
| `--help`, `--version` | Usage/version, exit 0 |

**Dhaka's Friday/Saturday weekend is not inferred by the core/CLI.** Set `--weekend Asia/Dhaka=fri,sat` or `weekend: [5, 6]` in config. Weekend flag values can be weekday abbreviations/full names (case-insensitive), ISO numbers 1–7, `none`, or an empty assignment to remove weekends. Duplicate weekdays are invalid.

Duration/step are integer minutes, 1–1440. Work hours must be within allowed hours, and neither window may be overnight. `24:00` is not accepted. Zone-specific overrides must target a selected zone; mistyped IDs do not silently create participants.

## Configuration and precedence

`tzmeet.config.json` is auto-discovered **only in the current working directory**. `--config` replaces that discovery and accepts a relative or absolute path. Missing automatic config is fine; missing explicitly requested config is an error. Files are strict JSON (UTF-8 BOM accepted, no comments/trailing commas) and validated with the core's zod `configSchema` **before flags are applied**. Invalid config is never silently repaired by flags.

```json
{
  "zones": [
    { "id": "Asia/Dhaka", "label": "Dhaka", "weekend": [5, 6] },
    { "id": "America/New_York", "workStart": "08:00", "workEnd": "17:00" },
    { "id": "Europe/London" }
  ],
  "startDate": "2026-11-02",
  "days": 5,
  "durationMinutes": 30,
  "stepMinutes": 15,
  "top": 10
}
```

Precedence is **validated config/core defaults → global flags → per-zone flags**, regardless of the ordering of global vs per-zone flags on the command line. Repeated per-zone overrides apply in order; the last override for a zone wins. Scalar flags use the last value.

- `--zones` replaces participant membership and ordering, but matching IDs retain their configured labels/settings until a flag overrides those fields. New IDs receive core defaults.
- `--work` / `--quiet` override all selected zones. `--zone-work` takes precedence over `--work`.
- `--date`, `--duration`, `--days`, `--step`, `--top` override their config counterparts. No commander default masks a configured value.
- Prayer flags merge into the **global** prayer rule. Buffer/method flags require a configured location or `--prayer-location`. A per-zone `prayer` config remains an override of the global rule, matching core semantics.
- Either config or flags must supply at least one zone. If date is omitted from both, today is calculated in the first zone, not the host machine's zone.

Prayer cities: Dhaka, London, New York, Karachi, Makkah, Dubai, Singapore. Methods: Karachi, UmmAlQura, MWL, Egyptian, Dubai, MoonsightingCommittee, NorthAmerica, Kuwait, Qatar, Singapore, Tehran, Turkey. Calculations are **approximate**, not authoritative local mosque timetables. Default adhan Asr convention is used.

## JSON and exit codes

JSON includes `slots` (top-N), `totalSlots` (all surviving slots before truncation), `range`, and `diagnostics` (full-scan counts and suggestions). Each slot includes UTC start/end, first-zone date, score/baseScore, local ISO times with offsets, formatted times, classification, and reason. A valid empty search still prints structured diagnostics.

- **0:** valid search, including no slots; zone search; help/version.
- **1:** invalid flags/input/config or calculation failure. Errors go to stderr; success output is not emitted.

`tzmeet zones [search]` uses runtime ICU names, is case-insensitive, does not load meeting configs, and lists all names if search is omitted. No matches is not an error.

## Evaluation summary

Candidates scan elapsed UTC time across the first zone's calendar-day range. Whole meetings must fit in the range. The core partitions each span at local midnight, work/quiet boundaries and DST changes, evaluating both endpoints and every interior piece. A work boundary crossing is acceptable; a weekend/quiet/prayer violation is blocked. Only meetings with no blocked participant are returned.

Work/quiet endpoints are inclusive. Ending exactly at a weekend midnight blocks; touching a buffered prayer boundary blocks. Repeated DST hours remain distinct ISO instants with different offsets; nonexistent wall-clock hours are skipped naturally.

Score is the sum of `ideal=2`, `acceptable=1`, plus a bounded tie-break below 0.1 preferring earlier UTC instants and the first zone's work-day midpoint. No tie-break can outweigh a classification point. Diagnostics count each zone/constraint separately; these counts can overlap.

See the monorepo README for the exact scoring formula, the browser-safe library API, full-span semantics, and known limitations. License: MIT.
