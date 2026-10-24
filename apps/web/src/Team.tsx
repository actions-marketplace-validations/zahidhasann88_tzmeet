import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { listTimeZones } from "@tzmeet/core";
import Icon from "./Icon";
import { ZoneInput } from "./Cron";
import { browserZone, PersonFields } from "./Me";
import { statusNow, type MeState } from "./me-state";
import { friendlyName } from "./state";
import {
  bestSharedHours,
  defaultTeamState,
  findMeetingLink,
  MAX_PEOPLE,
  parseTeamHash,
  personFromMeLink,
  personName,
  teamGrid,
  teamHash,
  teamShareLink,
  type TeamState,
} from "./team-state";

const statusLabels = {
  work: "Working",
  reachable: "Just outside work hours",
  off: "Off",
} as const;

export default function TeamPage({
  copy,
}: {
  copy: (text: string, message: string) => Promise<void>;
}) {
  const zones = useMemo(() => listTimeZones(), []);
  const [shared, setShared] = useState(() =>
    parseTeamHash(window.location.hash),
  );
  const [viewerZone, setViewerZone] = useState(browserZone);
  const [draft, setDraft] = useState<TeamState>(
    () => shared ?? defaultTeamState(browserZone()),
  );
  const [meLink, setMeLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const team = shared ?? draft;
  useEffect(() => {
    if (shared) return;
    const url = new URL(window.location.href);
    url.hash = teamHash(draft);
    window.history.replaceState(window.history.state, "", url);
  }, [shared, draft]);

  const invalid = useMemo(
    () =>
      team.people.findIndex((person) => person.workStart === person.workEnd),
    [team],
  );
  const title = team.name || "the team";
  const updatePerson = (index: number, changes: Partial<MeState>) =>
    setDraft((current) => ({
      ...current,
      people: current.people.map((person, at) =>
        at === index ? { ...person, ...changes } : person,
      ),
    }));
  const addPerson = (person: MeState) =>
    setDraft((current) => ({
      ...current,
      people: [...current.people, person],
    }));
  const meeting =
    invalid < 0 ? findMeetingLink(team, window.location.href, now) : null;

  return (
    <>
      <section className="intro" aria-labelledby="team-title">
        <div>
          <p className="eyebrow">
            <span className="status-dot" /> TEAM HOURS, IN YOUR TIME
          </p>
          <h1 id="team-title">
            {shared ? `When ${title} is available` : "Share your team's hours"}
            <span>.</span>
          </h1>
          <p className="intro-copy">
            {shared
              ? `Everyone's working hours in your time zone (${friendlyName(viewerZone)}), with their weekends and public holidays.`
              : "Add everyone's hours once and share one link. Whoever opens it sees when each person works and when your hours overlap, in their own time zone."}
          </p>
        </div>
      </section>
      <div className={shared ? "me-layout is-shared" : "me-layout"}>
        {!shared && (
          <aside className="settings" aria-label="Team members">
            <section className="settings-section">
              <div className="section-heading">
                <span className="step-number">01</span>
                <h2>Your team</h2>
              </div>
              <label className="full-field">
                Team name
                <input
                  aria-label="Team name"
                  maxLength={60}
                  placeholder="Optional"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </label>
              {draft.people.map((person, index) => (
                <fieldset className="team-person" key={index}>
                  <legend>{person.name || `Person ${index + 1}`}</legend>
                  <PersonFields
                    person={person}
                    zones={zones}
                    onChange={(changes) => updatePerson(index, changes)}
                    labels={{
                      nameText: "Name",
                      name: `Name, person ${index + 1}`,
                      zone: `Time zone, person ${index + 1}`,
                      start: `Work starts, person ${index + 1}`,
                      end: `Work ends, person ${index + 1}`,
                      weekend: (day) => `${day} weekend, person ${index + 1}`,
                      holidays: `Public holidays, person ${index + 1}`,
                    }}
                  />
                  {draft.people.length > 1 && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          people: draft.people.filter((_, at) => at !== index),
                        })
                      }
                    >
                      Remove {personName(person)}
                    </button>
                  )}
                </fieldset>
              ))}
              {draft.people.length < MAX_PEOPLE ? (
                <div className="team-add">
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() =>
                      addPerson({
                        ...draft.people.at(-1)!,
                        name: "",
                      })
                    }
                  >
                    <Icon name="plus" />
                    Add a person
                  </button>
                  <label className="full-field">
                    Or paste someone's My hours link
                    <input
                      aria-label="My hours link"
                      placeholder="https://…/me/#n=…"
                      value={meLink}
                      onChange={(event) => {
                        setMeLink(event.target.value);
                        setLinkError("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        const person = personFromMeLink(meLink);
                        if (!person) {
                          setLinkError("That isn't a My hours link.");
                          return;
                        }
                        addPerson(person);
                        setMeLink("");
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={!meLink.trim()}
                    onClick={() => {
                      const person = personFromMeLink(meLink);
                      if (!person) {
                        setLinkError("That isn't a My hours link.");
                        return;
                      }
                      addPerson(person);
                      setMeLink("");
                    }}
                  >
                    Add from link
                  </button>
                  {linkError && (
                    <p className="error-box" role="alert">
                      {linkError}
                    </p>
                  )}
                </div>
              ) : (
                <p className="detail-hint">
                  A team link holds up to {MAX_PEOPLE} people.
                </p>
              )}
              <button
                type="button"
                className="button button-primary me-copy"
                disabled={invalid >= 0}
                onClick={() =>
                  void copy(
                    teamShareLink(draft, window.location.href),
                    "Team link copied. Anyone who opens it sees everyone's hours in their time zone.",
                  )
                }
              >
                <Icon name="link" />
                Copy team link
              </button>
            </section>
          </aside>
        )}
        <section
          id="team-view"
          className="me-view auto-scrollbar"
          aria-labelledby="team-view-heading"
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
          {invalid < 0 ? (
            <Overlap team={team} viewerZone={viewerZone} now={now} />
          ) : (
            <p className="error-box" role="alert">
              {personName(team.people[invalid]!)}: work hours must be two
              different times.
            </p>
          )}
          <div className="team-actions">
            {meeting ? (
              <a className="button button-primary" href={meeting}>
                <Icon name="search" />
                Find a meeting time
              </a>
            ) : (
              invalid < 0 && (
                <p className="detail-hint">
                  Too many time zones to search for a meeting.
                </p>
              )
            )}
            {shared && (
              <button
                type="button"
                className="button button-outline"
                onClick={() => {
                  setDraft(shared);
                  setShared(null);
                }}
              >
                Edit a copy of this team
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Overlap({
  team,
  viewerZone,
  now,
}: {
  team: TeamState;
  viewerZone: string;
  now: Date;
}) {
  const rows = teamGrid(team, viewerZone, now);
  const best = bestSharedHours(team, viewerZone, now);
  const statuses = team.people.map((person) => statusNow(person, now));
  const working = statuses.filter((status) => status.kind === "work").length;
  const total = team.people.length;
  const viewerNow = DateTime.fromJSDate(now, { zone: viewerZone });
  const nowCell = viewerNow.hour * 2 + (viewerNow.minute >= 30 ? 1 : 0);
  const at = (iso: string) =>
    DateTime.fromISO(iso, { setZone: true }).setLocale("en");
  const level = (count: number) =>
    count === total ? "all" : count > 0 ? "some" : "none";
  const shade = (count: number) =>
    count
      ? {
          background: `color-mix(in srgb, var(--team-all) ${Math.round(30 + (70 * count) / total)}%, var(--quiet))`,
        }
      : undefined;
  const legendCounts = [
    ...new Set(
      total <= 6
        ? Array.from({ length: total }, (_, index) => index + 1)
        : [1, Math.ceil(total / 2), total],
    ),
  ];
  const length = (start: string, end: string) => {
    const minutes = at(end).diff(at(start), "minutes").minutes;
    const hours = Math.floor(minutes / 60);
    return `${hours ? `${hours} h` : ""}${minutes % 60 ? ` ${minutes % 60} min` : ""}`.trim();
  };
  return (
    <>
      <div
        className={`me-status ${working === total ? "is-work" : working ? "is-reachable" : ""}`}
      >
        <h2 id="team-view-heading">
          {working === total
            ? total === 1
              ? `${personName(team.people[0]!)} is working now`
              : "Everyone is working now"
            : working
              ? `${working} of ${total} working now`
              : "Nobody is working now"}
        </h2>
        <ul className="team-people">
          {team.people.map((person, index) => (
            <li key={index}>
              <i className={`me-dot is-${statuses[index]!.kind}`} />
              <strong>{personName(person)}</strong>
              <span>
                {statuses[index]!.local} in {friendlyName(person.zone)} ·{" "}
                {statusLabels[statuses[index]!.kind]}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="team-best">
        <h3>
          {best.everyone
            ? total === 1
              ? "Working hours this week"
              : "When everyone works, this week"
            : best.count
              ? `No time when everyone works this week. Most overlap: ${best.count} of ${best.total}`
              : "Nobody works in the next 7 days"}
        </h3>
        {best.windows.length > 0 && (
          <ul>
            {best.windows.map((window) => (
              <li key={window.start}>
                <strong>
                  {at(window.start).toFormat("ccc d LLL, HH:mm")}–
                  {at(window.end).toFormat("HH:mm")}
                </strong>{" "}
                <span>
                  {length(window.start, window.end)}
                  {!best.everyone && ` · ${window.people.join(", ")}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="me-legend">
        <span>
          <i className="me-dot is-off" />
          Nobody working
        </span>
        {legendCounts.map((count) => (
          <span key={count}>
            <i className="me-dot" style={shade(count)} />
            {count === total
              ? total === 1
                ? "Working"
                : `Everyone (${total})`
              : `${count} of ${total}`}
          </span>
        ))}
      </div>
      <div
        className="me-grid-wrap"
        tabIndex={0}
        role="region"
        aria-label="Next 7 days in your time zone, horizontally scrollable on small screens"
      >
        <table className="me-grid team-grid">
          <caption className="sr-only">
            How many people work in each half hour of the next 7 days, in{" "}
            {viewerZone}
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
            {rows.map((row, rowIndex) => (
              <tr key={row.date}>
                <th scope="row">{row.label}</th>
                {row.working.map((count, cell) => {
                  const names = team.people
                    .filter((_, person) => row.people[person]![cell] === "work")
                    .map(personName);
                  return (
                    <td
                      key={cell}
                      className={`is-team-${level(count)}${rowIndex === 0 && cell === nowCell ? " is-now" : ""}`}
                      style={shade(count)}
                      title={`${row.label} ${String(Math.floor(cell / 2)).padStart(2, "0")}:${cell % 2 ? "30" : "00"}: ${count} of ${total} working${names.length ? ` (${names.join(", ")})` : ""}`}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="detail-hint">
        Hover a half hour to see who's working. Weekends, public holidays and
        daylight saving are handled for each person.
      </p>
    </>
  );
}
