import { useMemo } from "react";
import {
  recurringCalendarText,
  recurringImpact,
  type NormalizedInput,
  type RecurringZoneTime,
  type Slot,
} from "@tzmeet/core";
import { downloadIcs } from "./invite";
import { DateTime } from "luxon";

const WEEKS = 26;
const labels = {
  ideal: "Ideal",
  acceptable: "Acceptable",
  blocked: "Blocked",
} as const;
const range = (from: string, to: string) => {
  const format = (date: string) =>
    DateTime.fromISO(date).setLocale("en").toFormat("d LLL yyyy");
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
};

function ZoneCell({ zone }: { zone: RecurringZoneTime }) {
  return (
    <td>
      <strong>{zone.localTime}</strong>
      {zone.dayOffset !== 0 && (
        <small>{zone.dayOffset > 0 ? "next day" : "previous day"}</small>
      )}
      <span className={`badge badge-${zone.classification}`}>
        {labels[zone.classification]}
      </span>
    </td>
  );
}

export default function RecurringPanel({
  input,
  slot,
  id,
}: {
  input: NormalizedInput;
  slot: Slot;
  id: string;
}) {
  const anchor = slot.zones[0]!;
  const result = useMemo(() => {
    const local = DateTime.fromISO(anchor.localStart, { setZone: true });
    try {
      return recurringImpact({
        zones: input.zones,
        ...(input.prayer ? { prayer: input.prayer } : {}),
        durationMinutes: input.durationMinutes,
        startDate: local.toISODate()!,
        time: local.toFormat("HH:mm"),
        weeks: WEEKS,
      });
    } catch {
      return null;
    }
  }, [input, anchor.localStart]);
  if (!result)
    return (
      <div id={id} className="recurring-panel">
        <p className="detail-hint">This slot can't be checked over time.</p>
      </div>
    );
  const changes = result.periods.length - 1;
  return (
    <div id={id} className="recurring-panel">
      <p className="recurring-title">
        <strong>
          Every {result.weekday} at {result.time} {anchor.label}
        </strong>
        , next {WEEKS} weeks.{" "}
        {changes
          ? `Local times change ${changes} time${changes === 1 ? "" : "s"} because of daylight saving.`
          : "Local times stay the same every week."}
      </p>
      <div
        className="recurring-scroll"
        tabIndex={0}
        role="region"
        aria-label="Weekly local times, horizontally scrollable on small screens"
      >
        <table className="recurring-table">
          <thead>
            <tr>
              <th scope="col">Weeks</th>
              {result.periods[0]!.zones.map((zone) => (
                <th key={zone.id} scope="col">
                  {zone.label}
                </th>
              ))}
              <th scope="col">What changed</th>
            </tr>
          </thead>
          <tbody>
            {result.periods.map((period) => (
              <tr key={period.from}>
                <th scope="row">
                  {range(period.from, period.to)}
                  <small>
                    {period.weeks} week{period.weeks === 1 ? "" : "s"}
                  </small>
                </th>
                {period.zones.map((zone) => (
                  <ZoneCell key={zone.id} zone={zone} />
                ))}
                <td className="recurring-cause">
                  {period.causes.join("; ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.warnings.length > 0 && (
        <ul className="recurring-warnings" aria-label="Changes to watch">
          {result.warnings.map((warning, index) => (
            <li key={index} className={`is-${warning.severity}`}>
              {warning.message}
            </li>
          ))}
        </ul>
      )}
      <div className="recurring-actions">
        <button
          type="button"
          className="button button-outline"
          onClick={() =>
            downloadIcs(
              recurringCalendarText(result, {
                created: new Date().toISOString(),
              }),
              `tzmeet-weekly-${result.occurrences[0]!.date}.ics`,
            )
          }
        >
          Download weekly series (.ics)
        </button>
        <span className="detail-hint">
          One repeating event fixed at {result.time} {anchor.label}, so
          calendars handle daylight saving for you.
        </span>
      </div>
    </div>
  );
}
