import { DateTime } from "luxon";
import { z } from "zod";
import {
  findSlotsSchema,
  prayerSchema,
  validateInput,
  zoneSchema,
  type NormalizedInput,
} from "@tzmeet/core";

export const STORAGE_KEY = "tzmeet:state:v1";
const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => DateTime.fromISO(value, { zone: "UTC" }).isValid);
export const stateSchema = z
  .object({
    v: z.literal(1),
    input: findSlotsSchema,
    prayerDraft: prayerSchema,
    theme: z.enum(["light", "dark"]),
    day: civilDate,
    selected: z.string().nullable(),
    expanded: z.string().nullable(),
    panels: z.array(z.string()).max(20),
    shown: z.number().int().min(10).max(1000),
    customDuration: z.boolean(),
  })
  .strict();
export type WebState = z.output<typeof stateSchema>;

export function friendlyName(id: string): string {
  return id === "UTC" ? "UTC" : id.split("/").at(-1)!.replaceAll("_", " ");
}

export function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? [...words[0]!].slice(0, 1).concat([...words[1]!].slice(0, 1))
      : [...(words[0] ?? "")].slice(0, 2);
  return letters.join("").toUpperCase();
}

/** New zone with core defaults, including the regional weekend (e.g. Fri/Sat for Dhaka). */
export function regionalZone(id: string): NormalizedInput["zones"][number] {
  return zoneSchema.parse({ id, label: friendlyName(id) });
}

export function defaultState(): WebState {
  const date = DateTime.now().setZone("Asia/Dhaka").toISODate()!;
  return stateSchema.parse({
    v: 1,
    input: {
      zones: ["Asia/Dhaka", "Europe/London", "America/New_York"].map(
        regionalZone,
      ),
      startDate: date,
    },
    prayerDraft: { location: "Dhaka", method: "Karachi", bufferMinutes: 10 },
    theme: "light",
    day: date,
    selected: null,
    expanded: null,
    panels: [],
    shown: 10,
    customDuration: false,
  });
}

export function parseState(value: unknown): WebState {
  const result = stateSchema.parse(value);
  const input = validateInput(result.input);
  if (!input.success)
    throw new Error(input.errors.map((issue) => issue.message).join("; "));
  return { ...result, input: input.data };
}

type Zone = NormalizedInput["zones"][number];
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const viewDefaults = {
  theme: "light",
  selected: null,
  expanded: null,
  panels: [],
  shown: 10,
  customDuration: false,
} as const;
const inputDefaults = {
  days: 5,
  durationMinutes: 30,
  stepMinutes: 15,
} as const;
const prayerDefault = {
  location: "Dhaka",
  method: "Karachi",
  bufferMinutes: 10,
};

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function fromBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

/** A zone as just its id when it matches the defaults, else only the fields that differ. */
function compactZone(zone: Zone): string | Record<string, unknown> {
  const base = regionalZone(zone.id) as Record<string, unknown>;
  const changed = Object.fromEntries(
    Object.entries(zone).filter(
      ([key, value]) =>
        key !== "id" && value !== undefined && !same(value, base[key]),
    ),
  );
  return Object.keys(changed).length ? { id: zone.id, ...changed } : zone.id;
}

/**
 * Version 2 share format: settings that differ from the defaults, as base64url JSON in
 * `?s=`. Much shorter than the full state; zone order and every setting still round-trip.
 */
function compactState(state: WebState): Record<string, unknown> {
  const { zones, startDate, ...rest } = state.input;
  const input: Record<string, unknown> = {
    zones: zones.map(compactZone),
    startDate,
  };
  for (const [key, value] of Object.entries(rest))
    if (
      value !== undefined &&
      !same(value, inputDefaults[key as keyof typeof inputDefaults])
    )
      input[key] = value;
  const view = Object.fromEntries(
    Object.entries(viewDefaults)
      .filter(([key, value]) => !same(state[key as keyof WebState], value))
      .map(([key]) => [key, state[key as keyof WebState]]),
  );
  return {
    v: 2,
    input,
    ...view,
    ...(same(state.prayerDraft, prayerDefault)
      ? {}
      : { prayerDraft: state.prayerDraft }),
    ...(state.day === state.input.startDate ? {} : { day: state.day }),
  };
}
function expandState(value: unknown): unknown {
  if (!value || typeof value !== "object" || (value as { v?: unknown }).v !== 2)
    throw new Error("Unknown share link version");
  const { input, ...view } = value as {
    v: 2;
    input: { zones: (string | { id: string })[]; startDate: string } & Record<
      string,
      unknown
    >;
  } & Record<string, unknown>;
  return {
    ...viewDefaults,
    prayerDraft: prayerDefault,
    day: input.startDate,
    ...view,
    v: 1,
    input: {
      ...inputDefaults,
      ...input,
      zones: input.zones.map((zone) =>
        typeof zone === "string"
          ? regionalZone(zone)
          : { ...regionalZone(zone.id), ...zone },
      ),
    },
  };
}

/** Compact `s=` share parameter (see compactState). */
export function encodeState(state: WebState): string {
  return new URLSearchParams({
    s: toBase64Url(JSON.stringify(compactState(parseState(state)))),
  }).toString();
}
/** Reads `?s=` links and older `?state=` (full JSON) links. */
export function decodeState(search: string): WebState | null {
  const params = new URLSearchParams(search);
  const compact = params.get("s");
  if (compact !== null)
    return parseState(
      expandState(JSON.parse(fromBase64Url(compact)) as unknown),
    );
  const raw = params.get("state");
  if (raw === null) return null;
  return parseState(JSON.parse(raw) as unknown);
}

/** URL wins over storage. Storage and URL errors never make the app unusable. */
export function restoreState(
  search: string,
  storage: Pick<Storage, "getItem"> | null,
): { state: WebState; notice: string } {
  try {
    const state = decodeState(search);
    if (state) return { state, notice: "" };
  } catch {
    return {
      state: defaultState(),
      notice:
        "This shared link contains invalid settings. A fresh workspace has been opened.",
    };
  }
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw)
      return { state: parseState(JSON.parse(raw) as unknown), notice: "" };
  } catch {
    /* Private browsing, denied storage, or old/corrupt settings: use defaults. */
  }
  return { state: defaultState(), notice: "" };
}

export function persistState(
  state: WebState,
  storage: Pick<Storage, "setItem"> | null,
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(parseState(state)));
  } catch {
    /* Persistence is optional. */
  }
}
