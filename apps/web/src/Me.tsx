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
import HolidayCalendarLinks from "./holiday-links";
import { ZoneInput } from "./Cron";
import { friendlyName } from "./state";
import {
  availabilityGrid,
  badgePreview,
  badgeSnippets,
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
export const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export interface PersonLabels {
  /** Visible text of the name field. */
  nameText: string;
  name: string;
  zone: string;
  start: string;
  end: string;
  weekend: (day: string) => string;
  holidays: string;
}

const meLabels: PersonLabels = {
  nameText: "Name",
  name: "Your name",
  zone: "Your time zone",
  start: "Work starts",
  end: "Work ends",
  weekend: (day) => `${day} weekend`,
  holidays: "Public holidays",
};

export function PersonFields({
  person,
  zones,
  onChange,
  labels,
}: {
  person: MeState;
  zones: string[];
  onChange: (changes: Partial<MeState>) => void;
  labels: PersonLabels;
}) {
  return (
    <>
      <label className="full-field">
        {labels.nameText}
        <input
          aria-label={labels.name}
          maxLength={40}
          placeholder="Optional"
          value={person.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>
      <ZoneInput
        label={labels.zone}
        zones={zones}
        value={person.zone}
        onPick={(zone) =>
          onChange({
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
            aria-label={labels.start}
            value={person.workStart}
            onChange={(event) => onChange({ workStart: event.target.value })}
          />
        </label>
        <label>
          Work ends
          <input
            type="time"
            aria-label={labels.end}
            value={person.workEnd}
            onChange={(event) => onChange({ workEnd: event.target.value })}
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
                aria-label={labels.weekend(day)}
                checked={person.weekend.includes(index + 1)}
                onChange={(event) =>
                  onChange({
                    weekend: event.target.checked
                      ? [...person.weekend, index + 1].sort()
                      : person.weekend.filter((value) => value !== index + 1),
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
          aria-label={labels.holidays}
          value={person.holidayPreset ?? ""}
          onChange={(event) =>
            onChange({
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
      {person.holidayPreset && (
        <HolidayCalendarLinks
          preset={person.holidayPreset}
          name={person.name || labels.holidays}
        />
      )}
    </>
  );
}

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
              <PersonFields
                person={draft}
                zones={zones}
                onChange={update}
                labels={meLabels}
              />
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
            {valid && (
              <section
                className="settings-section me-badge"
                aria-labelledby="me-badge-title"
              >
                <div className="section-heading">
                  <span className="step-number">02</span>
                  <h2 id="me-badge-title">Status badge</h2>
                </div>
                <p className="detail-hint">
                  For a README, website or email signature. It shows whether
                  you're working now and links to your hours.
                </p>
                <img
                  className="me-badge-preview"
                  src={badgePreview(draft, now)}
                  alt={`Badge preview: ${badgeSnippets(draft, window.location.href).alt}`}
                  height={20}
                />
                <div className="me-badge-actions">
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() =>
                      void copy(
                        badgeSnippets(draft, window.location.href).markdown,
                        "Badge Markdown copied.",
                      )
                    }
                  >
                    <Icon name="copy" />
                    Copy Markdown
                  </button>
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() =>
                      void copy(
                        badgeSnippets(draft, window.location.href).html,
                        "Badge HTML copied.",
                      )
                    }
                  >
                    <Icon name="copy" />
                    Copy HTML
                  </button>
                </div>
                <p className="detail-hint">
                  The badge updates every few minutes. It loads from the tzmeet
                  API, which only sees the hours in the badge's link.
                </p>
              </section>
            )}
          </aside>
        )}
        <section
          id="me-view"
          className="me-view auto-scrollbar"
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
      {person.holidayPreset && (
        <div className="me-holidays">
          {holidays.length > 0 ? (
            <>
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
            </>
          ) : (
            <strong>No holidays for {owner} in the next 30 days</strong>
          )}
          <HolidayCalendarLinks preset={person.holidayPreset} name={owner} />
        </div>
      )}
    </>
  );
}
