# tzmeet

Find a meeting time that works for everyone on a team spread across time zones.

**[Try it live →](https://zahidhasann88.github.io/tzmeet/)**

![Shared 24-hour timeline for Dhaka, London and New York](docs/screenshots/demo.png)

## What it does

Add your team's cities. tzmeet looks through the week and shows the best meeting times, so nobody has to join:

- in the middle of the night
- on their weekend or a holiday
- during prayer time (optional)

Each result shows the time in every city, marked as **ideal** (during work hours) or **acceptable** (a bit early or late, but still reasonable). You can copy the invite text or download a calendar (`.ics`) file.

![Ranked meeting times with ideal and acceptable labels for each zone](docs/screenshots/result.png)

## Ways to use it

### 1. Web app (easiest)

Open **[zahidhasann88.github.io/tzmeet](https://zahidhasann88.github.io/tzmeet/)**. Nothing to install. Everything runs in your browser, and no data is sent anywhere.

### 2. Command line

Needs Node 20 or newer.

```sh
npx tzmeet --zones Asia/Dhaka,Europe/London,America/New_York --date 2026-11-02
```

```
Rank | Date (first zone) | Dhaka (Asia/Dhaka)            | London (Europe/London)        | New York (America/New_York)   | Reason
1    | 2026-11-02        | Mon 2 Nov 20:00-20:30 +0600 ~ | Mon 2 Nov 14:00-14:30 +0000 * | Mon 2 Nov 09:00-09:30 -0500 * | ...
```

`*` = ideal, `~` = acceptable. Run `npx tzmeet --help` for all options, or see the [CLI guide](packages/cli/README.md).

### 3. REST API

A free demo runs at **https://tzmeet-api.onrender.com** ([interactive docs](https://tzmeet-api.onrender.com/docs)). The first request may take up to a minute while it wakes up.

```sh
curl "https://tzmeet-api.onrender.com/v1/slots?zones=Asia/Dhaka,Europe/London&date=2026-11-02&format=text"
```

See the [API guide](packages/api/README.md) to run your own.

### 4. JavaScript / TypeScript library

```ts
import { findSlots } from '@tzmeet/core';

const result = findSlots({
  zones: [{ id: 'Asia/Dhaka' }, { id: 'Europe/London' }],
  startDate: '2026-11-02',
});
console.log(result.slots[0]);
```

See the [library guide](packages/core/README.md).

### 5. "My hours" link

Make a link with your working hours at **[zahidhasann88.github.io/tzmeet/#/me](https://zahidhasann88.github.io/tzmeet/#/me)** and put it in your email signature. Whoever opens it sees whether you're working now and your hours for the week, in their own time zone.

### 6. Cron schedules

tzmeet also explains cron schedules (Unix, Kubernetes, Spring, Quartz, AWS EventBridge, GitHub Actions, Jenkins, systemd timers, or plain English like "every weekday at 9am Dhaka"), converts them between syntaxes and time zones, and checks them for daylight saving problems: in the [web app](https://zahidhasann88.github.io/tzmeet/cron/), with `npx tzmeet cron`, or in CI with the GitHub Action, a [pre-commit hook or a GitLab CI template](packages/cli/README.md#check-schedules-in-ci):

```yaml
- uses: zahidhasann88/tzmeet@v0.4.0
  with:
    paths: k8s/
```

See the [CLI guide](packages/cli/README.md#cron-schedules).

## Defaults

- Work hours: 09:00–18:00
- Acceptable hours: 08:00–21:00
- Weekend: Saturday–Sunday (Friday–Saturday for Bangladesh, Saudi Arabia, Egypt and other Fri/Sat countries)
- Meeting length: 30 minutes, searching 5 days

You can change all of these for each city.

## Good to know

- Prayer times are calculated and approximate. Check your local mosque timetable.
- Public holidays can be switched on per city for Bangladesh, India, Pakistan, the UAE, the UK (England and Wales) and the US. Islamic holidays are approximate (they depend on moon sighting), and other holidays can be added by date.
- Each city can have different hours for a date range, such as shorter Ramadan office hours (Ramadan dates are calculated and approximate).
- For recurring meetings, tzmeet can suggest 2 or 3 times to alternate week by week, so no city always gets the early or late slot.
- Mark a city's attendees as optional: they never block a time, but times they can attend rank higher.
- You can import a calendar export (`.ics`) per city to block busy times. In the web app it's read in your browser only and never saved or shared; event titles are ignored. tzmeet never connects to your calendar account.

## For developers

You need Node 20+ and pnpm 10.

```sh
pnpm install
pnpm dev     # web app at http://localhost:5173
pnpm test    # run tests
pnpm build   # build everything
```

The code is split into `packages/core` (scheduling engine), `packages/cli`, `packages/api` and `apps/web`.

## License

[MIT](LICENSE). Release history is in [CHANGELOG.md](CHANGELOG.md).
