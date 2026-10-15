# tzmeet

Find meeting times that work for a team spread across time zones.

**[Try it live →](https://zahidhasann88.github.io/tzmeet/)**

![Shared 24-hour timeline for Dhaka, London and New York](docs/screenshots/demo.png)

![Ranked meeting times with ideal and acceptable labels for each zone](docs/screenshots/result.png)

You give it the zones, each team's working hours and weekend, and optionally prayer times. It scans the week and ranks the slots where nobody is asked to join at 2 a.m., on their weekend, or during prayer.

It comes in four pieces that all share one core library:

| Package | What it is |
| --- | --- |
| `packages/core` | The scheduling engine. Pure TypeScript, runs in Node and the browser. |
| `packages/cli` | `tzmeet` command-line tool (Node 20+). |
| `apps/web` | Static web app (Vite + React + Tailwind). No backend, no tracking. |
| `packages/api` | Optional stateless REST API (Hono), for Docker or Cloudflare Workers. |

## Getting started

You need Node 20+ and pnpm 10.

```sh
pnpm install
pnpm test        # unit tests
pnpm build       # builds every package
pnpm dev         # web app at http://localhost:5173
```

Other useful commands: `pnpm lint`, `pnpm typecheck`, `pnpm test:e2e` (Playwright; run `pnpm --filter @tzmeet/web exec playwright install chromium` once first).

## CLI

```sh
tzmeet --zones Asia/Dhaka,America/New_York,Europe/London \
  --date 2026-11-02 --duration 30 --weekend Asia/Dhaka=fri,sat --top 2
```

```
Rank | Date (first zone) | Dhaka (Asia/Dhaka)            | New York (America/New_York)   | London (Europe/London)        | Reason
-----+-------------------+-------------------------------+-------------------------------+-------------------------------+---------------------------------------------------------------
1    | 2026-11-02        | Mon 2 Nov 20:00-20:30 +0600 ~ | Mon 2 Nov 09:00-09:30 -0500 * | Mon 2 Nov 14:00-14:30 +0000 * | Ideal for New York & London, after work (acceptable) for Dhaka
2    | 2026-11-02        | Mon 2 Nov 20:15-20:45 +0600 ~ | Mon 2 Nov 09:15-09:45 -0500 * | Mon 2 Nov 14:15-14:45 +0000 * | Ideal for New York & London, after work (acceptable) for Dhaka
```

`*` means inside work hours, `~` means outside work hours but still reasonable.

Useful flags:

- `--days 5` sets how many days to search, and `--top 10` how many results to show.
- `--work 09:00-18:00` sets work hours for everyone. `--zone-work America/New_York=08:00-17:00` overrides one zone.
- `--quiet 08:00-21:00` sets the earliest and latest acceptable times.
- `--weekend Asia/Dhaka=fri,sat` sets one zone's weekend.
- `--prayer-location Dhaka --prayer-method Karachi --prayer-buffer 10` turns on prayer times.
- `--json` prints machine-readable output. `--config path` loads a config file.
- `tzmeet zones london` searches time zone names.

If a `tzmeet.config.json` exists in the current directory it is loaded automatically, and flags override it. See [`examples/tzmeet.config.json`](examples/tzmeet.config.json).

Exit code is `1` for invalid input. Finding no slots is not an error: you get exit `0` and an explanation of what blocked them.

To try it before it's on npm:

```sh
pnpm build
node packages/cli/dist/bin.js --help
```

## Web app

`pnpm dev` runs it locally. `pnpm --filter @tzmeet/web build` writes static files to `apps/web/out`, which you can host anywhere.

What it does:

- Add, remove and reorder zones, each with its own work hours, weekend and quiet hours. Sensible defaults are filled in, e.g. Fri/Sat weekend for Dhaka.
- Pick the date, meeting length, number of days, and optional prayer times.
- See ranked slots, plus a 24-hour timeline that shows every zone on the same UTC axis.
- Copy invite text or download an `.ics` file for any slot.
- Share the exact setup via the URL. Your last settings are also remembered locally.

Everything runs in the browser. After the page loads it makes no network requests.

## Library

```ts
import { findSlots } from '@tzmeet/core';

const result = findSlots({
  zones: [
    { id: 'Asia/Dhaka', label: 'Dhaka', weekend: [5, 6] },
    { id: 'America/New_York', label: 'New York' },
    { id: 'Europe/London', label: 'London' },
  ],
  startDate: '2026-11-02',
  durationMinutes: 30,
});

for (const slot of result.slots.slice(0, 5)) {
  console.log(slot.reason, slot.zones.map(z => z.formattedStart));
}
if (result.slots.length === 0) {
  console.log(result.diagnostics.message, result.diagnostics.suggestion);
}
```

Defaults are 09:00–18:00 work hours, 08:00–21:00 quiet hours, a Sat/Sun weekend (`[6, 7]`, ISO weekdays), 5 days, 30-minute meetings and a 15-minute step.

Other exports include `validateInput()`, `listTimeZones()`, `convertTime()`, `getPrayerWindows()`, `classifySpan()`, and the zod schemas (`findSlotsSchema`, `configSchema`) used by the CLI, web app and API. See [packages/core/README.md](packages/core/README.md).

## How slots are scored

1. The date range starts at midnight on `startDate` **in the first zone** and covers `days` calendar days.
2. Candidate start times are scanned in UTC every `stepMinutes`. All time zone conversion goes through Luxon, so DST changes are handled correctly, including the weeks when the US and UK change clocks on different dates.
3. For each zone, the whole meeting is checked, not just its start. A slot that crosses midnight, a work-hour boundary or a DST change is judged by its whole span. Each zone's verdict is one of:
   - **ideal**: entirely inside work hours
   - **acceptable**: outside work hours but inside quiet hours (e.g. 08:00–09:00 or 18:00–21:00)
   - **blocked**: falls on a weekend, before/after quiet hours, or overlaps a prayer time ± buffer
4. A slot is returned only if **no zone is blocked**.
5. Score = 2 per ideal zone + 1 per acceptable zone, plus a small tie-break (at most 0.09) that prefers earlier slots and times near the middle of the first zone's work day. Results are sorted by score.

Boundaries are inclusive: a meeting ending exactly at 18:00 is still ideal.

If nothing fits, the result explains which constraint rejected the most candidates and suggests what to relax.

## API

The API wraps the same core; it doesn't add any scheduling logic of its own.

```sh
pnpm --filter @tzmeet/api... build
pnpm --filter @tzmeet/api start     # http://localhost:3000, interactive docs at /docs
```

| Endpoint | Description |
| --- | --- |
| `POST /v1/slots` | Body is the same input as `findSlots()`. Add `?top=10&format=json\|text\|ics`. |
| `GET /v1/slots` | Same search via query params, using the CLI flag syntax. |
| `GET /v1/zones?search=dhaka` | Time zone search with current UTC offsets. |
| `GET /v1/convert?time=2026-11-02T10:00&from=Asia/Dhaka&to=Europe/London` | Convert a local time. |
| `GET /v1/health` | Health check. |
| `GET /openapi.json`, `GET /docs` | OpenAPI spec and interactive docs. |

Limits: 32 KB body, 8 zones, 14 days, 50 results.

```sh
# Simple search
curl "http://localhost:3000/v1/slots?zones=Asia/Dhaka,America/New_York,Europe/London&date=2026-11-02&weekend=Asia/Dhaka=fri,sat&top=5"

# Per-zone rules and a prayer buffer
curl http://localhost:3000/v1/slots -H 'Content-Type: application/json' -d '{
  "zones": [
    {"id": "Asia/Dhaka", "workStart": "10:00", "workEnd": "17:00", "weekend": [5, 6]},
    {"id": "Europe/London"},
    {"id": "America/New_York", "workStart": "08:00", "workEnd": "17:00"}
  ],
  "startDate": "2026-11-02",
  "prayer": {"location": "Dhaka", "method": "Karachi", "bufferMinutes": 10}
}'

# Download a calendar file
curl "http://localhost:3000/v1/slots?zones=Asia/Dhaka,Europe/London&date=2026-11-02&format=ics" -o meetings.ics
```

Errors always look like this:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "zones[1].id: 'Asia/Dakha' is not a valid IANA time zone. Did you mean 'Asia/Dhaka'?",
    "details": [{ "field": "zones[1].id", "message": "...", "suggestion": "Asia/Dhaka" }]
  }
}
```

From TypeScript:

```ts
const params = new URLSearchParams({ zones: 'Asia/Dhaka,Europe/London', date: '2026-11-02' });
const res = await fetch(`http://localhost:3000/v1/slots?${params}`);
const body = await res.json();
if (!res.ok) throw new Error(body.error.message);
console.log(body.slots);
```

From Python:

```python
import requests

res = requests.get('http://localhost:3000/v1/slots',
                   params={'zones': 'Asia/Dhaka,Europe/London', 'date': '2026-11-02'})
res.raise_for_status()
print(res.json()['slots'])
```

API keys, CORS, rate limiting and caching are configured with environment variables. See [packages/api/README.md](packages/api/README.md).

## Deploying

**Web app (GitHub Pages).** In your repo, go to Settings → Pages and set the source to "GitHub Actions". Every push to `main` then tests the app and deploys it via `.github/workflows/pages.yml`.

**API with Docker.**

```sh
docker build -f packages/api/Dockerfile -t tzmeet-api .
docker run -p 3000:3000 -e API_KEYS=your-secret -e CORS_ORIGINS=https://your-site.example tzmeet-api
```

Pushing a `v*` tag publishes the image to GitHub Container Registry (`.github/workflows/docker.yml`).

**API on Cloudflare Workers.**

```sh
cd packages/api
pnpm exec wrangler login
pnpm exec wrangler secret put API_KEYS   # optional
pnpm exec wrangler deploy
```

Long multi-zone searches can exceed the Workers free plan's 10 ms CPU limit. Use Docker or a paid plan for heavy use.

**CLI on npm.** See [docs/RELEASING.md](docs/RELEASING.md).

## Known limitations

- Prayer times are calculated astronomically and are approximate. They are not a substitute for a local mosque timetable, and Ramadan adjustments aren't applied.
- Work hours can't span midnight, and holidays or existing calendar events aren't considered.
- Time zone rules come from the Node/browser runtime, so keep it up to date.
- Searches in the web app run on the main thread; very large ranges can feel slow on low-end phones.

## License

[MIT](LICENSE). See [CHANGELOG.md](CHANGELOG.md) for release history.
