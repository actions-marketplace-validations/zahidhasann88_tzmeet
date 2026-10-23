import { DateTime, IANAZone } from "luxon";
import { scanTransitions } from "./transitions.js";
import type { RecurringImpact } from "./recurring.js";
import type { Slot } from "./types.js";

export function inviteText(slot: Slot): string {
  const first = DateTime.fromISO(slot.zones[0]!.localStart, {
    setZone: true,
  }).setLocale("en");
  const lines = slot.zones.map((zone) => {
    const start = DateTime.fromISO(zone.localStart, {
      setZone: true,
    }).setLocale("en");
    const end = DateTime.fromISO(zone.localEnd, { setZone: true }).setLocale(
      "en",
    );
    const suffix =
      start.toISODate() === first.toISODate()
        ? ""
        : ` (${start.toFormat("ccc d LLL")})`;
    const endDay =
      end.toISODate() === start.toISODate()
        ? ""
        : ` (${end.toFormat("ccc d LLL")})`;
    const optional = zone.optional
      ? zone.classification === "blocked"
        ? " (optional, unavailable)"
        : " (optional)"
      : "";
    return `${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}${endDay} ${zone.label}${suffix}${optional}`;
  });
  return `${first.toFormat("ccc d LLL yyyy")}: ${lines.join(" / ")}\n${slot.reason}\nUTC: ${slot.start} → ${slot.end}`;
}
const escapeText = (text: string) =>
  text
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
const stamp = (iso: string) =>
  DateTime.fromISO(iso, { zone: "UTC" })
    .toUTC()
    .toFormat("yyyyLLdd'T'HHmmss'Z'");

export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  let current = "";
  let length = 0;
  const lines: string[] = [];
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) {
      lines.push(current);
      current = " ";
      length = 1;
    }
    current += character;
    length += bytes;
  }
  lines.push(current);
  return lines.join("\r\n");
}

export function calendarText(slot: Slot, created: string): string {
  let hash = 2166136261;
  for (const char of JSON.stringify([
    slot.start,
    slot.end,
    slot.zones.map((zone) => zone.id),
  ]))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//tzmeet//Meeting slots//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${stamp(slot.start)}-${hash.toString(16)}@tzmeet.local`,
      `DTSTAMP:${stamp(created)}`,
      `DTSTART:${stamp(slot.start)}`,
      `DTEND:${stamp(slot.end)}`,
      "SUMMARY:Team meeting",
      `DESCRIPTION:${escapeText(inviteText(slot))}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(foldLine)
      .join("\r\n") + "\r\n"
  );
}

export function calendarCollectionText(
  slots: readonly Slot[],
  created: string,
): string {
  const events = slots.map((slot) => {
    const calendar = calendarText(slot, created);
    const begin = calendar.indexOf("BEGIN:VEVENT");
    const end = calendar.indexOf("END:VEVENT") + "END:VEVENT".length;
    return calendar
      .slice(begin, end)
      .replace("\r\nSTATUS:CONFIRMED\r\n", "\r\nSTATUS:TENTATIVE\r\n");
  });
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//tzmeet//Meeting slots//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      ...events,
      "END:VCALENDAR",
    ].join("\r\n") + "\r\n"
  );
}

const wall = (millis: number, zone: string) =>
  DateTime.fromMillis(millis, { zone }).toFormat("yyyyLLdd'T'HHmmss");
const offsetText = (minutes: number) =>
  `${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}${String(Math.abs(minutes) % 60).padStart(2, "0")}`;

function timeZoneBlock(zone: string, from: number, to: number): string[] {
  const tz = IANAZone.create(zone);
  const changes = scanTransitions(tz, from, to);
  const offsets = [
    tz.offset(from),
    ...changes.map((change) => change.offsetAfter),
  ];
  const standard = Math.min(...offsets);
  const name = (millis: number) =>
    DateTime.fromMillis(millis, { zone }).setLocale("en").toFormat("ZZZZ");
  const observance = (
    onset: string,
    before: number,
    after: number,
    at: number,
  ) => [
    `BEGIN:${after > standard ? "DAYLIGHT" : "STANDARD"}`,
    `DTSTART:${onset}`,
    `TZOFFSETFROM:${offsetText(before)}`,
    `TZOFFSETTO:${offsetText(after)}`,
    `TZNAME:${name(at)}`,
    `END:${after > standard ? "DAYLIGHT" : "STANDARD"}`,
  ];
  return [
    "BEGIN:VTIMEZONE",
    `TZID:${zone}`,
    ...observance(wall(from, zone), tz.offset(from), tz.offset(from), from),
    ...changes.flatMap((change) =>
      observance(
        DateTime.fromMillis(change.at + change.offsetBefore * 60000, {
          zone: "UTC",
        }).toFormat("yyyyLLdd'T'HHmmss"),
        change.offsetBefore,
        change.offsetAfter,
        change.at,
      ),
    ),
    "END:VTIMEZONE",
  ];
}

export function recurringCalendarText(
  impact: RecurringImpact,
  options: { created: string; title?: string },
): string {
  const first = impact.occurrences[0]!;
  const last = impact.occurrences.at(-1)!;
  const zone = impact.anchor;
  const start = Date.parse(first.start);
  const end = Date.parse(first.end);
  let hash = 2166136261;
  for (const char of JSON.stringify([
    zone,
    impact.time,
    first.date,
    impact.durationMinutes,
    impact.weeks,
    first.zones.map((entry) => entry.id),
  ]))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const firstWeek = first.zones
    .map(
      (entry) =>
        `${DateTime.fromISO(entry.localStart, { setZone: true }).toFormat("HH:mm")} ${entry.label}`,
    )
    .join(" / ");
  const description = [
    `Every ${impact.weekday} at ${impact.time} ${zone} (${impact.durationMinutes} min), ${impact.weeks} weeks from ${first.date}.`,
    `First week: ${firstWeek}.`,
    ...impact.warnings.map((warning) => warning.message),
  ].join("\n");
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//tzmeet//Meeting slots//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      ...timeZoneBlock(zone, start - 86400000, Date.parse(last.end) + 86400000),
      "BEGIN:VEVENT",
      `UID:${stamp(first.start)}-${hash.toString(16)}-weekly@tzmeet.local`,
      `DTSTAMP:${stamp(options.created)}`,
      `DTSTART;TZID=${zone}:${wall(start, zone)}`,
      `DTEND;TZID=${zone}:${wall(end, zone)}`,
      `RRULE:FREQ=WEEKLY;COUNT=${impact.weeks}`,
      `SUMMARY:${escapeText(options.title ?? "Team meeting")}`,
      `DESCRIPTION:${escapeText(description)}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(foldLine)
      .join("\r\n") + "\r\n"
  );
}
