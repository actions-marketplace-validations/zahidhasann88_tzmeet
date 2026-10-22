# @tzmeet/api

A simple REST API for finding meeting times across time zones. No database, no accounts.

Free demo: **https://tzmeet-api.onrender.com** · [Interactive docs](https://tzmeet-api.onrender.com/docs)

## Run it locally

```sh
pnpm install
pnpm --filter @tzmeet/api... build
pnpm --filter @tzmeet/api start     # http://localhost:3000
```

Or use the `Dockerfile` in this folder, or deploy to Cloudflare Workers with `wrangler.toml`.

## Endpoints

| Endpoint | What it does |
| --- | --- |
| `GET /v1/slots?zones=...&date=...` | Find meeting times |
| `POST /v1/slots` | Same, with a JSON body for per-city settings |
| `GET /v1/zones?search=dhaka` | Search time zone names |
| `GET /v1/convert?time=2026-11-02T10:00&from=Asia/Dhaka&to=Europe/London` | Convert a time |
| `GET /v1/cron?expression=30 2 * * *&zone=America/New_York&display=Asia/Dhaka,UTC` | Explain a cron expression (Unix, Kubernetes, Spring or Quartz): next runs and DST warnings |
| `GET /v1/recurring?zones=Europe/London,America/New_York&date=2026-10-12&time=14:00&weeks=26` | Follow a weekly meeting through DST changes, week by week |
| `GET /v1/health` | Health check |
| `GET /docs` | Interactive docs |

`/v1/slots` options: `top` (1–50, default 10) and `format` (`json`, `text` or `ics`).

`/v1/slots` and `/v1/recurring` accept a repeatable `holidayPreset=IANA_ZONE=BD|GB-ENG|US` to block that country's public holidays (POST bodies use `holidayPreset` on each zone).

## Examples

```sh
# Find times
curl "http://localhost:3000/v1/slots?zones=Asia/Dhaka,Europe/London&date=2026-11-02&top=3"

# Get a calendar file
curl "http://localhost:3000/v1/slots?zones=Asia/Dhaka,Europe/London&date=2026-11-02&format=ics" -o meetings.ics

# Custom work hours per city
curl http://localhost:3000/v1/slots -H 'Content-Type: application/json' -d '{
  "zones": [
    {"id": "Asia/Dhaka", "workStart": "10:00", "workEnd": "17:00"},
    {"id": "Europe/London"}
  ],
  "startDate": "2026-11-02"
}'
```

Errors look like this:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "zones[1].id: 'Asia/Dhka' is not a valid IANA time zone. Did you mean 'Asia/Dhaka'?" } }
```

## Settings

Set these as environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to listen on |
| `API_KEYS` | not set | Comma-separated keys. When set, requests need `Authorization: Bearer <key>` or `X-API-Key` |
| `CORS_ORIGINS` | `*` | Allowed browser origins |
| `RATE_LIMIT` | `60` | Requests per IP per window |
| `RATE_WINDOW_MS` | `60000` | Rate limit window in milliseconds |

Limits: 32 KB request body, 8 cities, 14 days, 50 results. Rate limits are kept in memory per server, so they reset on restart.

License: MIT
