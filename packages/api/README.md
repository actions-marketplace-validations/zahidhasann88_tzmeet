# @tzmeet/api

Stateless HTTP REST transport over the unchanged tzmeet scheduling engine. **Implementation Phases 1–4 are complete. Nothing has been deployed or published.** The existing web app remains browser-only, static, offline-capable, and independent of this API.

No database, accounts, sessions, saved payloads, or persistent user data. The only request-derived state is bounded, short-lived **hashed-IP rate counters in process/isolate memory**. See rate-limit scope below.

## Local setup

Node 20+ runs the API; Node 22+ is required for the pinned Wrangler development tooling. pnpm 10.18.3 is pinned at the repository root.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @tzmeet/api... build
PORT=3000 HOST=0.0.0.0 pnpm --filter @tzmeet/api start
```

`createApp(options)` is a platform-neutral Hono app using standard Request/Response, Intl, Luxon, and WebCrypto APIs. `src/node.ts` and `src/worker.ts` are thin adapters. Use `app.request()` without network ports for tests:

```ts
import { createApp } from '@tzmeet/api';
const app = createApp({ log: () => {}, now: () => new Date('2026-10-14T12:00:00Z') });
const response = await app.request('/v1/health');
```

## Endpoints

| Method | Path | Input/result |
| --- | --- | --- |
| POST | `/v1/slots` | Core `FindSlotsInput` JSON, including global/per-zone prayer and per-zone work/weekend/quiet settings |
| GET | `/v1/slots` | Required comma-separated `zones` and `date`; optional `duration`, `days`, `step`, `work`, repeatable `zoneWork`/`weekend`, `quiet`, `prayerBuffer`, `prayerLocation`, `prayerMethod` |
| GET | `/v1/zones?search=dhaka` | `{zones:[{id,label,offset,offsetMinutes}]}` with current offsets |
| GET | `/v1/convert` | Required local ISO `time`, `from`, comma-separated `to`; optional `disambiguation=reject|earlier|later` |
| GET | `/v1/health` | `{status:"ok",version:"0.1.0"}`; public even in key mode |
| GET | `/openapi.json` | Zod-generated OpenAPI 3.0.3, examples, formats, and optional key schemes |
| GET | `/docs` | Public interactive Scalar reference |

Slots query options: `top=1..50` (default **10**), `format=json|text|ics` (default **json**). JSON returns `{slots,diagnostics,meta:{count,generatedAt,version}}`; every slot and diagnostics object is directly core output. No slots is HTTP **200**, with empty JSON/ICS or diagnostic text. Text joins the exact browser invite formatter with blank lines. ICS contains all returned/top-capped slots in **one calendar**, each `STATUS:TENTATIVE`, UTC DTSTART/DTEND, stable unique UID, escaped text and UTF-8 75-octet folding.

HTTP dates are explicit; no server-today fallback. CLI flags and GET overrides use the same additive pure `core.parseScheduleInput()` helper; CLI config/today behavior remains in its Node wrapper. Defaults: 5 days, 30-minute duration, 15-minute step, 09:00–18:00 work, 08:00–21:00 allowed hours, Sat/Sun weekends. Set Dhaka's Fri/Sat weekend explicitly if desired.

### curl examples

```sh
BASE=http://localhost:3000

# Simple GET (query values encoded properly):
curl --get "$BASE/v1/slots" \
  --data-urlencode 'zones=Asia/Dhaka,America/New_York,Europe/London' \
  --data-urlencode 'date=2026-11-02' --data-urlencode 'days=1' \
  --data-urlencode 'weekend=Asia/Dhaka=fri,sat' --data-urlencode 'top=2'

# Per-zone work/quiet/weekend/prayer plus global prayer fallback:
curl "$BASE/v1/slots?top=3" -H 'Content-Type: application/json' --data '{
  "zones": [
    {"id":"Asia/Dhaka","label":"Dhaka","workStart":"10:00","workEnd":"17:00",
     "quietBefore":"07:00","quietAfter":"22:00","weekend":[5,6],
     "prayer":{"location":"Dhaka","method":"Karachi","bufferMinutes":10}},
    {"id":"Europe/London","label":"London","weekend":[6,7],
     "prayer":{"location":"London","method":"NorthAmerica","bufferMinutes":5}}
  ],
  "startDate":"2026-11-02","days":1,"durationMinutes":30,"stepMinutes":15,
  "prayer":{"location":"Dhaka","method":"Karachi","bufferMinutes":10}
}'

# Repeated per-zone work controls, coordinate prayer location, text output:
curl --get "$BASE/v1/slots" \
  --data-urlencode 'zones=Asia/Dhaka,Europe/London' --data-urlencode 'date=2026-11-02' \
  --data-urlencode 'zoneWork=Asia/Dhaka=10:00-17:00' \
  --data-urlencode 'zoneWork=Europe/London=09:00-18:00' \
  --data-urlencode 'prayerLocation=23.8103,90.4125' --data-urlencode 'prayerMethod=MWL' \
  --data-urlencode 'prayerBuffer=10' --data-urlencode 'format=text'

# One tentative calendar for all five returned slots:
curl --get "$BASE/v1/slots" \
  --data-urlencode 'zones=Asia/Dhaka,Europe/London' --data-urlencode 'date=2026-11-02' \
  --data-urlencode 'top=5' --data-urlencode 'format=ics' --output meetings.ics

curl "$BASE/v1/zones?search=dhaka"
curl --get "$BASE/v1/convert" --data-urlencode 'time=2026-11-02T10:00' \
  --data-urlencode 'from=Asia/Dhaka' --data-urlencode 'to=Europe/London,America/New_York'

# Validation error / nearest zone suggestion:
curl --get "$BASE/v1/slots" --data-urlencode 'zones=UTC,Asia/Dhka' \
  --data-urlencode 'date=2026-11-02'
```

Example error:

```json
{"error":{"code":"VALIDATION_ERROR","message":"zones[1].id: 'Asia/Dhka' is not a valid IANA time zone. Did you mean 'Asia/Dhaka'?","details":[{"field":"zones[1].id","message":"'Asia/Dhka' is not a valid IANA time zone. Did you mean 'Asia/Dhaka'?","suggestion":"Asia/Dhaka"}]}}
```

Errors use `{error:{code,message,details?}}`, precise bracket-indexed fields and no stacks/internal exceptions. Statuses: 400 invalid JSON/content type/fields/civil time, 401 invalid/missing key, 404 unknown route, 405 unsupported method (`Allow` included), 413 oversized body, 429 rate limit (`Retry-After`), 500 sanitized unexpected failure. Unknown fields reject. Auth/rate middleware runs before body validation, so 401/429 can take precedence over 400/413.

### TypeScript fetch

```ts
const base = 'http://localhost:3000';
const query = new URLSearchParams({ zones: 'Asia/Dhaka,Europe/London', date: '2026-11-02', days: '1', top: '3' });
const response = await fetch(`${base}/v1/slots?${query}`, {
  // Optional when API_KEYS is enabled:
  // headers: { Authorization: `Bearer ${apiKey}` },
});
const body = await response.json();
if (!response.ok) throw new Error(`${response.status}: ${body.error.message}`);
console.log(body.slots, body.meta);
```

### Python requests

```python
import requests
response = requests.get('http://localhost:3000/v1/slots', params={
    'zones': 'Asia/Dhaka,Europe/London', 'date': '2026-11-02', 'days': 1, 'top': 3,
}, timeout=30)  # Optional: headers={'X-API-Key': api_key}
body = response.json()
if not response.ok:
    raise RuntimeError(f"{response.status_code}: {body['error']['message']}")
print(body['slots'])
```

## Safety/configuration

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Node integer TCP port 1–65535 |
| `HOST` | `0.0.0.0` | Node listen address |
| `API_KEYS` | unset | Comma-separated deployment secrets; enables auth for slots/zones/convert |
| `CORS_ORIGINS` | `*` | Comma-separated exact browser origins; wildcard applies only to GET/HEAD |
| `RATE_LIMIT` | `60` | Requests per IP/window, including invalid/auth-denied requests and public health/docs |
| `RATE_WINDOW_MS` | `60000` | Positive fixed-window duration |
| `RATE_MAX_BUCKETS` | `10000` | Maximum distinct hashed-IP counters, plus one shared overflow counter |

Factory equivalents: `apiKeys`, `corsOrigins`, `rateLimit:{limit,windowMs,maxBuckets}`, injected `now`, `log`, and trusted `clientIp(request,bindings)`.

- Actual streamed **body bytes <=32 KiB**, regardless of declared Content-Length; compressed bodies reject. Eight zones/destinations, fourteen days, step >=5 minutes, duration 5–480, top <=50. Core library limits remain unchanged.
- Supply `Authorization: Bearer <key>` **or** `X-API-Key`. An Authorization header takes precedence; malformed/conflicting credentials fail closed. Native WebCrypto HMAC verification compares fixed-size signatures and verifies **all configured keys** without an early-match shortcut. Use HTTPS and keep keys out of URLs and source control.
- Hono `secureHeaders`; a fresh server-generated `X-Request-Id` on responses; JSON logs contain **only method, path (no query), status, duration in milliseconds, id**. Optional log sink failures cannot break responses. No body/key/error-stack logging.
- CORS never enables credentials. Wildcard GET/HEAD can use permitted auth headers; cross-origin POST requires an explicit allowed origin. OPTIONS preflights are exempt from auth/rate counting. CORS is a browser policy, not authentication.
- Node uses the socket remote address and ignores spoofable forwarded headers. Worker trusts Cloudflare's `CF-Connecting-IP` only at the Cloudflare adapter boundary. Behind a Node reverse proxy, all clients otherwise share the proxy IP bucket: configure a custom trusted-IP hook only after verifying the proxy/network boundary. Do not blindly trust `X-Forwarded-For`.
- Rate state is **per process/isolate/environment**, not distributed or durable. It resets on restarts/binding changes, and concurrent replicas multiply the effective limit. Expired hashed counters are swept on incoming requests; overflow clients share a counter rather than evicting existing limits. It is intentionally not a globally enforceable quota. Add an infrastructure gateway limit when needed; no DB/KV is introduced here.

### Caching

- Health: `public, max-age=30`; public zones: `public, max-age=60` (offsets may be up to 60 seconds old).
- GET slots: `public, max-age=30` only if the core's **entire UTC range** is wholly past/future relative to the request clock. The date is explicit and scheduling has no now filter; cached `generatedAt` remains the original generation time.
- POST slots, ranges containing now, conversions, docs/spec and errors: `no-store`.
- Key-protected zones/slots remain `no-store` even for otherwise cacheable ranges. Health remains public. No server-side result cache or request persistence.

Conversions use Luxon, not hand-written offset arithmetic. Gaps/date skips reject instead of silently shifting. Repeated fall-back times require a matching explicit offset or `disambiguation=earlier|later`. Explicit offsets must agree with the source zone. Prayer calculations are approximate and not mosque timetables; original core limitations apply.

## Docker (you deploy later)

Build context is the repository root. The multi-stage image contains production dependencies/core output, runs as `node` (non-root), binds 0.0.0.0, handles termination, and includes `/v1/health` checks.

```sh
docker build -f packages/api/Dockerfile -t tzmeet-api .
docker run --rm -p 3000:3000 \
  -e PORT=3000 -e HOST=0.0.0.0 \
  -e API_KEYS='replace-with-a-long-random-secret' \
  -e CORS_ORIGINS='https://your-app.example' \
  -e RATE_LIMIT=60 -e RATE_WINDOW_MS=60000 tzmeet-api
curl http://localhost:3000/v1/health
curl -H 'Authorization: Bearer replace-with-a-long-random-secret' \
  'http://localhost:3000/v1/zones?search=dhaka'
```

Place behind HTTPS in production. Docker was **not available in the implementation sandbox**, so actual image build/run is assigned to the checked-in CI job. The same `pnpm deploy --prod --legacy` standalone dependency layout was locally built and exercised; this command only prepares local files, not a cloud deployment.

## Cloudflare Workers (you deploy later)

The Worker requires no persistent bindings and no `nodejs_compat`. Wrangler is pinned in devDependencies; use Node 22+ for its CLI.

```sh
pnpm --filter @tzmeet/api... build
WRANGLER_SEND_METRICS=false pnpm --filter @tzmeet/api worker:dry-run
pnpm --filter @tzmeet/api worker:size

# Only when YOU are ready to deploy, using your own Cloudflare account:
cd packages/api
pnpm exec wrangler login
pnpm exec wrangler secret put API_KEYS
# Edit non-secret [vars] in wrangler.toml for your CORS/rate configuration.
pnpm exec wrangler deploy
```

Verified local dry-run (Wrangler 4.151.0, 2026-10-14): **243.70 KiB uncompressed / 74.62 KiB gzip** (`249,549 / 76,407` bytes). No upload/deployment occurred. Cloudflare's current official documentation states **64 MiB uncompressed** for Free/Paid Workers, with no compressed-size cap; this bundle fits, and also fits the older conservative 3 MiB gzip allowance. [1](https://developers.cloudflare.com/workers/platform/limits/)

**Bundle size is not CPU suitability.** Free Workers have **10 ms CPU/request**, which meaningful multi-zone/long-range searches can exceed. Use Node/Docker or an appropriately configured Paid Worker for such workloads, and profile production traffic. Dry-run does not prove edge CPU/startup/runtime performance. [1](https://developers.cloudflare.com/workers/platform/limits/)

## CI and verification

Existing Node 20/22/24 jobs include API lint/typecheck/tests/build. Added a Node 22 Worker dry-run/size job and a Docker build/non-root health smoke job. CI builds and smoke-tests the image without registry access. The separate `.github/workflows/docker.yml` pushes to GHCR **only on `v*` version tags**, after lint/typecheck/tests and a container smoke test; image names are `ghcr.io/<owner>/<repository>/tzmeet-api:<version>`. Actions/GHCR must be enabled by the repository owner.

Tests use `app.request()`/Worker fetch in-process, not external network: exact core scheduling parity, fixed-clock endpoint snapshots, mismatched DST calendars/folds/gaps, typo suggestions, API limits, malformed JSON/content type, actual body byte limits, fake-time rate resets, trusted IP boundaries, native key verification, security/log/CORS/cache behavior, parsed multi-event ICS, exact shared invite text, full OpenAPI validation without remote references, portable browser/Worker bundling, adapter and CI contracts.
