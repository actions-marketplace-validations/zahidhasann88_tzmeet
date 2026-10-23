import { DateTime } from "luxon";
import type { FindSlotsResult, Slot } from "./types.js";

export interface RotationPick {
  time: string;
  slot: Slot;
  inconvenient: string[];
}
export interface FairRotation {
  size: number;
  picks: RotationPick[];
  zones: { id: string; label: string; inconvenientTurns: number }[];
  message: string;
}

const maxCandidates = 40;

export function fairRotation(
  result: FindSlotsResult,
  options: { size?: 2 | 3 } = {},
): FairRotation | null {
  const size = options.size ?? 2;
  if (!result.slots.length) return null;
  const timeOf = (slot: Slot) =>
    DateTime.fromISO(slot.zones[0]!.localStart, { setZone: true }).toFormat(
      "HH:mm",
    );
  const candidates: { time: string; slot: Slot; burden: number[] }[] = [];
  const seen = new Set<string>();
  for (const slot of result.slots) {
    const time = timeOf(slot);
    if (seen.has(time)) continue;
    seen.add(time);
    candidates.push({
      time,
      slot,
      burden: slot.zones.map((zone) =>
        zone.optional || zone.classification === "ideal" ? 0 : 1,
      ),
    });
    if (candidates.length === maxCandidates) break;
  }
  const zones = result.slots[0]!.zones.map((zone) => ({
    id: zone.id,
    label: zone.label,
  }));
  const pick = (candidate: (typeof candidates)[number]): RotationPick => ({
    time: candidate.time,
    slot: candidate.slot,
    inconvenient: zones
      .filter((_, index) => candidate.burden[index])
      .map((zone) => zone.label),
  });
  const best = candidates[0]!;
  const anchor = zones[0]!.label;
  const single = (message: string): FairRotation => ({
    size: 1,
    picks: [pick(best)],
    zones: zones.map((zone, index) => ({
      ...zone,
      inconvenientTurns: best.burden[index]!,
    })),
    message,
  });
  if (best.burden.every((value) => value === 0))
    return single(
      `${best.time} ${anchor} is inside work hours for everyone, so there's no need to rotate.`,
    );
  if (candidates.length < size)
    return single(
      `There aren't enough different times to rotate between, so ${best.time} ${anchor} is the best single time.`,
    );

  const better = (x: number[], y: number[]) => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! < y[i]!;
    return false;
  };
  let chosen: number[] = [];
  let bestKey: number[] | null = null;
  const consider = (indices: number[]) => {
    const totals = zones.map((_, zone) =>
      indices.reduce((sum, index) => sum + candidates[index]!.burden[zone]!, 0),
    );
    const key = [
      Math.max(...totals),
      totals.reduce((x, y) => x + y, 0),
      indices.reduce((x, y) => x + y, 0),
    ];
    if (!bestKey || better(key, bestKey)) {
      bestKey = key;
      chosen = indices;
    }
  };
  for (let a = 0; a < candidates.length; a++)
    for (let b = a + 1; b < candidates.length; b++) {
      if (size === 2) consider([a, b]);
      else for (let c = b + 1; c < candidates.length; c++) consider([a, b, c]);
    }

  const picks = chosen.map((index) => candidates[index]!);
  const turns = zones.map((zone, index) => ({
    ...zone,
    inconvenientTurns: picks.reduce(
      (sum, candidate) => sum + candidate.burden[index]!,
      0,
    ),
  }));
  const helped = turns.filter(
    (zone, index) => zone.inconvenientTurns < best.burden[index]! * size,
  );
  const shared = turns
    .filter((zone) => zone.inconvenientTurns > 0)
    .map((zone) => `${zone.label} ${zone.inconvenientTurns} of ${size}`);
  if (!helped.length)
    return single(
      `Rotating doesn't spread the load better than always meeting at ${best.time} ${anchor}.`,
    );
  const message = `Alternate ${picks.map((candidate) => candidate.time).join(", ")} ${anchor} week by week. Inconvenient weeks: ${shared.join(", ")}, instead of ${helped.map((zone) => zone.label).join(" and ")} every week.`;
  return { size, picks: picks.map(pick), zones: turns, message };
}
