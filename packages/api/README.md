# @tzmeet/api

Stateless REST API for finding meeting times across time zones and working with cron schedules.

Demo: https://tzmeet-api.onrender.com ([interactive docs](https://tzmeet-api.onrender.com/docs))

## Features

- Meeting slots as JSON, plain text or `.ics`, with per-zone settings in a JSON body.
- Cron explanation, conversion and plain-English parsing.
- Holiday calendar feeds and SVG status badges.
- OpenAPI document at `/openapi.json` and interactive docs at `/docs`.
- Optional API keys, CORS and per-IP rate limiting. No database.

## Installation

```sh
docker run -p 3000:3000 ghcr.io/zahidhasann88/tzmeet/tzmeet-api:0.6.0
```

From a clone of the [tzmeet repository](https://github.com/zahidhasann88/tzmeet):

```sh
pnpm install
pnpm --filter @tzmeet/api... build
pnpm --filter @tzmeet/api start
```

## Quick start

```sh
curl "http://localhost:3000/v1/slots?zones=Asia/Dhaka,Europe/London&date=2026-11-02&top=3"

curl http://localhost:3000/v1/slots -H "Content-Type: application/json" \
  -d '{"zones":[{"id":"Asia/Dhaka","workStart":"10:00","workEnd":"17:00"},{"id":"Europe/London"}],"startDate":"2026-11-02"}'
```

## API

| Endpoint | Description |
| --- | --- |
| `GET /v1/slots`, `POST /v1/slots` | Meeting slots (`zones`, `date`, `duration`, `days`, `top`, `format`) |
| `GET /v1/recurring` | A weekly meeting through DST changes (`zones`, `date`, `time`, `weeks`) |
| `GET /v1/zones` | Time zone search (`search`) |
| `GET /v1/convert` | A local time in other zones (`time`, `from`, `to`) |
| `GET /v1/cron` | Cron description, next runs and DST warnings (`expression`, `zone`, `display`) |
| `GET /v1/cron/convert` | Cron in another dialect or zone (`expression`, `to`, `zone`, `toZone`) |
| `GET /v1/cron/natural` | Cron from plain English (`text`, `dialect`) |
| `GET /v1/holidays`, `GET /v1/holidays.ics` | Public holidays as JSON (`preset`, `year`) or a calendar feed (`preset`) |
| `GET /v1/badge.svg` | Working-now status badge |
| `GET /v1/health` | Health check |

`/v1/slots` and `/v1/recurring` also take repeatable per-zone parameters in the form `ZONE=value`: `holidayPreset` (`BD`, `GB-ENG`, `IN`, `PK`, `AE`, `US`), `specialHours`, `ramadan` and `optional`. `POST` bodies set these on each zone and also accept `busy: [{ start, end }]`. See `/docs` for every parameter.

Errors return JSON with a `code`, a `message` and per-field `details`:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "zones[1].id: 'Asia/Dhka' is not a valid IANA time zone. Did you mean 'Asia/Dhaka'?" } }
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `API_KEYS` | not set | Comma-separated keys; requests then need `Authorization: Bearer <key>` or `X-API-Key` |
| `CORS_ORIGINS` | `*` | Allowed browser origins |
| `RATE_LIMIT` / `RATE_WINDOW_MS` | `60` / `60000` | Requests per IP per window |

Limits: 32 KB request body, 8 zones, 14 days, 50 results. Rate-limit counters are kept in memory per instance.

## Compatibility

Node.js 22.12 or later, Docker, or Cloudflare Workers (`wrangler.toml` in this folder).

## License

[MIT](LICENSE)
