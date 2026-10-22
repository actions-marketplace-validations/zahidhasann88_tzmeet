import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import {
  convertCronDialect,
  convertCronZone,
  cronDialectName,
  cronDialects,
  detectDialect,
  explainCron,
  listTimeZones,
  parseCron,
  ScheduleInputError,
  type CronDialect,
  type CronExplanation,
  type CronRunNote,
} from "@tzmeet/core";
import Icon from "./Icon";
import { friendlyName } from "./state";
import {
  cronCounts,
  cronHash,
  defaultCronState,
  fieldLabels,
  maxDisplayZones,
  parseCronHash,
  type CronState, cronShareLink } from "./cron-state";

const examples: { label: string; state: Partial<CronState> }[] = [
  {
    label: "Nightly 02:30, New York",
    state: {
      expression: "30 2 * * *",
      dialect: "unix",
      zone: "America/New_York",
    },
  },
  {
    label: "Kubernetes 01:30 in London",
    state: {
      expression: "30 1 * * *",
      dialect: "kubernetes",
      zone: "Europe/London",
    },
  },
  {
    label: "Quartz weekdays 09:00 Dhaka",
    state: {
      expression: "0 0 9 ? * MON-FRI",
      dialect: "quartz",
      zone: "Asia/Dhaka",
    },
  },
  {
    label: "Spring every 15 minutes",
    state: { expression: "0 */15 * * * *", dialect: "spring", zone: "UTC" },
  },
  {
    label: "Friday the 13th?",
    state: { expression: "0 9 13 * 5", dialect: "unix", zone: "UTC" },
  },
];
const notes: Record<CronRunNote, string> = {
  "gap-catch-up":
    "Late: DST skipped this time, so cron runs it right after the change",
  "fold-once": "Clocks repeat this time; runs only once",
  "fold-first": "Clocks repeat this time; 1st of 2 runs",
  "fold-second": "Clocks repeat this time; 2nd of 2 runs",
};
const fieldOrder = [
  "second",
  "minute",
  "hour",
  "dayOfMonth",
  "month",
  "dayOfWeek",
  "year",
];

export default function CronPage({
  copy,
}: {
  copy: (text: string, message: string) => Promise<void>;
}) {
  const [state, setState] = useState<CronState>(() =>
    parseCronHash(window.location.hash),
  );
  const [from] = useState(() => new Date().toISOString());
  const zones = useMemo(() => listTimeZones(), []);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.hash = cronHash(state);
    window.history.replaceState(window.history.state, "", url);
  }, [state]);

  const dialect = state.dialect === "auto" ? undefined : state.dialect;
  const parsed = useMemo(
    () => parseCron(state.expression, dialect),
    [state.expression, dialect],
  );
  const explained = useMemo((): {
    result: CronExplanation | null;
    errors: string[];
  } => {
    if (!parsed.ok)
      return {
        result: null,
        errors: parsed.errors.map((error) => error.message),
      };
    try {
      return {
        result: explainCron({
          expression: state.expression,
          dialect,
          zone: state.zone,
          from,
          count: state.count,
          displayZones: state.display,
        }),
        errors: [],
      };
    } catch (error) {
      return {
        result: null,
        errors:
          error instanceof ScheduleInputError
            ? error.issues.map((issue) => issue.message)
            : ["This expression could not be explained."],
      };
    }
  }, [parsed, state, dialect, from]);
  const result = explained.result;

  const tokens = state.expression.trim().startsWith("@")
    ? []
    : state.expression
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .filter((token, index) => index > 0 || !/^(?:CRON_)?TZ=/i.test(token));
  const badFields = new Set<string>(
    parsed.ok ? [] : parsed.errors.map((error) => error.field),
  );
  const names =
    tokens.length === 5
      ? ["minute", "hour", "dayOfMonth", "month", "dayOfWeek"]
      : fieldOrder;
  const update = (changes: Partial<CronState>) =>
    setState((current) => ({ ...current, ...changes }));
  const columns = state.display.filter(
    (id) => id !== (result?.zone ?? state.zone),
  );

  return (
    <>
      <section className="intro" aria-labelledby="cron-title">
        <div>
          <p className="eyebrow">
            <span className="status-dot" /> CRON, WITHOUT THE DST SURPRISES
          </p>
          <h1 id="cron-title">
            Explain a cron schedule<span>.</span>
          </h1>
          <p className="intro-copy">
            Unix, Kubernetes, Spring or Quartz. See every next run in Dhaka,
            UTC, New York and London,
            <br className="desktop-break" /> and find out before a clock change
            skips a job or runs it twice.
          </p>
        </div>
      </section>
      <div className="cron-layout">
        <aside className="settings cron-settings" aria-label="Cron settings">
          <section className="settings-section">
            <div className="section-heading">
              <span className="step-number">01</span>
              <h2>Expression</h2>
            </div>
            <label className="cron-expression">
              Cron expression
              <input
                aria-label="Cron expression"
                spellCheck={false}
                autoComplete="off"
                value={state.expression}
                onChange={(event) => update({ expression: event.target.value })}
              />
            </label>
            {tokens.length > 0 && (
              <ol className="cron-chips" aria-label="Fields">
                {tokens.map((token, index) => (
                  <li
                    key={index}
                    className={
                      badFields.has(names[index] ?? "") ? "invalid" : ""
                    }
                  >
                    <code>{token}</code>
                    <span>{fieldLabels(tokens.length)[index] ?? "extra"}</span>
                  </li>
                ))}
              </ol>
            )}
            <label className="full-field">
              Syntax
              <select
                aria-label="Cron syntax"
                value={state.dialect}
                onChange={(event) =>
                  update({
                    dialect: event.target.value as CronState["dialect"],
                  })
                }
              >
                <option value="auto">
                  Detect ({cronDialectName(detectDialect(state.expression))})
                </option>
                {cronDialects.map((name) => (
                  <option key={name} value={name}>
                    {cronDialectName(name as CronDialect)}
                  </option>
                ))}
              </select>
            </label>
            <div className="cron-examples">
              <span>Try</span>
              {examples.map((example) => (
                <button
                  key={example.label}
                  onClick={() => update(example.state)}
                >
                  {example.label}
                </button>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <div className="section-heading">
              <span className="step-number">02</span>
              <h2>Time zones</h2>
            </div>
            <ZoneInput
              label="Schedule runs in"
              zones={zones}
              value={state.zone}
              onPick={(zone) => update({ zone })}
            />
            <p className="detail-hint">
              CRON_TZ, spec.timeZone, @Scheduled zone or the trigger's zone.
              Servers often default to UTC.
            </p>
            <fieldset className="cron-display">
              <legend>Show runs in</legend>
              <ul className="zone-chips">
                {state.display.map((id) => (
                  <li key={id}>
                    <span>{friendlyName(id)}</span>
                    <button
                      aria-label={`Stop showing ${id}`}
                      onClick={() =>
                        update({
                          display: state.display.filter((zone) => zone !== id),
                        })
                      }
                    >
                      <Icon name="close" />
                    </button>
                  </li>
                ))}
              </ul>
              {state.display.length < maxDisplayZones && (
                <ZoneInput
                  label="Add a zone"
                  zones={zones.filter((id) => !state.display.includes(id))}
                  value=""
                  clearOnPick
                  onPick={(zone) =>
                    update({ display: [...state.display, zone] })
                  }
                />
              )}
            </fieldset>
            <label className="full-field">
              Runs to list
              <select
                aria-label="Runs to list"
                value={state.count}
                onChange={(event) =>
                  update({ count: Number(event.target.value) })
                }
              >
                {cronCounts.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-outline cron-reset"
              onClick={() => setState(defaultCronState())}
            >
              Reset
            </button>
          </section>
        </aside>
        <section
          id="cron-results"
          className="cron-results"
          aria-labelledby="cron-results-heading"
          tabIndex={-1}
        >
          {explained.errors.length > 0 && (
            <div className="error-box" role="alert">
              <strong>Check the expression</strong>
              {explained.errors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          )}
          {result && (
            <>
              <div className="cron-summary">
                <p className="eyebrow">
                  {result.dialectName.toUpperCase()} · RUNS IN{" "}
                  {result.zone.toUpperCase()}
                </p>
                <h2 id="cron-results-heading">{result.description}</h2>
                <button
                  className="button button-outline"
                  onClick={() => {
                    void copy(
                      cronShareLink(state, window.location.href),
                      "Link copied. It opens this exact schedule.",
                    );
                  }}
                >
                  <Icon name="link" />
                  Copy link
                </button>
              </div>
              <WarningList
                label="Warnings"
                items={result.warnings.filter(
                  (warning) => warning.severity === "warning",
                )}
              />
              {result.runs.length > 0 && (
                <div
                  className="cron-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Next runs, horizontally scrollable on small screens"
                >
                  <table className="cron-table">
                    <caption className="sr-only">
                      Next {result.runs.length} runs after{" "}
                      {DateTime.fromISO(from).toFormat("d LLL yyyy HH:mm")}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">
                          {friendlyName(result.zone)}
                          <small>schedule zone</small>
                        </th>
                        {columns.map((id) => (
                          <th key={id} scope="col">
                            {friendlyName(id)}
                            <small>{id}</small>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.runs.map((run, index) => (
                        <tr
                          key={`${run.utc}-${index}`}
                          className={run.note ? "has-note" : ""}
                        >
                          <td className="cron-rank">{index + 1}</td>
                          <TimeCell
                            iso={run.local}
                            seconds={result.fields.some(
                              (field) => field.name === "second",
                            )}
                            note={run.note}
                          />
                          {columns.map((id) => (
                            <TimeCell
                              key={id}
                              iso={
                                run.zones.find((zone) => zone.zone === id)!
                                  .local
                              }
                              seconds={result.fields.some(
                                (field) => field.name === "second",
                              )}
                            />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <WarningList
                label="Notes"
                items={result.warnings.filter(
                  (warning) => warning.severity === "info",
                )}
              />
              {result.skipped.length > 0 && (
                <div className="cron-skipped">
                  <strong>Skipped by DST</strong>
                  <ul>
                    {result.skipped.map((entry) => (
                      <li key={entry.scheduled}>
                        {DateTime.fromISO(entry.scheduled).toFormat(
                          "ccc d LLL yyyy, HH:mm",
                        )}{" "}
                        in {friendlyName(result.zone)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <ConvertPanel
                expression={state.expression}
                dialect={result.dialect}
                zone={result.zone}
                from={from}
                zones={zones}
                copy={copy}
              />
              <p className="result-disclaimer">
                DST behaviour follows each engine's source and docs: cronie,
                robfig/cron, Spring and Quartz. Uses your browser's time zone
                data.
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function WarningList({
  label,
  items,
}: {
  label: string;
  items: CronExplanation["warnings"];
}) {
  if (!items.length) return null;
  return (
    <ul className="cron-warnings" aria-label={label}>
      {items.map((warning, index) => (
        <li key={index} className={`cron-warning is-${warning.severity}`}>
          <strong>
            {warning.severity === "warning" ? "Heads up" : "Note"}
          </strong>
          <span>{warning.message}</span>
        </li>
      ))}
    </ul>
  );
}

function TimeCell({
  iso,
  seconds,
  note,
}: {
  iso: string;
  seconds: boolean;
  note?: CronRunNote;
}) {
  const time = DateTime.fromISO(iso, { setZone: true }).setLocale("en");
  return (
    <td>
      <strong>{time.toFormat(seconds ? "HH:mm:ss" : "HH:mm")}</strong>
      <small>
        {time.toFormat("ccc d LLL")} · {time.toFormat("ZZ")}
      </small>
      {note && <span className="cron-note">{notes[note]}</span>}
    </td>
  );
}

function ZoneInput({
  label,
  zones,
  value,
  onPick,
  clearOnPick,
}: {
  label: string;
  zones: string[];
  value: string;
  onPick: (zone: string) => void;
  clearOnPick?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const id = `zones-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const match = (text: string) =>
    zones.find((zone) => zone.toLowerCase() === text.trim().toLowerCase());
  const pick = (text: string) => {
    const zone = match(text);
    if (!zone) return false;
    onPick(zone);
    if (clearOnPick) setDraft("");
    return true;
  };
  return (
    <label className="full-field">
      {label}
      <input
        aria-label={label}
        list={id}
        placeholder="Type a city or IANA zone"
        value={draft}
        aria-invalid={draft !== "" && !match(draft) ? true : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          if (!clearOnPick) pick(event.target.value);
          else if (match(event.target.value)) pick(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            const first = zones.find((zone) =>
              `${zone} ${friendlyName(zone)}`
                .toLowerCase()
                .includes(draft.trim().toLowerCase()),
            );
            if (first && draft.trim()) {
              onPick(first);
              setDraft(clearOnPick ? "" : first);
            }
          }
        }}
      />
      <datalist id={id}>
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {friendlyName(zone)}
          </option>
        ))}
      </datalist>
    </label>
  );
}

/** Convert the expression to another syntax, or for a server in another time zone. */
function ConvertPanel({
  expression,
  dialect,
  zone,
  from,
  zones,
  copy,
}: {
  expression: string;
  dialect: CronDialect;
  zone: string;
  from: string;
  zones: string[];
  copy: (text: string, message: string) => Promise<void>;
}) {
  const [target, setTarget] = useState<CronDialect | "">("");
  const [serverZone, setServerZone] = useState("");
  const converted = useMemo(() => {
    try {
      return {
        dialect: target ? convertCronDialect(expression, { from: dialect, to: target }) : null,
        zone: serverZone && serverZone !== zone ? convertCronZone({ expression, dialect, fromZone: zone, toZone: serverZone, from }) : null,
      };
    } catch {
      return { dialect: null, zone: null };
    }
  }, [expression, dialect, zone, from, target, serverZone]);
  const copyable = (text: string) => (
    <div key={text} className="convert-expression">
      <code>{text}</code>
      <button type="button" className="text-button" aria-label={`Copy ${text}`} onClick={() => void copy(text, "Expression copied.")}>
        Copy
      </button>
    </div>
  );
  return (
    <section className="convert-panel" aria-labelledby="convert-heading">
      <h3 id="convert-heading">Convert</h3>
      <div className="field-pair">
        <label>
          To syntax
          <select aria-label="Convert to syntax" value={target} onChange={(event) => setTarget(event.target.value as CronDialect | "")}>
            <option value="">Choose…</option>
            {cronDialects.filter((name) => name !== dialect).map((name) => (
              <option key={name} value={name}>
                {cronDialectName(name)}
              </option>
            ))}
          </select>
        </label>
        <ZoneInput label="Server time zone" zones={zones} value={serverZone} onPick={setServerZone} />
      </div>
      {converted.dialect && (
        <div className="convert-result">
          <strong>{cronDialectName(converted.dialect.to)}</strong>
          {converted.dialect.expressions.map(copyable)}
          {converted.dialect.problems.map((problem) => (
            <p key={problem} className="convert-problem">{problem}</p>
          ))}
          {converted.dialect.notes.map((note) => (
            <p key={note} className="detail-hint">{note}</p>
          ))}
        </div>
      )}
      {converted.zone && (
        <div className="convert-result">
          <strong>For a server in {converted.zone.toZone}</strong>
          <p className="detail-hint">{converted.zone.message}</p>
          {converted.zone.periods.map((period) => (
            <div key={period.from} className="convert-period">
              <span>{converted.zone!.constant ? "All year" : `${period.from} to ${period.to}`}</span>
              {period.expressions.map(copyable)}
              {period.problems.map((problem) => (
                <p key={problem} className="convert-problem">{problem}</p>
              ))}
            </div>
          ))}
          <p className="detail-hint">Recommended: keep the schedule and set the scheduler's time zone, which stays right through daylight saving.</p>
          <pre className="convert-native">{converted.zone.native}</pre>
        </div>
      )}
    </section>
  );
}
