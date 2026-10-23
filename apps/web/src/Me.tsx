import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import {
  defaultWeekend,
  holidayPresetIds,
  holidayPresets,
  listTimeZones,
  suggestHolidayPreset,
  type HolidayPreset,
} from "@tzmeet/core";
import Icon from "./Icon";
import { ZoneInput } from "./Cron";
import { friendlyName } from "./state";
import {
  availabilityGrid,
  defaultMeState,
  meHash,
  meShareLink,
  nextWorkingTime,
  parseMeHash,
  statusNow,
  upcomingHolidays,
  type MeState,
} from "./me-state";

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const kindLabels = {
  work: "Working",
  reachable: "Can be reached",
  off: "Off",
} as const;
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export default function MePage({
  copy,
}: {
  copy: (text: string, message: string) => Promise<void>;
}) {
  const zones = useMemo(() => listTimeZones(), []);
  const [shared, setShared] = useState(() => parseMeHash(window.location.hash));
  const [viewerZone, setViewerZone] = useState(browserZone);
  const [draft, setDraft] = useState<MeState>(
    () =>
      shared ?? {
        ...defaultMeState(browserZone()),
        holidayPreset: suggestHolidayPreset(browserZone()),
      },
  );
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const person = shared ?? draft;
  useEffect(() => {
    if (shared) return;
    const url = new URL(window.location.href);
    url.hash = meHash(draft);
    window.history.replaceState(window.history.state, "", url);
  }, [shared, draft]);

  const valid = useMemo(() => {
    try {
      availabilityGrid(person, viewerZone, now, 1);
      return true;
    } catch {
      return false;
    }
  }, [person, viewerZone, now]);
  const name = person.name || (shared ? "They" : "You");
  const owner = person.name || friendlyName(person.zone);
  const update = (changes: Partial<MeState>) =>
    setDraft((current) => ({ ...current, ...changes }));

  return (
    <>
      <section className="intro" aria-labelledby="me-title">
        <div>
          <p className="eyebrow">
            <span className="status-dot" /> WORKING HOURS, IN YOUR TIME
          </p>
          <h1 id="me-title">
            {shared ? `When ${owner} is available` : "Share your working hours"}
            <span>.</span>
          </h1>
          <p className="intro-copy">
            {shared
              ? `Shown in your time zone (${friendlyName(viewerZone)}), with ${owner}'s weekend and public holidays.`
              : "Make a link for your email signature or profile. Whoever opens it sees your hours in their own time zone."}
          </p>
        </div>
      </section>
      <div className={shared ? "me-layout is-shared" : "me-layout"}>
        {!shared && (
          <aside className="settings" aria-label="Your working hours">
            <section className="settings-section">
              <div className="section-heading">
                <span className="step-number">01</span>
                <h2>Your hours</h2>
              </div>
              <label className="full-field">
                Name
                <input
                  aria-label="Your name"
                  maxLength={40}
                  placeholder="Optional"
                  value={draft.name}
                  onChange={(event) => update({ name: event.target.value })}
                />
              </label>
              <ZoneInput
                label="Your time zone"
                zones={zones}
                value={draft.zone}
                onPick={(zone) =>
                  update({
                    zone,
                    weekend: defaultWeekend(zone),
                    holidayPreset: suggestHolidayPreset(zone),
                  })
                }
              />
              <div className="field-pair">
                <label>
                  Work starts
                  <input
                    type="time"
                    aria-label="Work starts"
                    value={draft.workStart}
                    onChange={(event) =>
                      update({ workStart: event.target.value })
                    }
                  />
                </label>
                <label>
                  Work ends
                  <input
                    type="time"
                    aria-label="Work ends"
                    value={draft.workEnd}
                    onChange={(event) =>
                      update({ workEnd: event.target.value })
                    }
                  />
                </label>
              </div>
              <fieldset className="weekday-field">
                <legend>Weekend days</legend>
                <div className="weekday-options">
                  {dayNames.map((day, index) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        aria-label={`${day} weekend`}
                        checked={draft.weekend.includes(index + 1)}
                        onChange={(event) =>
                          update({
                            weekend: event.target.checked
                              ? [...draft.weekend, index + 1].sort()
                              : draft.weekend.filter(
                                  (value) => value !== index + 1,
                                ),
                          })
                        }
                      />
                      <span>{day}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="full-field">
                Public holidays
                <select
                  aria-label="Public holidays"
                  value={draft.holidayPreset ?? ""}
                  onChange={(event) =>
                    update({
                      holidayPreset: (event.target.value || undefined) as
                        | HolidayPreset
                        | undefined,
                    })
                  }
                >
                  <option value="">None</option>
                  {holidayPresetIds.map((id) => (
                    <option key={id} value={id}>
                      {holidayPresets[id]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button button-primary me-copy"
                disabled={!valid}
                onClick={() =>
                  void copy(
                    meShareLink(draft, window.location.href),
                    "Link copied. Anyone who opens it sees your hours in their time zone.",
                  )
                }
              >
                <Icon name="link" />
                Copy your link
              </button>
            </section>
          </aside>
        )}
        <section
          id="me-view"
          className="me-view"
          aria-labelledby="me-view-heading"
          tabIndex={-1}
        >
          <div className="me-viewer-zone">
            <ZoneInput
              label="Your time zone (viewer)"
              zones={zones}
              value={viewerZone}
              onPick={setViewerZone}
            />
          </div>
          {valid ? (
            <Availability
              person={person}
              name={name}
              owner={owner}
              viewerZone={viewerZone}
              now={now}
            />
          ) : (
            <p className="error-box" role="alert">
              Work hours must be two different times.
            </p>
          )}
          {shared && (
            <p className="detail-hint">
              Want your own?{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setDraft({
                    ...defaultMeState(browserZone()),
                    holidayPreset: suggestHolidayPreset(browserZone()),
                  });
                  setShared(null);
                }}
              >
                Make a link with your hours
              </button>
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function Availability({
  person,
  name,
  owner,
  viewerZone,
  now,
}: {
  person: MeState;
  name: string;
  owner: string;
  viewerZone: string;
  now: Date;
}) {
  const status = statusNow(person, now);
  const next = nextWorkingTime(person, now);
  const grid = availabilityGrid(person, viewerZone, now);
  const holidays = upcomingHolidays(person, now);
  const viewerNow = DateTime.fromJSDate(now, { zone: viewerZone });
  const nowCell = viewerNow.hour * 2 + (viewerNow.minute >= 30 ? 1 : 0);
  const at = (iso: string, zone: string) =>
    DateTime.fromISO(iso, { zone }).setLocale("en");
  return (
    <>
      <div className={`me-status is-${status.kind}`}>
        <h2 id="me-view-heading">
          {status.kind === "work"
            ? `${name} ${person.name ? "is" : "are"} working now`
            : `${name} ${person.name ? "is" : "are"} ${status.kind === "reachable" ? "just outside work hours" : "off right now"}`}
        </h2>
        <p>
          It's {status.local} in {friendlyName(person.zone)}.
        </p>
        {status.kind !== "work" && next && (
          <p>
            Next working time:{" "}
            <strong>{at(next, viewerZone).toFormat("ccc d LLL, HH:mm")}</strong>{" "}
            your time ({at(next, person.zone).toFormat("ccc HH:mm")} in{" "}
            {friendlyName(person.zone)}).
          </p>
        )}
      </div>
      <div className="me-legend">
        {(["work", "reachable", "off"] as const).map((kind) => (
          <span key={kind}>
            <i className={`me-dot is-${kind}`} />
            {kindLabels[kind]}
          </span>
        ))}
      </div>
      <div
        className="me-grid-wrap"
        tabIndex={0}
        role="region"
        aria-label="Next 7 days in your time zone, horizontally scrollable on small screens"
      >
        <table className="me-grid">
          <caption className="sr-only">
            {owner}'s availability for the next 7 days, in {viewerZone}, in
            half-hour steps
          </caption>
          <thead>
            <tr>
              <th scope="col">{friendlyName(viewerZone)}</th>
              {Array.from({ length: 24 }, (_, hour) => (
                <th key={hour} scope="col" colSpan={2}>
                  {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, rowIndex) => (
              <tr key={row.date}>
                <th scope="row">{row.label}</th>
                {row.cells.map((kind, cell) => (
                  <td
                    key={cell}
                    className={`is-${kind}${rowIndex === 0 && cell === nowCell ? " is-now" : ""}`}
                    title={`${row.label} ${String(Math.floor(cell / 2)).padStart(2, "0")}:${cell % 2 ? "30" : "00"}: ${kindLabels[kind]}`}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="detail-hint">
        Work hours {person.workStart}–{person.workEnd} in {person.zone}; "can be
        reached" is the hour either side. Daylight saving is handled for both
        zones.
      </p>
      {holidays.length > 0 && (
        <div className="me-holidays">
          <strong>Upcoming holidays for {owner}</strong>
          <ul>
            {holidays.map((holiday) => (
              <li key={holiday.date + holiday.name}>
                {DateTime.fromISO(holiday.date)
                  .setLocale("en")
                  .toFormat("ccc d LLL")}
                : {holiday.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
