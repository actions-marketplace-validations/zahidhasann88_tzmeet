import { DateTime, IANAZone } from "luxon";
import { z } from "zod";
import { classifySpans, InputValidationError } from "./engine.js";
import { findSlotsSchema, timeSchema } from "./schema.js";
import { resolveWall, scanTransitions } from "./transitions.js";
import type { Classification, Constraint } from "./types.js";

export const recurringSchema = findSlotsSchema
  .omit({ days: true, stepMinutes: true })
  .extend({
    time: timeSchema,
    weeks: z.number().int().min(1).max(104).default(26),
  })
  .strict();
export type RecurringInput = z.input<typeof recurringSchema>;

export interface RecurringZoneTime {
  id: string;
  label: string;
  localStart: string;
  localTime: string;
  dayOffset: number;
  classification: Classification;
  constraints: Constraint[];
}
export interface RecurringOccurrence {
  date: string;
  start: string;
  end: string;
  status: "ok" | "shifted" | "ambiguous";
  zones: RecurringZoneTime[];
}

export interface RecurringPeriod {
  from: string;
  to: string;
  weeks: number;
  causes: string[];
  zones: RecurringZoneTime[];
}
export interface RecurringWarning {
  severity: "warning" | "info";
  message: string;
  date: string;
}
export interface RecurringImpact {
  anchor: string;
  time: string;
  weekday: string;
  durationMinutes: number;
  weeks: number;
  occurrences: RecurringOccurrence[];
  periods: RecurringPeriod[];
  warnings: RecurringWarning[];
}

const weekdays = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const rank: Record<Classification, number> = {
  ideal: 0,
  acceptable: 1,
  blocked: 2,
};
const nameOf = (zone: { id: string; label?: string }) =>
  zone.label ??
  (zone.id === "UTC" ? "UTC" : zone.id.split("/").at(-1)!.replaceAll("_", " "));

function amount(minutes: number): string {
  const size = Math.abs(minutes);
  return size % 60
    ? `${size} minutes`
    : `${size / 60} hour${size === 60 ? "" : "s"}`;
}

function describe(zone: RecurringZoneTime, base?: RecurringZoneTime): string {
  const day = zone.dayOffset
    ? ` (${zone.dayOffset > 0 ? "next" : "previous"} day)`
    : "";
  const state =
    zone.classification === "blocked"
      ? `blocked: ${zone.constraints.map((constraint) => (constraint === "quiet" ? "outside allowed hours" : constraint)).join(", ")}`
      : zone.classification === "acceptable"
        ? "outside work hours"
        : "";
  const was =
    base && base.localTime !== zone.localTime
      ? ` instead of ${base.localTime}`
      : "";
  return `${zone.label} at ${zone.localTime}${day}${was}${state ? ` (${state})` : ""}`;
}

export function recurringImpact(input: RecurringInput): RecurringImpact {
  const parsed = recurringSchema.safeParse(input);
  if (!parsed.success)
    throw new InputValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  const { zones, startDate, time, weeks, durationMinutes, prayer } =
    parsed.data;
  const anchor = zones[0]!;
  const tz = IANAZone.create(anchor.id);
  const first = DateTime.fromISO(startDate, { zone: "UTC" });
  const [hour, minute] = time.split(":").map(Number) as [number, number];

  const timing = Array.from({ length: weeks }, (_, week) => {
    const date = first.plus({ weeks: week });
    const naive = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
    const wall = resolveWall(tz, naive);
    const start =
      wall.instants[0] ?? naive - tz.offset(naive - 86400000) * 60000;
    const status: RecurringOccurrence["status"] =
      wall.instants.length === 2
        ? "ambiguous"
        : wall.instants.length
          ? "ok"
          : "shifted";
    return {
      date: date.toISODate()!,
      start,
      end: start + durationMinutes * 60000,
      status,
    };
  });
  const iso = (millis: number) =>
    DateTime.fromMillis(millis, { zone: "UTC" }).toISO()!;
  const spans = timing.map((entry) => ({
    start: iso(entry.start),
    end: iso(entry.end),
  }));
  const evaluations = zones.map((zone) =>
    classifySpans(zone, spans, zone.prayer ?? prayer),
  );

  const occurrences: RecurringOccurrence[] = timing.map((entry, week) => ({
    date: entry.date,
    start: spans[week]!.start,
    end: spans[week]!.end,
    status: entry.status,
    zones: zones.map((zone, index) => {
      const local = DateTime.fromMillis(entry.start, { zone: zone.id });
      const evaluation = evaluations[index]![week]!;
      return {
        id: zone.id,
        label: nameOf(zone),
        localStart: local.toISO()!,
        localTime: local.toFormat("HH:mm"),
        dayOffset: Math.round(
          DateTime.fromISO(local.toISODate()!, { zone: "UTC" }).diff(
            DateTime.fromISO(entry.date, { zone: "UTC" }),
            "days",
          ).days,
        ),
        classification: evaluation.classification,
        constraints: evaluation.constraints,
      };
    }),
  }));

  const key = (occurrence: RecurringOccurrence) =>
    occurrence.status +
    occurrence.zones
      .map(
        (zone) => `|${zone.localTime}/${zone.dayOffset}/${zone.classification}`,
      )
      .join("");
  const periods: RecurringPeriod[] = [];
  occurrences.forEach((occurrence, week) => {
    const current = periods.at(-1);
    if (current && key(occurrences[week - 1]!) === key(occurrence)) {
      current.to = occurrence.date;
      current.weeks += 1;
      return;
    }
    const causes: string[] = [];
    if (week > 0) {
      const before = timing[week - 1]!.start;
      for (const zone of zones) {
        for (const change of scanTransitions(
          IANAZone.create(zone.id),
          before,
          timing[week]!.start,
        )) {
          const delta = change.offsetAfter - change.offsetBefore;
          causes.push(
            `${zone.id} clocks went ${delta > 0 ? "forward" : "back"} ${amount(delta)} on ${DateTime.fromMillis(change.at, { zone: zone.id }).toISODate()}`,
          );
        }
      }
      occurrence.zones.forEach((zone, index) => {
        const was = occurrences[week - 1]!.zones[index]!;
        if (
          zone.constraints.includes("holiday") &&
          !was.constraints.includes("holiday")
        )
          causes.push(`Holiday in ${zone.label}`);
        if (
          !zone.constraints.includes("holiday") &&
          was.constraints.includes("holiday")
        )
          causes.push(`Holiday in ${zone.label} is over`);
      });
    }
    periods.push({
      from: occurrence.date,
      to: occurrence.date,
      weeks: 1,
      causes,
      zones: occurrence.zones,
    });
  });

  const warnings: RecurringWarning[] = [];
  for (const occurrence of occurrences) {
    if (occurrence.status === "shifted")
      warnings.push({
        severity: "warning",
        date: occurrence.date,
        message: `On ${occurrence.date}, ${time} doesn't exist in ${anchor.id} because clocks jump forward. Calendars move the meeting to ${occurrence.zones[0]!.localTime}.`,
      });
    if (occurrence.status === "ambiguous")
      warnings.push({
        severity: "warning",
        date: occurrence.date,
        message: `On ${occurrence.date}, ${time} happens twice in ${anchor.id} because clocks go back. Calendars use the first one.`,
      });
  }
  const baseline = periods[0]!;
  const blocked = baseline.zones.filter(
    (zone) => zone.classification === "blocked",
  );
  if (blocked.length)
    warnings.push({
      severity: "warning",
      date: baseline.from,
      message: `From the first week, ${blocked.map((zone) => describe(zone)).join("; ")}.`,
    });
  for (const period of periods.slice(1)) {
    const changed = period.zones.filter((zone, index) => {
      const base = baseline.zones[index]!;
      return (
        zone.localTime !== base.localTime ||
        zone.dayOffset !== base.dayOffset ||
        zone.classification !== base.classification
      );
    });
    if (!changed.length) continue;
    const worse = changed.some(
      (zone) =>
        rank[zone.classification] >
        rank[
          baseline.zones.find((base) => base.id === zone.id)!.classification
        ],
    );
    const range =
      period.weeks === 1
        ? `Week of ${period.from}`
        : `${period.from} to ${period.to} (${period.weeks} weeks)`;
    const parts = changed.map((zone) =>
      describe(
        zone,
        baseline.zones.find((base) => base.id === zone.id),
      ),
    );
    warnings.push({
      severity: worse ? "warning" : "info",
      date: period.from,
      message: `${range}: ${parts.join("; ")}.${period.causes.length ? ` ${period.causes.join("; ")}.` : ""}`,
    });
  }

  return {
    anchor: anchor.id,
    time,
    weekday: weekdays[first.weekday]!,
    durationMinutes,
    weeks,
    occurrences,
    periods,
    warnings,
  };
}
