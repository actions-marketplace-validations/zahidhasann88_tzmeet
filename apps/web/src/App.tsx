import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { DateTime } from "luxon";
import {
  cities,
  listTimeZones,
  prayerMethods,
  validateInput,
  type NormalizedInput,
  type Slot,
} from "@tzmeet/core";
import {
  holidayPresetIds,
  holidayPresets,
  presetHolidays,
  ramadanDates,
  suggestHolidayPreset,
  type HolidayPreset,
} from "@tzmeet/core";
import RotationCard from "./Rotation";
import { useSlotSearch } from "./search";
import Icon from "./Icon";
import {
  decodeState,
  encodeState,
  friendlyName,
  initials,
  persistState,
  regionalZone,
  restoreState,
  type WebState,
} from "./state";
import { downloadCalendar, inviteText } from "./invite";
import { makeTimeline } from "./timeline";
import CronPage from "./Cron";
import RecurringPanel from "./Recurring";
import {
  MAX_CALENDAR_BYTES,
  readCalendars,
  withBusy,
  type CalendarResult,
  type ImportedCalendar,
} from "./calendars";
import { CRON_ROUTE, isCronRoute } from "./cron-state";

type StateSetter = Dispatch<SetStateAction<WebState | null>>;
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const clock = (iso: string) =>
  DateTime.fromISO(iso, { setZone: true }).setLocale("en");
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function App() {
  const [state, setState] = useState<WebState | null>(null);
  const [notice, setNotice] = useState("");
  const [copyFallback, setCopyFallback] = useState("");
  // Imported calendars stay in memory: never in the URL, storage or share links.
  const [calendars, setCalendars] = useState<Record<string, ImportedCalendar>>(
    {},
  );
  const input = state?.input;
  const calendarResults = useMemo(
    () => (input ? readCalendars(calendars, input) : {}),
    [calendars, input],
  );
  const searchInput = useMemo(
    () => (input ? withBusy(input, calendarResults) : null),
    [input, calendarResults],
  );
  const [cronView, setCronView] = useState(() =>
    isCronRoute(window.location.hash),
  );
  useEffect(() => {
    const route = () => setCronView(isCronRoute(window.location.hash));
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);
  useEffect(() => {
    const restored = restoreState(window.location.search, storage());
    setState(restored.state);
    setNotice(restored.notice);
    const restore = () => {
      try {
        const value = decodeState(window.location.search);
        if (value) setState(value);
      } catch {
        setNotice("That link could not be restored.");
      }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.theme;
    try {
      const query = encodeState(state);
      const url = new URL(window.location.href);
      url.search = query;
      window.history.replaceState(null, "", url);
      persistState(state, storage());
    } catch {
      /* Incomplete/invalid edits stay visible but are not persisted. */
    }
  }, [state]);
  useEffect(() => {
    if (copyFallback) document.getElementById("manual-copy")?.focus();
  }, [copyFallback]);
  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(message);
    } catch {
      setCopyFallback(text);
      setNotice(
        "Clipboard access is unavailable. Select and copy the text below.",
      );
    }
  }
  if (!state || !searchInput)
    return (
      <main className="loading">
        <span className="logo-mark">
          <Icon name="clock" />
        </span>
        <p>Opening your timezone workspace…</p>
      </main>
    );
  return (
    <div className="site-shell">
      {cronView ? (
        <a
          className="skip-link"
          href="#cron-results"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById("cron-results")?.focus();
          }}
        >
          Skip to cron results
        </a>
      ) : (
        <a className="skip-link" href="#results">
          Skip to meeting results
        </a>
      )}
      <header className="site-header">
        <div className="brand">
          <span className="logo-mark">
            <Icon name="clock" />
          </span>
          <span>
            tzmeet<span className="brand-dot">.</span>
          </span>
          <span className="brand-caption">COMMON GROUND, ANYWHERE</span>
        </div>
        <div className="header-actions">
          <nav className="view-nav" aria-label="Tools">
            <a href="#/" aria-current={cronView ? undefined : "page"}>
              Meetings
            </a>
            <a href={CRON_ROUTE} aria-current={cronView ? "page" : undefined}>
              Cron
            </a>
          </nav>
          <span className="privacy-note">
            <Icon name="shield" /> Only in your browser
          </span>
          <button
            className="icon-button theme-button"
            aria-label={
              state.theme === "light"
                ? "Switch to dark theme"
                : "Switch to light theme"
            }
            onClick={() =>
              setState({
                ...state,
                theme: state.theme === "light" ? "dark" : "light",
              })
            }
          >
            <Icon name={state.theme === "light" ? "moon" : "sun"} />
          </button>
          {!cronView && (
            <button
              className="button button-outline share-button"
              onClick={() => {
                try {
                  void copy(
                    `${window.location.origin}${window.location.pathname}?${encodeState(state)}`,
                    "Share link copied. All settings are included.",
                  );
                } catch {
                  setNotice("Fix the input errors before sharing.");
                }
              }}
            >
              <Icon name="link" />
              <span>Share workspace</span>
            </button>
          )}
        </div>
      </header>
      <main>
        {cronView ? (
          <CronPage copy={copy} />
        ) : (
          <>
            <section className="intro" aria-labelledby="page-title">
              <div>
                <p className="eyebrow">
                  <span className="status-dot" /> LESS TIMEZONE GYMNASTICS
                </p>
                <h1 id="page-title">
                  Find common ground<span>.</span>
                </h1>
                <p className="intro-copy">
                  Good meetings start with a time that works for everyone.
                  <br className="desktop-break" /> Bring your teams together,
                  without the late-night compromise.
                </p>
              </div>
              <div className="intro-meta">
                <span className="meta-number">
                  {String(state.input.zones.length).padStart(2, "0")}
                </span>
                <div>
                  time zones
                  <br />
                  <strong>one shared moment</strong>
                </div>
              </div>
            </section>
            <div className="workspace">
              <aside className="settings" aria-label="Meeting settings">
                <ZoneSettings
                  state={state}
                  setState={setState}
                  calendars={calendars}
                  calendarResults={calendarResults}
                  onCalendar={(id, calendar) =>
                    setCalendars((current) => {
                      const next = { ...current };
                      if (calendar) next[id] = calendar;
                      else delete next[id];
                      return next;
                    })
                  }
                  notify={setNotice}
                />
                <MeetingSettings state={state} setState={setState} />
                <button
                  className="button button-primary find-button"
                  onClick={() => {
                    document
                      .getElementById("results")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    setNotice(
                      "Results update automatically as you change valid settings.",
                    );
                  }}
                >
                  Find meeting times
                  <Icon name="arrow" />
                </button>
                <p className="settings-footnote">
                  <Icon name="shield" /> No accounts. Imported calendars stay in
                  this browser. Computed locally.
                </p>
              </aside>
              <WorkspaceResults
                input={searchInput}
                state={state}
                setState={setState}
                copy={copy}
                notify={setNotice}
              />
            </div>
          </>
        )}
        {copyFallback && (
          <section className="copy-fallback" aria-label="Copy text manually">
            <label htmlFor="manual-copy">Select this text to copy</label>
            <textarea
              id="manual-copy"
              readOnly
              value={copyFallback}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              className="button button-outline"
              onClick={() => setCopyFallback("")}
            >
              Close copy text
            </button>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <span>
          <strong>tzmeet.</strong> A better time to meet.
        </span>
        <span>Built for people, not just time zones.</span>
      </footer>
      <div className="toast" role="status" aria-live="polite">
        {notice && (
          <>
            <span>{notice}</span>
            <button aria-label="Dismiss message" onClick={() => setNotice("")}>
              <Icon name="close" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ZoneSettings({
  state,
  setState,
  calendars,
  calendarResults,
  onCalendar,
  notify,
}: {
  state: WebState;
  setState: StateSetter;
  calendars: Record<string, ImportedCalendar>;
  calendarResults: Record<string, CalendarResult>;
  onCalendar: (id: string, calendar: ImportedCalendar | null) => void;
  notify: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState(false);
  const zones = state.input.zones;
  const results = useMemo(
    () =>
      listTimeZones()
        .filter(
          (id) =>
            !zones.some((zone) => zone.id === id) &&
            `${id} ${friendlyName(id)}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .slice(0, 12),
    [search, zones],
  );
  function updateZones(next: NormalizedInput["zones"]) {
    setState({
      ...state,
      input: { ...state.input, zones: next },
      panels: state.panels.filter((id) => next.some((zone) => zone.id === id)),
      selected: null,
      expanded: null,
    });
  }
  function add(id: string) {
    if (zones.length >= 20) return;
    updateZones([...zones, regionalZone(id)]);
    setSearch("");
    setPicker(false);
  }
  function change(
    index: number,
    changes: Partial<NormalizedInput["zones"][number]>,
  ) {
    updateZones(
      zones.map((zone, i) => (i === index ? { ...zone, ...changes } : zone)),
    );
  }
  function move(index: number, direction: number) {
    const next = [...zones];
    [next[index], next[index + direction]] = [
      next[index + direction]!,
      next[index]!,
    ];
    updateZones(next);
  }
  return (
    <section
      className="settings-section zone-section"
      aria-labelledby="zones-heading"
    >
      <div className="section-heading">
        <span className="step-number">01</span>
        <h2 id="zones-heading">Your team</h2>
        <span className="count-pill">{zones.length}</span>
      </div>
      <p className="section-help">The first zone anchors your meeting dates.</p>
      <div className="zone-list">
        {zones.map((zone, index) => {
          const open = state.panels.includes(zone.id);
          const panelId = `zone-settings-${index}`;
          return (
            <div key={zone.id} className={`zone-card ${open ? "is-open" : ""}`}>
              <div className="zone-card-top">
                <span className={`zone-avatar avatar-${index % 4}`}>
                  {initials(zone.label ?? friendlyName(zone.id))}
                </span>
                <button
                  className="zone-title"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() =>
                    setState({
                      ...state,
                      panels: open
                        ? state.panels.filter((id) => id !== zone.id)
                        : [...state.panels, zone.id],
                    })
                  }
                >
                  <strong>
                    {zone.label ?? friendlyName(zone.id)}{" "}
                    {index === 0 && (
                      <span className="anchor-label">ANCHOR</span>
                    )}
                    {zone.optional && (
                      <span className="anchor-label">OPTIONAL</span>
                    )}
                  </strong>
                  <span>{zone.id}</span>
                </button>
                <button
                  className="icon-button small"
                  aria-label={`Remove ${zone.label}`}
                  disabled={zones.length === 1}
                  onClick={() => {
                    updateZones(zones.filter((_, i) => i !== index));
                  }}
                >
                  <Icon name="close" />
                </button>
              </div>
              <div className="zone-card-bottom">
                <span>
                  {zone.workStart}–{zone.workEnd}{" "}
                  <span className="muted">work</span>
                </span>
                <div>
                  <button
                    className="icon-button tiny"
                    aria-label={`Move ${zone.label} earlier`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <Icon name="up" />
                  </button>
                  <button
                    className="icon-button tiny"
                    aria-label={`Move ${zone.label} later`}
                    disabled={index === zones.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <Icon name="down" />
                  </button>
                  <button
                    className="settings-toggle"
                    aria-label={`Settings for ${zone.label}`}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() =>
                      setState({
                        ...state,
                        panels: open
                          ? state.panels.filter((id) => id !== zone.id)
                          : [...state.panels, zone.id],
                      })
                    }
                  >
                    Settings
                    <Icon name="down" />
                  </button>
                </div>
              </div>
              {open && (
                <div id={panelId} className="zone-details">
                  <label>
                    City label
                    <input
                      aria-label={`${zone.id} city label`}
                      value={zone.label ?? ""}
                      onChange={(event) =>
                        change(index, { label: event.target.value })
                      }
                    />
                  </label>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      aria-label={`${zone.label ?? zone.id} attendance is optional`}
                      checked={!!zone.optional}
                      onChange={(event) => change(index, { optional: event.target.checked || undefined })}
                    />
                    <span>Optional attendee: never blocks a time</span>
                  </label>
                  <div className="field-pair">
                    <label>
                      Work starts
                      <input
                        type="time"
                        aria-label={`${zone.label} work starts`}
                        value={zone.workStart}
                        onChange={(event) =>
                          change(index, { workStart: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Work ends
                      <input
                        type="time"
                        aria-label={`${zone.label} work ends`}
                        value={zone.workEnd}
                        onChange={(event) =>
                          change(index, { workEnd: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="field-pair">
                    <label>
                      Earliest allowed
                      <input
                        type="time"
                        aria-label={`${zone.label} earliest allowed`}
                        value={zone.quietBefore}
                        onChange={(event) =>
                          change(index, { quietBefore: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Latest allowed
                      <input
                        type="time"
                        aria-label={`${zone.label} latest allowed`}
                        value={zone.quietAfter}
                        onChange={(event) =>
                          change(index, { quietAfter: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <fieldset className="weekday-field">
                    <legend>Weekend days</legend>
                    <div className="weekday-options">
                      {dayNames.map((name, day) => (
                        <label key={name}>
                          <input
                            type="checkbox"
                            aria-label={`${zone.label} ${name} weekend`}
                            checked={zone.weekend.includes(day + 1)}
                            onChange={(event) =>
                              change(index, {
                                weekend: event.target.checked
                                  ? [...zone.weekend, day + 1].sort()
                                  : zone.weekend.filter(
                                      (value) => value !== day + 1,
                                    ),
                              })
                            }
                          />
                          <span>{name}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <HolidayField
                    zone={zone}
                    onChange={(holidays) => change(index, { holidays })}
                  />
                  <HolidayPresetField
                    zone={zone}
                    from={state.input.startDate}
                    onChange={(holidayPreset) =>
                      change(index, { holidayPreset })
                    }
                  />
                  <RamadanField
                    zone={zone}
                    from={state.input.startDate}
                    onChange={(specialHours) => change(index, { specialHours })}
                  />
                  <CalendarField
                    zone={zone}
                    calendar={calendars[zone.id]}
                    result={calendarResults[zone.id]}
                    onChange={(calendar) => onCalendar(zone.id, calendar)}
                    notify={notify}
                  />
                  <p className="detail-hint">
                    Work must fit within allowed hours. For night shifts, set a
                    start later than the end (e.g. 22:00–06:00).
                  </p>
                  {zone.prayer && (
                    <p className="detail-hint">
                      This shared workspace has a per-zone prayer override from
                      its config. The global toggle does not remove that
                      override.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button
        className="add-zone-button"
        aria-expanded={picker}
        aria-controls="zone-picker"
        disabled={zones.length >= 20}
        onClick={() => setPicker(!picker)}
      >
        <Icon name="plus" />
        Add a time zone<span>{zones.length}/20</span>
      </button>
      {picker && (
        <div id="zone-picker" className="zone-picker">
          <label htmlFor="zone-search">Search time zones</label>
          <div className="search-field">
            <Icon name="search" />
            <input
              autoFocus
              id="zone-search"
              placeholder="Try Tokyo, Sydney, Los Angeles…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && results[0]) {
                  event.preventDefault();
                  add(results[0]);
                }
                if (event.key === "Escape") setPicker(false);
              }}
            />
          </div>
          <ul aria-label="Matching time zones">
            {results.map((id) => (
              <li key={id}>
                <button
                  aria-label={`Add ${friendlyName(id)} (${id})`}
                  onClick={() => add(id)}
                >
                  <span>
                    <strong>{friendlyName(id)}</strong>
                    <small>{id}</small>
                  </span>
                  <Icon name="plus" />
                </button>
              </li>
            ))}
          </ul>
          {!results.length && (
            <p className="detail-hint">No available zones match your search.</p>
          )}
        </div>
      )}
    </section>
  );
}

/** Free-text date list kept as a local draft so typing separators isn't fought by the parsed value. */
function HolidayField({
  zone,
  onChange,
}: {
  zone: NormalizedInput["zones"][number];
  onChange: (holidays: string[] | undefined) => void;
}) {
  const [draft, setDraft] = useState((zone.holidays ?? []).join(", "));
  return (
    <label>
      Holidays
      <input
        aria-label={`${zone.label} holidays`}
        placeholder="2026-12-16, 2026-12-25"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const dates = event.target.value.split(/[\s,]+/).filter(Boolean);
          onChange(dates.length ? dates : undefined);
        }}
      />
      <span className="detail-hint">
        Local dates (YYYY-MM-DD) treated like weekend days.
      </span>
    </label>
  );
}

/** Country public holidays, with the next few shown so people can check them. */
function HolidayPresetField({
  zone,
  from,
  onChange,
}: {
  zone: NormalizedInput["zones"][number];
  from: string;
  onChange: (preset: HolidayPreset | undefined) => void;
}) {
  const suggested = suggestHolidayPreset(zone.id);
  const upcoming = useMemo(() => {
    if (!zone.holidayPreset || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return [];
    const year = Number(from.slice(0, 4));
    return [
      ...presetHolidays(zone.holidayPreset, year),
      ...presetHolidays(zone.holidayPreset, year + 1),
    ]
      .filter((holiday) => holiday.date >= from)
      .slice(0, 3);
  }, [zone.holidayPreset, from]);
  return (
    <label>
      Public holidays
      <select
        aria-label={`${zone.label} public holidays`}
        value={zone.holidayPreset ?? ""}
        onChange={(event) =>
          onChange(
            (event.target.value || undefined) as HolidayPreset | undefined,
          )
        }
      >
        <option value="">None</option>
        {holidayPresetIds.map((id) => (
          <option key={id} value={id}>
            {holidayPresets[id]}
            {id === suggested ? " (suggested)" : ""}
          </option>
        ))}
      </select>
      {upcoming.length > 0 && (
        <span className="detail-hint">
          Next:{" "}
          {upcoming
            .map(
              (holiday) =>
                `${DateTime.fromISO(holiday.date).setLocale("en").toFormat("d LLL")} ${holiday.name}${holiday.approximate ? " (approx.)" : ""}`,
            )
            .join(" · ")}
        </span>
      )}
    </label>
  );
}

/** Shorter work hours during Ramadan, stored as special hours for this year and next. */
function RamadanField({
  zone,
  from,
  onChange,
}: {
  zone: NormalizedInput["zones"][number];
  from: string;
  onChange: (specialHours: NormalizedInput["zones"][number]["specialHours"]) => void;
}) {
  const ramadan = (zone.specialHours ?? []).filter((period) => period.label === "Ramadan");
  const others = (zone.specialHours ?? []).filter((period) => period.label !== "Ramadan");
  const label = zone.label ?? zone.id;
  const enable = (workStart: string, workEnd: string) => {
    const year = Number(from.slice(0, 4)) || new Date().getFullYear();
    const preset = zone.holidayPreset ?? suggestHolidayPreset(zone.id);
    const periods = [ramadanDates(year, preset), ramadanDates(year + 1, preset)]
      .filter((dates): dates is { from: string; to: string } => dates !== null)
      .map((dates) => ({ label: "Ramadan", ...dates, workStart, workEnd }));
    onChange([...others, ...periods]);
  };
  const setHours = (workStart: string, workEnd: string) =>
    onChange([...others, ...ramadan.map((period) => ({ ...period, workStart, workEnd }))]);
  const format = (date: string) => DateTime.fromISO(date).setLocale("en").toFormat("d LLL yyyy");
  return (
    <fieldset className="ramadan-field">
      <legend>Ramadan hours</legend>
      <label className="inline-check">
        <input
          type="checkbox"
          aria-label={`${label} Ramadan hours`}
          checked={ramadan.length > 0}
          onChange={(event) => (event.target.checked ? enable("09:00", "15:30") : onChange(others.length ? others : undefined))}
        />
        <span>Use shorter work hours during Ramadan</span>
      </label>
      {ramadan.length > 0 && (
        <>
          <div className="field-pair">
            <label>
              Starts
              <input type="time" aria-label={`${label} Ramadan work starts`} value={ramadan[0]!.workStart} onChange={(event) => setHours(event.target.value, ramadan[0]!.workEnd)} />
            </label>
            <label>
              Ends
              <input type="time" aria-label={`${label} Ramadan work ends`} value={ramadan[0]!.workEnd} onChange={(event) => setHours(ramadan[0]!.workStart, event.target.value)} />
            </label>
          </div>
          <span className="detail-hint">
            {ramadan.map((period) => `${format(period.from)} – ${format(period.to)}`).join(" · ")} (approximate, from the Umm al-Qura calendar).
          </span>
        </>
      )}
    </fieldset>
  );
}

/** Import an .ics file (or pasted calendar text) as busy times for one zone. */
function CalendarField({
  zone,
  calendar,
  result,
  onChange,
  notify,
}: {
  zone: NormalizedInput["zones"][number];
  calendar?: ImportedCalendar;
  result?: CalendarResult;
  onChange: (calendar: ImportedCalendar | null) => void;
  notify: (message: string) => void;
}) {
  const [pasted, setPasted] = useState("");
  const label = zone.label ?? zone.id;
  return (
    <div className="calendar-field">
      <span className="field-label">Busy calendar</span>
      {calendar ? (
        <div className="calendar-status">
          <p>
            <strong>{calendar.name}</strong>
            {result && "error" in result
              ? ` couldn't be read: ${result.error}`
              : result
                ? `: ${result.busy.length} busy time${result.busy.length === 1 ? "" : "s"} in range, from ${result.events} event${result.events === 1 ? "" : "s"}.`
                : ""}
          </p>
          {result &&
            "warnings" in result &&
            result.warnings.map((warning) => (
              <p key={warning} className="detail-hint">
                {warning}
              </p>
            ))}
          <button
            type="button"
            className="text-button"
            aria-label={`Remove ${label} busy calendar`}
            onClick={() => onChange(null)}
          >
            Remove calendar
          </button>
        </div>
      ) : (
        <>
          <label className="calendar-upload">
            Import .ics file
            <input
              type="file"
              accept=".ics,text/calendar"
              aria-label={`${label} busy calendar`}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > MAX_CALENDAR_BYTES) {
                  notify(
                    "That calendar file is over 5 MB. Export a shorter date range.",
                  );
                  return;
                }
                onChange({ name: file.name, text: await file.text() });
              }}
            />
          </label>
          <details className="calendar-paste">
            <summary>Or paste calendar text</summary>
            <textarea
              aria-label={`${label} calendar text`}
              placeholder="BEGIN:VCALENDAR"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
            />
            <button
              type="button"
              className="text-button"
              disabled={!pasted.trim()}
              onClick={() => {
                onChange({ name: "Pasted calendar", text: pasted });
                setPasted("");
              }}
            >
              Use pasted calendar
            </button>
          </details>
        </>
      )}
      <span className="detail-hint">
        Read only in this browser. Busy times aren't saved or put in share
        links, and event titles are ignored.
      </span>
    </div>
  );
}

function MeetingSettings({
  state,
  setState,
}: {
  state: WebState;
  setState: StateSetter;
}) {
  const input = state.input;
  function change(changes: Partial<NormalizedInput>) {
    setState({
      ...state,
      input: { ...input, ...changes },
      selected: null,
      expanded: null,
      shown: 10,
    });
  }
  function prayer(changes: Partial<WebState["prayerDraft"]>) {
    const next = { ...state.prayerDraft, ...changes };
    setState({
      ...state,
      prayerDraft: next,
      input: { ...input, prayer: input.prayer ? next : undefined },
      selected: null,
    });
  }
  const coordinateLocation = typeof state.prayerDraft.location !== "string";
  return (
    <section className="settings-section" aria-labelledby="meeting-heading">
      <div className="section-heading">
        <span className="step-number">02</span>
        <h2 id="meeting-heading">The meeting</h2>
      </div>
      <label className="full-field">
        Starting date
        <input
          type="date"
          aria-label="Starting date"
          value={input.startDate}
          onChange={(event) => {
            setState({
              ...state,
              input: { ...input, startDate: event.target.value },
              day: event.target.value || state.day,
              selected: null,
              expanded: null,
              shown: 10,
            });
          }}
        />
      </label>
      <fieldset className="duration-field">
        <legend>Duration</legend>
        <div className="duration-options">
          {[15, 30, 45, 60].map((duration) => (
            <button
              key={duration}
              aria-pressed={
                !state.customDuration && input.durationMinutes === duration
              }
              onClick={() =>
                setState({
                  ...state,
                  customDuration: false,
                  input: { ...input, durationMinutes: duration },
                  selected: null,
                  expanded: null,
                })
              }
            >
              {duration}
              <span>m</span>
            </button>
          ))}
          <button
            aria-pressed={state.customDuration}
            onClick={() => setState({ ...state, customDuration: true })}
          >
            Custom
          </button>
        </div>
      </fieldset>
      {state.customDuration && (
        <label className="full-field">
          Custom duration (minutes)
          <input
            type="number"
            min="1"
            max="1440"
            aria-label="Custom duration minutes"
            value={input.durationMinutes}
            onChange={(event) =>
              change({ durationMinutes: Number(event.target.value) })
            }
          />
        </label>
      )}
      <div className="field-pair">
        <label>
          Days to search
          <input
            type="number"
            min="1"
            max="31"
            aria-label="Days to search"
            value={input.days}
            onChange={(event) => change({ days: Number(event.target.value) })}
          />
        </label>
        <label>
          Time grid
          <select
            aria-label="Time grid"
            value={input.stepMinutes}
            onChange={(event) =>
              change({ stepMinutes: Number(event.target.value) })
            }
          >
            {[5, 10, 15, 30, 60].map((step) => (
              <option key={step} value={step}>
                {step} minutes
              </option>
            ))}
            {![5, 10, 15, 30, 60].includes(input.stepMinutes) && (
              <option value={input.stepMinutes}>
                {input.stepMinutes} minutes
              </option>
            )}
          </select>
        </label>
      </div>
      <div className="prayer-control">
        <label className="switch-label">
          <span>
            <strong>Respect prayer times</strong>
            <small>Optional breathing room</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Respect prayer times"
            checked={!!input.prayer}
            onChange={(event) =>
              change({
                prayer: event.target.checked ? state.prayerDraft : undefined,
              })
            }
          />
          <span className="switch-track" aria-hidden="true" />
        </label>
        {input.prayer && (
          <div className="prayer-fields">
            <label>
              Prayer location
              <select
                aria-label="Prayer location"
                value={
                  coordinateLocation
                    ? "coordinates"
                    : (state.prayerDraft.location as string)
                }
                onChange={(event) =>
                  prayer({
                    location:
                      event.target.value === "coordinates"
                        ? { lat: 23.8103, lng: 90.4125 }
                        : (event.target.value as keyof typeof cities),
                  })
                }
              >
                {Object.keys(cities).map((city) => (
                  <option key={city}>{city}</option>
                ))}
                <option value="coordinates">Custom coordinates</option>
              </select>
            </label>
            {coordinateLocation && (
              <div className="field-pair">
                <label>
                  Latitude
                  <input
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    aria-label="Prayer latitude"
                    value={
                      (
                        state.prayerDraft.location as {
                          lat: number;
                          lng: number;
                        }
                      ).lat
                    }
                    onChange={(event) =>
                      prayer({
                        location: {
                          ...(state.prayerDraft.location as {
                            lat: number;
                            lng: number;
                          }),
                          lat: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Longitude
                  <input
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    aria-label="Prayer longitude"
                    value={
                      (
                        state.prayerDraft.location as {
                          lat: number;
                          lng: number;
                        }
                      ).lng
                    }
                    onChange={(event) =>
                      prayer({
                        location: {
                          ...(state.prayerDraft.location as {
                            lat: number;
                            lng: number;
                          }),
                          lng: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
              </div>
            )}
            <div className="field-pair">
              <label>
                Method
                <select
                  aria-label="Prayer method"
                  value={state.prayerDraft.method}
                  onChange={(event) =>
                    prayer({
                      method: event.target
                        .value as WebState["prayerDraft"]["method"],
                    })
                  }
                >
                  {prayerMethods.map((method) => (
                    <option key={method}>{method}</option>
                  ))}
                </select>
              </label>
              <label>
                Buffer (± min)
                <input
                  type="number"
                  min="0"
                  max="180"
                  aria-label="Prayer buffer minutes"
                  value={state.prayerDraft.bufferMinutes}
                  onChange={(event) =>
                    prayer({ bufferMinutes: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <p className="detail-hint">
              One location applies to all zones unless overridden. Approximate
              calculations, not mosque timetables.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function WorkspaceResults({
  input,
  state,
  setState,
  copy,
  notify,
}: {
  /** state.input plus in-memory calendar busy times. */
  input: NormalizedInput;
  state: WebState;
  setState: StateSetter;
  copy: (text: string, message: string) => Promise<void>;
  notify: (message: string) => void;
}) {
  const checked = useMemo(() => validateInput(input), [input]);
  const search = useSlotSearch(checked);
  const result = search.result;
  const [overTime, setOverTime] = useState<string | null>(null);
  const selected =
    result?.slots.find((slot) => slot.start === state.selected) ??
    result?.slots[0];
  const timeline = useMemo(() => {
    if (
      !checked.success ||
      !DateTime.fromISO(state.day, { zone: "UTC" }).isValid
    )
      return { rows: [], error: "" };
    try {
      return { rows: makeTimeline(checked.data, state.day), error: "" };
    } catch (error) {
      return {
        rows: [],
        error: error instanceof Error ? error.message : "Timeline unavailable.",
      };
    }
  }, [checked, state.day]);
  const dayStart = DateTime.fromISO(state.day, { zone: "UTC" }).startOf("day");
  const candidates =
    result?.slots.filter(
      (slot) =>
        DateTime.fromISO(slot.start, { zone: "UTC" }).toISODate() === state.day,
    ) ?? [];
  // A slot link opened fresh scrolls straight to that slot. Runs before App rewrites the URL, so plain visits are unaffected.
  // A slot link opened fresh scrolls to that slot once its results first arrive.
  const openedFromLink = useRef(
    Boolean(state.selected) && /[?&](?:state|s)=/.test(window.location.search),
  );
  useEffect(() => {
    if (!openedFromLink.current || !result) return;
    openedFromLink.current = false;
    document
      .getElementById(`slot-${state.selected}`)
      ?.scrollIntoView({ block: "center" });
  }, [result, state.selected]);
  /** URL that opens this exact workspace with one slot selected, expanded and visible. */
  function slotLink(slot: Slot, index: number) {
    const focused = {
      ...state,
      selected: slot.start,
      expanded: slot.start,
      day: DateTime.fromISO(slot.start, { zone: "UTC" }).toISODate()!,
      shown: Math.max(state.shown, Math.ceil((index + 1) / 10) * 10),
    };
    return `${window.location.origin}${window.location.pathname}?${encodeState(focused)}`;
  }
  function choose(slot: Slot) {
    setState({
      ...state,
      selected: slot.start,
      expanded: state.expanded === slot.start ? null : slot.start,
      day: DateTime.fromISO(slot.start, { zone: "UTC" }).toISODate()!,
    });
  }
  return (
    <div className="results-workspace">
      <section className="timeline-panel" aria-labelledby="timeline-heading">
        <div className="timeline-heading">
          <div>
            <p className="eyebrow">THE SHARED PICTURE</p>
            <h2 id="timeline-heading">One day. Every timezone.</h2>
          </div>
          <label className="timeline-date">
            <span className="sr-only">Timeline UTC date</span>
            <input
              type="date"
              aria-label="Timeline UTC date"
              value={state.day}
              onChange={(event) => {
                if (event.target.value)
                  setState({ ...state, day: event.target.value });
              }}
            />
          </label>
        </div>
        <div className="timeline-legend">
          {[
            ["work", "Work hours"],
            ["acceptable", "Acceptable"],
            ["quiet", "Quiet hours"],
            ["weekend", "Weekend"],
            ["holiday", "Holiday"],
            ["busy", "Busy (calendar)"],
            ["prayer", "Prayer"],
          ].map(([kind, label]) => (
            <span key={kind}>
              <i className={`legend-dot kind-${kind}`} />
              {label}
            </span>
          ))}
          <span>
            <i className="legend-slot" />
            Meeting slot
          </span>
        </div>
        {timeline.error && (
          <p role="alert" className="error-box">
            {timeline.error}
          </p>
        )}
        <div
          className="timeline-scroll"
          tabIndex={0}
          role="region"
          aria-label="24-hour timeline, horizontally scrollable on small screens"
        >
          <div className="timeline-grid">
            <div className="axis-row">
              <div className="axis-title">
                UTC <span>24-hour axis</span>
              </div>
              <div className="axis-ticks">
                {Array.from({ length: 13 }, (_, i) => (
                  <span key={i} style={{ left: `${(i / 12) * 100}%` }}>
                    {String(i * 2).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
            </div>
            {timeline.rows.map((row, index) => (
              <div className="timeline-row" key={row.id}>
                <div className="timeline-row-label">
                  <span className={`mini-avatar avatar-${index % 4}`}>
                    {initials(row.label)}
                  </span>
                  <strong>{row.label}</strong>
                  <small>{row.origin}</small>
                </div>
                <div
                  className="timeline-track"
                  role="group"
                  aria-label={`${row.label} availability`}
                >
                  {row.segments.map((segment, i) => (
                    <div
                      key={i}
                      className={`timeline-segment kind-${segment.kind}`}
                      style={{
                        left: `${segment.left}%`,
                        width: `${segment.width}%`,
                      }}
                      title={segment.description}
                      role="img"
                      aria-label={segment.description}
                    />
                  ))}
                  {Array.from({ length: 11 }, (_, i) => (
                    <i
                      key={i}
                      className="hour-guide"
                      style={{ left: `${((i + 1) / 12) * 100}%` }}
                    />
                  ))}
                  {candidates.map((slot) => {
                    const left =
                      (DateTime.fromISO(slot.start).diff(dayStart, "minutes")
                        .minutes /
                        1440) *
                      100;
                    const width =
                      (DateTime.fromISO(slot.end).diff(
                        DateTime.fromISO(slot.start),
                        "minutes",
                      ).minutes /
                        1440) *
                      100;
                    return (
                      <span
                        key={slot.start}
                        className="candidate-hint"
                        style={{
                          left: `${left}%`,
                          width: `${Math.min(width, 100 - left)}%`,
                        }}
                      />
                    );
                  })}
                  {selected &&
                    (() => {
                      const left =
                        (DateTime.fromISO(selected.start).diff(
                          dayStart,
                          "minutes",
                        ).minutes /
                          1440) *
                        100;
                      const end =
                        (DateTime.fromISO(selected.end).diff(
                          dayStart,
                          "minutes",
                        ).minutes /
                          1440) *
                        100;
                      return end > 0 && left < 100 ? (
                        <span
                          className="selected-span"
                          style={{
                            left: `${Math.max(0, left)}%`,
                            width: `${Math.min(100, end) - Math.max(0, left)}%`,
                          }}
                          role="img"
                          aria-label="Selected meeting span"
                        />
                      ) : null;
                    })()}
                </div>
              </div>
            ))}
            <div className="slot-ruler">
              <span>AVAILABLE STARTS</span>
              <div>
                {candidates.map((slot) => {
                  const local = slot.zones[0]!;
                  const left =
                    (DateTime.fromISO(slot.start).diff(dayStart, "minutes")
                      .minutes /
                      1440) *
                    100;
                  return (
                    <button
                      key={slot.start}
                      style={{ left: `${left}%` }}
                      className={slot.start === selected?.start ? "active" : ""}
                      aria-label={`Select meeting at ${clock(local.localStart).toFormat("HH:mm")} ${local.label}`}
                      title={`${clock(local.localStart).toFormat("HH:mm")} ${local.label}`}
                      onClick={() => choose(slot)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="timeline-caption">
          <span>Aligned in UTC. Local dates & offsets can differ.</span>
          <span>5-minute color cells · exact meeting spans</span>
        </div>
        {selected && (
          <div className="selection-summary">
            <span className="selection-dot" />
            <span>
              Selected{" "}
              <strong>
                {clock(selected.zones[0]!.localStart).toFormat("HH:mm")}{" "}
                {selected.zones[0]!.label}
              </strong>
            </span>
            <span>
              {
                selected.zones.filter((zone) => zone.classification === "ideal")
                  .length
              }
              /{selected.zones.length} in work hours
            </span>
            <button
              onClick={() =>
                document
                  .getElementById(`slot-${selected.start}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" })
              }
            >
              View slot
              <Icon name="arrow" />
            </button>
          </div>
        )}
      </section>
      <section
        id="results"
        className="ranked-results"
        aria-labelledby="results-heading"
        tabIndex={-1}
      >
        <div className="results-heading">
          <div>
            <p className="eyebrow">LESS COMPROMISE, FIRST</p>
            <h2 id="results-heading">Your best meeting times</h2>
          </div>
          <span className="results-count" aria-live="polite">
            {search.pending && !result ? "Searching…" : `${result?.slots.length ?? 0} options`}
          </span>
        </div>
        <p className="results-help">
          Ranked by shared work hours, then a gentle preference for earlier,
          mid-day meetings.
        </p>
        {result && <RotationCard result={result} />}
        {search.error && (
          <div className="error-box" role="alert">
            <strong>Check your settings</strong>
            <p>{search.error}</p>
          </div>
        )}
        {result && !result.slots.length && (
          <div className="empty-results">
            <span className="empty-icon">
              <Icon name="clock" />
            </span>
            <h3>No common window, yet.</h3>
            <p>{result.diagnostics.message}</p>
            <div>
              <strong>A small change might help</strong>
              <p>{result.diagnostics.suggestion}</p>
            </div>
            <p className="detail-hint">
              We never relax anyone’s hours automatically.
            </p>
          </div>
        )}
        <div className="slot-list">
          {result?.slots.slice(0, state.shown).map((slot, index) => (
            <article
              key={slot.start}
              id={`slot-${slot.start}`}
              className={`slot-card ${selected?.start === slot.start ? "selected" : ""}`}
            >
              <div className="slot-card-header">
                <span className="rank-label">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <button
                  className="slot-select"
                  aria-label={`Select slot ${index + 1}`}
                  aria-expanded={state.expanded === slot.start}
                  onClick={() => choose(slot)}
                >
                  <strong>
                    {clock(slot.zones[0]!.localStart).toFormat("cccc, d LLL")}
                  </strong>
                  <span>
                    {index === 0
                      ? "Best shared fit"
                      : `${slot.baseScore}/${slot.zones.length * 2} work-hour points`}
                  </span>
                </button>
                {index === 0 && <span className="best-badge">TOP PICK</span>}
                <button
                  className="icon-button"
                  aria-label={`Expand slot ${index + 1} details`}
                  aria-expanded={state.expanded === slot.start}
                  onClick={() => choose(slot)}
                >
                  <Icon name="down" />
                </button>
              </div>
              <div className="slot-times">
                {slot.zones.map((zone) => (
                  <div key={zone.id}>
                    <span className="slot-city">{zone.label}</span>
                    <strong>
                      {clock(zone.localStart).toFormat("HH:mm")}
                      <span>–{clock(zone.localEnd).toFormat("HH:mm")}</span>
                    </strong>
                    <div>
                      <small>
                        {clock(zone.localStart).toFormat("ccc d LLL")}
                      </small>
                      <span className={`badge badge-${zone.classification}`}>
                        {zone.classification === "ideal"
                          ? "Ideal"
                          : zone.classification === "acceptable"
                            ? "Acceptable"
                            : "Unavailable"}
                      </span>
                      {zone.optional && <span className="badge badge-optional">Optional</span>}
                    </div>
                  </div>
                ))}
              </div>
              <p className="slot-reason">{slot.reason}</p>
              {state.expanded === slot.start && (
                <div className="slot-details">
                  <p>
                    <strong>Exact UTC interval</strong>
                    <br />
                    {slot.start} → {slot.end}
                  </p>
                  <ul>
                    {slot.zones.map((zone) => (
                      <li key={zone.id}>
                        <strong>{zone.label}</strong>
                        <span>
                          {zone.formattedStart} → {zone.formattedEnd}
                        </span>
                        <code>
                          {zone.localStart} → {zone.localEnd}
                        </code>
                      </li>
                    ))}
                  </ul>
                  <p>
                    Score {slot.score.toFixed(4)} = {slot.baseScore}{" "}
                    classification points + bounded tie-break. Meeting duration
                    is elapsed time, even across DST.
                  </p>
                </div>
              )}
              {overTime === slot.start && checked.success && (
                <RecurringPanel
                  id={`over-time-${index}`}
                  input={checked.data}
                  slot={slot}
                />
              )}
              <div className="slot-actions">
                <button
                  onClick={() => {
                    void copy(
                      inviteText(slot),
                      "Invite text copied with every team’s local time.",
                    );
                  }}
                  aria-label={`Copy invite text for slot ${index + 1}`}
                >
                  <Icon name="copy" />
                  Copy invite text
                </button>
                <button
                  onClick={() => {
                    try {
                      downloadCalendar(slot);
                      notify(
                        "Calendar file downloaded. Times are stored as exact UTC instants.",
                      );
                    } catch {
                      notify(
                        "The calendar download could not be created in this browser.",
                      );
                    }
                  }}
                  aria-label={`Download ICS for slot ${index + 1}`}
                >
                  <Icon name="download" />
                  Download .ics
                </button>
                <button
                  onClick={() => {
                    void copy(
                      slotLink(slot, index),
                      "Link copied. It opens this exact meeting time.",
                    );
                  }}
                  aria-label={`Copy link to slot ${index + 1}`}
                >
                  <Icon name="link" />
                  Copy link
                </button>
                <button
                  aria-expanded={overTime === slot.start}
                  aria-controls={`over-time-${index}`}
                  aria-label={`Check slot ${index + 1} over the coming weeks`}
                  onClick={() =>
                    setOverTime(overTime === slot.start ? null : slot.start)
                  }
                >
                  <Icon name="clock" />
                  Check over time
                </button>
                <button className="view-timeline" onClick={() => choose(slot)}>
                  On timeline
                  <Icon name="arrow" />
                </button>
              </div>
            </article>
          ))}
        </div>
        {result && result.slots.length > state.shown && state.shown < 1000 && (
          <button
            className="button button-outline show-more"
            onClick={() =>
              setState({ ...state, shown: Math.min(1000, state.shown + 10) })
            }
          >
            Show 10 more of {result.slots.length} slots
            <Icon name="down" />
          </button>
        )}
        {result && result.slots.length > 1000 && state.shown === 1000 && (
          <p className="result-disclaimer">
            Showing the first 1,000 slots. Narrow the date range for a shorter
            list.
          </p>
        )}
        {result && result.slots.length > 0 && (
          <p className="result-disclaimer">
            All times use your browser’s IANA timezone data. Prayer times are
            approximate. Always check with your team.
          </p>
        )}
      </section>
    </div>
  );
}
