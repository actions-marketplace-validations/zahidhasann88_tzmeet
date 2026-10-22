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

/** Versioned, percent-encoded JSON preserves zone ordering and every input/view setting. */
export function encodeState(state: WebState): string {
  return new URLSearchParams({
    state: JSON.stringify(parseState(state)),
  }).toString();
}
export function decodeState(search: string): WebState | null {
  const raw = new URLSearchParams(search).get("state");
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
