import { DateTime } from "luxon";
import { classifySpan } from "./engine.js";
import { presetHolidays } from "./holidays.js";
import { zoneSchema, type ZoneRule } from "./schema.js";

export type BadgeStatus = "working" | "off" | "weekend" | "holiday";

export interface AvailabilityNow {
  status: BadgeStatus;
  holiday?: string;
  local: string;
}

export function availabilityNow(
  zone: ZoneRule,
  at: Date | string,
): AvailabilityNow {
  const start = DateTime.fromJSDate(new Date(at)).toUTC().startOf("minute");
  const evaluation = classifySpan(
    zone,
    start.toISO()!,
    start.plus({ minutes: 1 }).toISO()!,
  );
  const local = start.setZone(zone.id);
  if (evaluation.classification === "ideal")
    return { status: "working", local: local.toISO()! };
  if (evaluation.constraints.includes("holiday")) {
    const parsed = zoneSchema.parse(zone);
    const date = local.toISODate()!;
    const name = parsed.holidayPreset
      ? presetHolidays(parsed.holidayPreset, local.year).find(
          (holiday) => holiday.date === date,
        )?.name
      : undefined;
    return {
      status: "holiday",
      ...(name ? { holiday: name } : {}),
      local: local.toISO()!,
    };
  }
  if (evaluation.constraints.includes("weekend"))
    return { status: "weekend", local: local.toISO()! };
  return { status: "off", local: local.toISO()! };
}

const colors: Record<BadgeStatus, string> = {
  working: "#2f7a5c",
  off: "#5f6d68",
  weekend: "#5f6d68",
  holiday: "#9a5b13",
};

function textWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    if ("ijlI.,:;!|'".includes(character)) width += 3.6;
    else if (character === " ") width += 3.9;
    else if ("frt".includes(character)) width += 4.6;
    else if ("mwMW".includes(character)) width += 10.6;
    else if (/[A-Z]/.test(character)) width += 7.6;
    else if (/[0-9]/.test(character)) width += 7;
    else width += 6.6;
  }
  return Math.ceil(width);
}

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export function badgeMessage(
  availability: Pick<AvailabilityNow, "status" | "holiday">,
): string {
  if (availability.status !== "holiday") return availability.status;
  const name = availability.holiday;
  if (!name) return "holiday";
  const short =
    name.length > 32 ? `${name.slice(0, 32).replace(/\s+\S*$/, "")}…` : name;
  return `holiday: ${short}`;
}

export function badgeSvg(options: {
  label: string;
  status: BadgeStatus;
  holiday?: string;
  zone: string;
}): string {
  const label = options.label.slice(0, 40);
  const message = badgeMessage(options);
  const labelWidth = textWidth(label);
  const messageWidth = textWidth(message);
  const left = labelWidth + 12;
  const right = messageWidth + 12;
  const width = left + right;
  const title = `${label}: ${message} (${options.zone})`;
  let hash = 2166136261;
  for (const character of title)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const id = `tzmeet-${hash.toString(36)}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeXml(title)}">`,
    `<title>${escapeXml(title)}</title>`,
    `<linearGradient id="${id}-s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`,
    `<clipPath id="${id}-r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#${id}-r)"><rect width="${left}" height="20" fill="#33413e"/><rect x="${left}" width="${right}" height="20" fill="${colors[options.status]}"/><rect width="${width}" height="20" fill="url(#${id}-s)"/></g>`,
    '<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">',
    `<text x="${left / 2}" y="14" textLength="${labelWidth}" lengthAdjust="spacingAndGlyphs">${escapeXml(label)}</text>`,
    `<text x="${left + right / 2}" y="14" textLength="${messageWidth}" lengthAdjust="spacingAndGlyphs">${escapeXml(message)}</text>`,
    "</g></svg>",
  ].join("");
}
