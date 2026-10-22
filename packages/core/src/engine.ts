import { DateTime } from "luxon";
import {
  findSlotsSchema,
  minutesAhead,
  validateInput,
  zoneSchema,
  type FindSlotsInput,
  type NormalizedInput,
  type PrayerRule,
  type ZoneRule,
} from "./schema.js";
import { getPrayerWindows } from "./prayer.js";
import { presetHolidays } from "./holidays.js";
import type {
  Constraint,
  ConstraintCount,
  Diagnostics,
  FindSlotsResult,
  Slot,
  SpanEvaluation,
  ZoneSlot,
} from "./types.js";

type NormalZone = NormalizedInput["zones"][number];
const isoDays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const toMinutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
/** Inclusive clock window; a start later than the end runs past midnight (e.g. 22:00–06:00). */
const inWindow = (minute: number, start: number, end: number) =>
  start <= end
    ? minute >= start && minute <= end
    : minute >= start || minute <= end;
const nameOf = (zone: NormalZone) =>
  zone.label ?? zone.id.split("/").at(-1)!.replaceAll("_", " ");

export class InputValidationError extends Error {
  constructor(public readonly errors: { path: string; message: string }[]) {
    super(errors.map((error) => `${error.path}: ${error.message}`).join("; "));
    this.name = "InputValidationError";
  }
}

function parseInput(input: FindSlotsInput): NormalizedInput {
  const parsed = validateInput(input);
  if (!parsed.success) throw new InputValidationError(parsed.errors);
  return parsed.data;
}

function evaluator(zone: NormalZone, globalPrayer?: NormalizedInput["prayer"]) {
  const dailyBoundaries = new Map<string, number[]>();
  const prayerDates = new Map<string, ReturnType<typeof getPrayerWindows>>();
  const rule = zone.prayer ?? globalPrayer;
  const workStart = toMinutes(zone.workStart);
  const workEnd = toMinutes(zone.workEnd);
  const quietBefore = toMinutes(zone.quietBefore);
  const quietAfter = toMinutes(zone.quietAfter);
  const holidays = new Set(zone.holidays ?? []);
  const presetYears = new Map<number, Set<string>>();
  const isHoliday = (date: string) => {
    if (holidays.has(date)) return true;
    if (!zone.holidayPreset) return false;
    const year = Number(date.slice(0, 4));
    let dates = presetYears.get(year);
    if (!dates) {
      dates = new Set(
        presetHolidays(zone.holidayPreset, year).map((holiday) => holiday.date),
      );
      presetYears.set(year, dates);
    }
    return dates.has(date);
  };

  function boundaries(day: DateTime): number[] {
    const key = day.toISODate()!;
    const cached = dailyBoundaries.get(key);
    if (cached) return cached;
    const start = day.startOf("day");
    const end = start.plus({ days: 1 }).startOf("day");
    const points = [start.toMillis(), end.toMillis()];
    for (const clock of [
      zone.workStart,
      zone.workEnd,
      zone.quietBefore,
      zone.quietAfter,
    ]) {
      const wall = DateTime.fromObject(
        {
          year: day.year,
          month: day.month,
          day: day.day,
          hour: Number(clock.slice(0, 2)),
          minute: Number(clock.slice(3)),
        },
        { zone: zone.id },
      );

      points.push(
        ...wall.getPossibleOffsets().map((value) => value.toMillis()),
      );
    }

    for (
      let cursor = start.toMillis();
      cursor < end.toMillis();
      cursor += 3600000
    ) {
      const next = Math.min(cursor + 3600000, end.toMillis());
      const offset = DateTime.fromMillis(cursor, { zone: zone.id }).offset;
      if (DateTime.fromMillis(next, { zone: zone.id }).offset === offset)
        continue;
      let low = cursor;
      let high = next;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (DateTime.fromMillis(middle, { zone: zone.id }).offset === offset)
          low = middle;
        else high = middle;
      }
      points.push(high);
    }
    const result = [...new Set(points)].sort((a, b) => a - b);
    dailyBoundaries.set(key, result);
    return result;
  }

  return (start: DateTime, end: DateTime): SpanEvaluation => {
    const a = start.toMillis();
    const b = end.toMillis();
    const localStart = start.setZone(zone.id);
    const localEnd = end.setZone(zone.id);
    const points = [a, b];
    const constraints = new Set<Constraint>();
    const prayers = new Set<string>();
    let ideal = true;
    for (
      let day = localStart.startOf("day");
      day.toMillis() <= localEnd.toMillis();
      day = day.plus({ days: 1 }).startOf("day")
    ) {
      points.push(...boundaries(day).filter((point) => point > a && point < b));
      if (rule) {
        for (const delta of [-2, -1, 0, 1, 2]) {
          const date = day.plus({ days: delta }).toISODate()!;
          let windows = prayerDates.get(date);
          if (!windows) {
            windows = getPrayerWindows(date, rule);
            prayerDates.set(date, windows);
          }
          for (const window of windows) {
            const left = DateTime.fromISO(window.start).toMillis();
            const right = DateTime.fromISO(window.end).toMillis();
            if (a <= right && b >= left) {
              constraints.add("prayer");
              prayers.add(window.name);
            }
          }
        }
      }
    }
    const sorted = [...new Set(points)].sort((x, y) => x - y);
    const samples = [...sorted];
    for (let i = 1; i < sorted.length; i++)
      samples.push((sorted[i - 1]! + sorted[i]!) / 2);
    for (const instant of samples) {
      const local = DateTime.fromMillis(instant, { zone: zone.id });
      const minute =
        local.hour * 60 +
        local.minute +
        local.second / 60 +
        local.millisecond / 60000;
      if (zone.weekend.includes(local.weekday)) constraints.add("weekend");
      if (
        (holidays.size || zone.holidayPreset) &&
        isHoliday(local.toISODate()!)
      )
        constraints.add("holiday");
      if (!inWindow(minute, quietBefore, quietAfter)) constraints.add("quiet");
      if (!inWindow(minute, workStart, workEnd)) ideal = false;
    }
    return {
      classification: constraints.size
        ? "blocked"
        : ideal
          ? "ideal"
          : "acceptable",
      constraints: [...constraints],
      prayers: [...prayers],
    };
  };
}

export function classifySpan(
  zone: ZoneRule,
  startISO: string,
  endISO: string,
  prayer?: PrayerRule,
): SpanEvaluation {
  return classifySpans(zone, [{ start: startISO, end: endISO }], prayer)[0]!;
}

/** Classify many spans with one search-local cache, for fast minute-resolution timelines. */
export function classifySpans(
  zone: ZoneRule,
  spans: readonly { start: string; end: string }[],
  prayer?: PrayerRule,
): SpanEvaluation[] {
  const parsed = zoneSchema.parse(zone);
  const normalizedPrayer =
    prayer === undefined
      ? undefined
      : findSlotsSchema.shape.prayer.parse(prayer);
  const evaluate = evaluator(parsed, normalizedPrayer);
  return spans.map((span) => {
    if (
      ![span.start, span.end].every((value) =>
        /(?:Z|[+-]\d{2}:\d{2})$/.test(value),
      )
    )
      throw new Error("Span instants must include Z or an explicit UTC offset");
    const start = DateTime.fromISO(span.start, { zone: "UTC" });
    const end = DateTime.fromISO(span.end, { zone: "UTC" });
    if (!start.isValid || !end.isValid || end <= start)
      throw new Error(
        "Span must contain valid ISO instants and end after start",
      );
    return evaluate(start, end);
  });
}

function humanReason(zones: ZoneSlot[], input: NormalizedInput): string {
  const ideal = zones
    .filter((zone) => zone.classification === "ideal")
    .map((zone) => zone.label);
  const acceptable = zones
    .filter((zone) => zone.classification === "acceptable")
    .map((zone) => {
      const rule = input.zones.find((rule) => rule.id === zone.id)!;
      const start = DateTime.fromISO(zone.localStart, { setZone: true });
      const end = DateTime.fromISO(zone.localEnd, { setZone: true });
      const from = toMinutes(rule.quietBefore);
      const offset = (time: DateTime) =>
        minutesAhead(from, time.hour * 60 + time.minute);
      const overnight = rule.workStart > rule.workEnd;
      const kind =
        offset(start) < minutesAhead(from, toMinutes(rule.workStart))
          ? offset(end) > minutesAhead(from, toMinutes(rule.workEnd))
            ? "outside work hours"
            : overnight
              ? "before work"
              : "early morning"
          : "after work";
      return `${kind} (acceptable) for ${zone.label}`;
    });
  return [ideal.length ? `Ideal for ${ideal.join(" & ")}` : "", ...acceptable]
    .filter(Boolean)
    .join(", ");
}

function diagnostics(
  input: NormalizedInput,
  scanned: number,
  rejected: number,
  counts: Map<string, ConstraintCount>,
  survivors: number,
): Diagnostics {
  const constraints = [...counts.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.zoneId.localeCompare(b.zoneId) ||
      a.constraint.localeCompare(b.constraint),
  );
  const most = constraints[0] ?? null;
  const weekends = input.zones
    .filter((zone) => zone.weekend.length)
    .map(
      (zone) =>
        `${zone.weekend.map((day) => isoDays[day - 1]).join("/")} weekend in ${nameOf(zone)}`,
    );
  const remaining = [1, 2, 3, 4, 5, 6, 7].filter((day) =>
    input.zones.every((zone) => !zone.weekend.includes(day)),
  );
  const weekendContext = weekends.length
    ? `${weekends.join(" + ")}. Shared non-weekend weekday labels: ${remaining.length ? remaining.map((day) => isoDays[day - 1]).join(", ") : "none"} (local dates can differ across zones).`
    : "";
  const suggestion = !most
    ? "Try a longer date range or a shorter meeting duration."
    : most.constraint === "quiet"
      ? `Relax the early/late quiet-hour cutoff for ${most.label}, shorten the meeting, or try a different week.`
      : most.constraint === "weekend"
        ? "Try a different week or change weekend days only where the team agrees."
        : most.constraint === "holiday"
          ? `A holiday in ${most.label} blocks part of this range. Try a different week, or remove that date if people are working.`
          : `Reduce the prayer buffer for ${most.label} if appropriate, or try another time/date.`;
  const dominant = most
    ? `The largest rejection count was ${most.constraint} in ${most.label} (${most.count} of ${scanned} candidates).`
    : "No full meeting fits inside the requested date range.";
  return {
    scannedCandidates: scanned,
    rejectedCandidates: rejected,
    constraints,
    mostRestrictive: most,
    message: survivors
      ? `${survivors} slots found; ${rejected} of ${scanned} candidates rejected.`
      : `No shared slots. ${dominant} ${weekendContext}`.trim(),
    suggestion,
  };
}

export function findSlots(input: FindSlotsInput): FindSlotsResult {
  const normalized = parseInput(input);
  const first = normalized.zones[0]!;
  const localRangeStart = DateTime.fromISO(normalized.startDate, {
    zone: first.id,
  }).startOf("day");
  const rangeStart = localRangeStart.toUTC();
  const rangeEnd = localRangeStart
    .plus({ days: normalized.days })
    .startOf("day")
    .toUTC();
  const evaluations = normalized.zones.map((zone) =>
    evaluator(zone, normalized.prayer),
  );
  const firstWorkStart = toMinutes(first.workStart);
  const firstWorkEnd = toMinutes(first.workEnd);
  const overnightWork = firstWorkStart > firstWorkEnd;
  const workMiddle = overnightWork
    ? (firstWorkStart + minutesAhead(firstWorkStart, firstWorkEnd) / 2) % 1440
    : (firstWorkStart + firstWorkEnd) / 2;
  const slots: Slot[] = [];
  const counts = new Map<string, ConstraintCount>();
  let scanned = 0;
  let rejected = 0;
  for (
    let start = rangeStart;
    start.plus({ minutes: normalized.durationMinutes }) <= rangeEnd;
    start = start.plus({ minutes: normalized.stepMinutes })
  ) {
    scanned++;
    const end = start.plus({ minutes: normalized.durationMinutes });
    const classified = normalized.zones.map((_, i) =>
      evaluations[i]!(start, end),
    );
    let blocked = false;
    classified.forEach((evaluation, i) => {
      const zone = normalized.zones[i]!;
      if (evaluation.classification === "blocked") blocked = true;
      for (const constraint of evaluation.constraints) {
        const key = `${zone.id}:${constraint}`;
        const current = counts.get(key) ?? {
          zoneId: zone.id,
          label: nameOf(zone),
          constraint,
          count: 0,
        };
        current.count++;
        counts.set(key, current);
      }
    });
    if (blocked) {
      rejected++;
      continue;
    }
    const zones: ZoneSlot[] = normalized.zones.map((zone, i) => {
      const localStart = start.setZone(zone.id);
      const localEnd = end.setZone(zone.id);
      return {
        id: zone.id,
        label: nameOf(zone),
        localStart: localStart.toISO()!,
        localEnd: localEnd.toISO()!,
        formattedStart: localStart
          .setLocale("en")
          .toFormat("ccc d LLL yyyy, HH:mm ZZZZ"),
        formattedEnd: localEnd
          .setLocale("en")
          .toFormat("ccc d LLL yyyy, HH:mm ZZZZ"),
        classification: classified[i]!.classification as "ideal" | "acceptable",
      };
    });
    const baseScore = zones.reduce(
      (score, zone) => score + (zone.classification === "ideal" ? 2 : 1),
      0,
    );
    const earliness =
      1 -
      (start.toMillis() - rangeStart.toMillis()) /
        (rangeEnd.toMillis() - rangeStart.toMillis());
    const localMiddle = start
      .plus({ minutes: normalized.durationMinutes / 2 })
      .setZone(first.id);
    const offWork = Math.abs(
      localMiddle.hour * 60 +
        localMiddle.minute +
        localMiddle.second / 60 -
        workMiddle,
    );
    const proximity = Math.max(
      0,
      1 - (overnightWork ? Math.min(offWork, 1440 - offWork) : offWork) / 720,
    );
    slots.push({
      start: start.toISO()!,
      end: end.toISO()!,
      date: start.setZone(first.id).toISODate()!,
      baseScore,
      score: baseScore + 0.06 * earliness + 0.03 * proximity,
      zones,
      reason: humanReason(zones, normalized),
    });
  }
  slots.sort((a, b) => b.score - a.score || a.start.localeCompare(b.start));
  return {
    slots,
    diagnostics: diagnostics(
      normalized,
      scanned,
      rejected,
      counts,
      slots.length,
    ),
    range: { start: rangeStart.toISO()!, end: rangeEnd.toISO()! },
  };
}
