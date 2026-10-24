import { DateTime } from "luxon";
import { defaultWeekend, suggestHolidayPreset } from "@tzmeet/core";
import {
  availabilityGrid,
  defaultMeState,
  meZoneRule,
  parseMeHash,
  type Availability,
  type MeState,
} from "./me-state";
import {
  defaultState,
  encodeState,
  friendlyName,
  fromBase64Url,
  toBase64Url,
  type WebState,
} from "./state";

export interface TeamState {
  name: string;
  people: MeState[];
}

export const TEAM_ROUTE = "#/team";
export const MAX_PEOPLE = 12;
export const isTeamRoute = (hash: string) =>
  hash === TEAM_ROUTE || hash.startsWith(`${TEAM_ROUTE}?`);

export function personName(person: MeState): string {
  return person.name || friendlyName(person.zone);
}

export function defaultTeamState(zone: string): TeamState {
  const other = zone === "Europe/London" ? "America/New_York" : "Europe/London";
  return {
    name: "",
    people: [zone, other].map((id) => ({
      ...defaultMeState(id),
      holidayPreset: suggestHolidayPreset(id),
    })),
  };
}

interface CompactPerson {
  n?: string;
  z: string;
  w?: string;
  d?: string;
  h?: string;
}

function compactPerson(person: MeState): CompactPerson {
  const work = `${person.workStart}-${person.workEnd}`;
  const weekend = person.weekend.join("");
  return {
    ...(person.name ? { n: person.name } : {}),
    z: person.zone,
    ...(work === "09:00-18:00" ? {} : { w: work }),
    ...(weekend === defaultWeekend(person.zone).join("") ? {} : { d: weekend }),
    ...(person.holidayPreset ? { h: person.holidayPreset } : {}),
  };
}

function expandPerson(compact: CompactPerson): MeState | null {
  if (!compact || typeof compact.z !== "string") return null;
  const params = new URLSearchParams();
  if (typeof compact.n === "string") params.set("n", compact.n);
  params.set("z", compact.z);
  if (typeof compact.w === "string") params.set("w", compact.w);
  params.set(
    "d",
    typeof compact.d === "string"
      ? compact.d
      : defaultWeekend(compact.z).join(""),
  );
  if (typeof compact.h === "string") params.set("h", compact.h);
  return parseMeHash(`#/me?${params}`);
}

export function teamHash(state: TeamState): string {
  const value = {
    v: 1,
    ...(state.name ? { t: state.name } : {}),
    p: state.people.map(compactPerson),
  };
  return `${TEAM_ROUTE}?s=${toBase64Url(JSON.stringify(value))}`;
}

export function parseTeamHash(hash: string): TeamState | null {
  if (!isTeamRoute(hash)) return null;
  const encoded = new URLSearchParams(hash.slice(TEAM_ROUTE.length + 1)).get(
    "s",
  );
  if (!encoded) return null;
  try {
    const value = JSON.parse(fromBase64Url(encoded)) as {
      v?: unknown;
      t?: unknown;
      p?: unknown;
    };
    if (value.v !== 1 || !Array.isArray(value.p)) return null;
    if (!value.p.length || value.p.length > MAX_PEOPLE) return null;
    const people = (value.p as CompactPerson[]).map(expandPerson);
    if (people.some((person) => !person)) return null;
    return {
      name: typeof value.t === "string" ? value.t.slice(0, 60) : "",
      people: people as MeState[],
    };
  } catch {
    return null;
  }
}

export function teamShareLink(state: TeamState, href: string): string {
  return `${new URL("team/", href.split(/[?#]/)[0]).href}#${teamHash(state).split("?")[1]}`;
}

/** A person from a My hours link (the /me/ page or the #/me route), or null. */
export function personFromMeLink(text: string): MeState | null {
  try {
    const url = new URL(text.trim());
    if (url.pathname.endsWith("/me/") && url.hash.length > 1)
      return parseMeHash(`#/me?${url.hash.slice(1)}`);
    return parseMeHash(url.hash);
  } catch {
    return null;
  }
}

export interface TeamRow {
  date: string;
  label: string;
  people: Availability[][];
  working: number[];
}

export function teamGrid(
  state: TeamState,
  viewerZone: string,
  now: Date,
  days = 7,
): TeamRow[] {
  const grids = state.people.map((person) =>
    availabilityGrid(person, viewerZone, now, days),
  );
  return grids[0]!.map((row, index) => {
    const people = grids.map((grid) => grid[index]!.cells);
    return {
      date: row.date,
      label: row.label,
      people,
      working: row.cells.map(
        (_, cell) => people.filter((cells) => cells[cell] === "work").length,
      ),
    };
  });
}

export interface SharedWindow {
  start: string;
  end: string;
  people: string[];
}

export function bestSharedHours(
  state: TeamState,
  viewerZone: string,
  now: Date,
  limit = 5,
): {
  count: number;
  total: number;
  everyone: boolean;
  windows: SharedWindow[];
} {
  const rows = teamGrid(state, viewerZone, now);
  const first = DateTime.fromJSDate(now, { zone: viewerZone }).startOf("day");
  const cells = rows.flatMap((row, day) =>
    row.working.map((count, cell) => {
      const start = first
        .plus({ days: day })
        .set({ hour: Math.floor(cell / 2), minute: (cell % 2) * 30 });
      return {
        start,
        end: start.plus({ minutes: 30 }),
        count,
        who: row.people
          .map((cells, person) => (cells[cell] === "work" ? person : -1))
          .filter((person) => person >= 0)
          .join(","),
      };
    }),
  );
  const upcoming = cells.filter((cell) => cell.end.toMillis() > now.getTime());
  const count = Math.max(0, ...upcoming.map((cell) => cell.count));
  const total = state.people.length;
  if (!count) return { count, total, everyone: false, windows: [] };
  const windows: { start: DateTime; end: DateTime; who: string }[] = [];
  for (const cell of upcoming) {
    const last = windows.at(-1);
    if (cell.count !== count) continue;
    if (last && last.end.equals(cell.start) && last.who === cell.who)
      last.end = cell.end;
    else windows.push({ start: cell.start, end: cell.end, who: cell.who });
  }
  return {
    count,
    total,
    everyone: count === total,
    windows: windows
      .sort(
        (a, b) =>
          b.end.diff(b.start).toMillis() - a.end.diff(a.start).toMillis() ||
          a.start.toMillis() - b.start.toMillis(),
      )
      .slice(0, limit)
      .sort((a, b) => a.start.toMillis() - b.start.toMillis())
      .map((window) => ({
        start: window.start.toISO()!,
        end: window.end.toISO()!,
        people: window.who
          .split(",")
          .map((person) => personName(state.people[Number(person)]!)),
      })),
  };
}

const shift = (time: string, minutes: number) =>
  DateTime.fromFormat(time, "HH:mm", { zone: "UTC" })
    .plus({ minutes })
    .toFormat("HH:mm");

export function teamMeetState(state: TeamState, now: Date): WebState {
  const groups = new Map<string, MeState[]>();
  for (const person of state.people)
    groups.set(person.zone, [...(groups.get(person.zone) ?? []), person]);
  const zones = [...groups.values()].map((people) => {
    const rule = meZoneRule(people[0]!);
    if (people.length === 1) return rule;
    const label = people.map(personName).join(", ").slice(0, 80);
    const weekend = [
      ...new Set(people.flatMap((person) => person.weekend)),
    ].sort();
    const daytime = people.every((person) => person.workStart < person.workEnd);
    const start = people
      .map((person) => person.workStart)
      .sort()
      .at(-1)!;
    const end = people.map((person) => person.workEnd).sort()[0]!;
    return {
      ...rule,
      label,
      weekend,
      ...(daytime && start < end
        ? {
            workStart: start,
            workEnd: end,
            quietBefore: shift(start, -60),
            quietAfter: shift(end, 60),
          }
        : {}),
    };
  });
  const base = defaultState();
  const startDate = DateTime.fromJSDate(now, {
    zone: state.people[0]!.zone,
  }).toISODate()!;
  return {
    ...base,
    input: {
      ...base.input,
      zones: zones as WebState["input"]["zones"],
      startDate,
    },
    day: startDate,
  };
}

export function findMeetingLink(
  state: TeamState,
  href: string,
  now: Date,
): string | null {
  try {
    return `${href.split(/[?#]/)[0]}?${encodeState(teamMeetState(state, now))}`;
  } catch {
    return null;
  }
}
