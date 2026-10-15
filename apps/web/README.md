# tzmeet web

A browser-only meeting planner, powered directly by `packages/core`. No API routes, server actions, accounts, analytics, CDN fonts, or remote timezone/prayer services.

## Stack

- **Vite + React + TypeScript.** `index.html` → `src/main.tsx` mounts `src/App.tsx`. `vite build` writes static HTML/CSS/JS to `out/`; no Node service is needed on the deployment host. Core is aliased to its TypeScript source.
- **Tailwind/PostCSS** plus local CSS supply the design. System fonts and inline SVG icons mean no external assets or font requests.

The small Node server in `scripts/serve.mjs` only serves build files for local preview/testing. It is not part of the application deployment and exposes no application APIs.

## Run

From the monorepo root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @tzmeet/web dev          # Vite, port 5173, accepts preview hosts
```

Build and preview the production static build:

```sh
pnpm --filter @tzmeet/web build
pnpm --filter @tzmeet/web preview     # Vite preview, port 4173
# or: cd apps/web && node scripts/serve.mjs out 4180
```

The core is aliased to TypeScript source, so a separate published core package is not required. The deployment artifacts include an MIT license, third-party notices, and `.nojekyll`.

## Using the workspace

1. Add zones by searching an IANA identifier or city name. Defaults are Dhaka, London, and New York. Use the up/down controls to reorder; the first zone anchors the search date range. Removing the last remaining zone is disabled.
2. Expand **Settings** for each zone to change its city label, work hours, earliest/latest allowed times, and weekend days. Dhaka defaults to Friday/Saturday in the UI; New York and London default to Saturday/Sunday. Every regional default remains editable. Work hours must fit within allowed hours; overnight windows are not supported.
3. Pick the starting date, duration (including custom integer minutes), days, and UTC scan step. Valid changes automatically update results; **Find meeting times** moves to the results. Invalid edits show core validation messages and are not persisted/shared until corrected.
4. Optionally enable prayer buffers with a built-in city or custom coordinates, adhan method, and symmetric buffer. One global location supplies real instants for all zones. Per-zone prayer overrides embedded in a shared state remain overrides; the UI explains these when present. Calculations are approximate, not local mosque timetables.
5. Choose a slot to highlight it across the timeline and expand exact ISO instants, local offsets, reasons, and the score breakdown. The list initially shows 10 and can reveal more, capped at 1,000 rendered cards.
6. **Copy invite text** includes every zone's time range, differing day labels, reason, and UTC interval. If clipboard permission is unavailable, a focused, selectable text field is provided.
7. **Download .ics** creates a local browser Blob. RFC 5545 UTC DTSTART/DTEND preserve exact instants across DST; text escaping and UTF-8 line folding protect formatting. The file contains a generic “Team meeting,” not attendee emails or a sent invitation.
8. **Share workspace** copies a URL containing all settings and view state. No server stores a share token. The theme toggle supports light/dark, with visible keyboard focus and reduced-motion support.

## Reading the timeline

- The day picker selects a **UTC date**. Every row covers the same 24 elapsed hours, from 00:00 through 24:00 UTC; it is not a local civil-day ruler.
- Each row labels the local date/time at the UTC origin. Local dates and offsets may change within the bar; DST gaps/folds are naturally represented by the shared UTC axis.
- Colors represent work, acceptable, quiet-blocked, weekend, and prayer constraints. Weekend takes display priority over prayer, then quiet, then work/acceptable when more than one applies.
- Colors use conservative **5-minute full-span cells** evaluated by the same core. A partially blocked cell is colored blocked; exact meeting spans/results remain authoritative. This can overstate a boundary by less than one cell, and deliberately includes closed endpoint rules.
- Faint spans show candidate meetings across every bar. An outlined span shows the selected slot. Start markers and large result controls are keyboard operable. The timeline scrolls horizontally on narrow screens without overflowing the entire page.
- `classifySpans()` is an additive pure core export that reuses per-search caches to classify a batch of spans efficiently; `classifySpan()` remains compatible with Phase 1.

## URL and persistence contract

State is versioned JSON in the `state` query parameter, percent-encoded via URLSearchParams and validated with zod + core validation. It includes ordered zone rules, date, duration, days, step, optional prayer, retained prayer controls, theme, UTC timeline day, selected/expanded slot, expanded zone panels, custom-duration mode, and the number of displayed results.

URL state takes precedence over localStorage. Last-used valid state is stored under `tzmeet:state:v1`; access is always guarded with try/catch. Invalid share URLs open a fresh workspace with a notice; malformed/denied storage falls back safely. Inputs with validation errors remain editable but do not replace the last valid saved/shared state. Browser back/forward events can restore valid URL state.

Shared URLs are **not encrypted** and may contain team labels and location coordinates. Share them only intentionally. Query strings may appear in browser history or a static host's ordinary access logs when a URL is loaded. The application itself makes no API, fetch/XHR, WebSocket, analytics, or external-resource requests in production; initial same-origin static asset loads are still required. Computation and exports keep working offline **after the page assets have loaded**. No service worker/offline reload cache is provided.

## Tests

```sh
pnpm test                          # core + CLI + web utility tests
pnpm lint
pnpm typecheck
pnpm --filter @tzmeet/web exec playwright install --with-deps chromium
pnpm --filter @tzmeet/web test:e2e
```

Playwright builds the Vite static output, serves only those files, and tests both desktop Chromium and a mobile Pixel viewport. Coverage includes adding/reordering zones, date/duration selection, exact URL round-trips, theme, prayer/persistence, ICS downloads, clipboard/fallback, validation/empty states, storage denial, keyboard use, and offline/no-runtime-network behavior. Axe checks WCAG A/AA-tagged rules in light/dark themes; this is an automated check, not a complete accessibility certification.

See the root README for the exact scoring/endpoint rules and prayer/timezone limitations. Very large ranges may take noticeable CPU time on low-powered devices; computation is currently on the main thread. Very long share URLs may exceed some hosting/browser limits; use fewer zones or shorter labels if needed.
