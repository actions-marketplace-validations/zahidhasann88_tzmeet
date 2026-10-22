import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DateTime } from "luxon";
import { parseIcsBusy, type NormalizedInput } from "@tzmeet/core";

export function applyBusy(
  input: NormalizedInput,
  flags: readonly string[] | undefined,
  cwd: string,
  days: number,
  warn: (text: string) => void,
): NormalizedInput {
  if (!flags?.length) return input;
  const anchor = input.zones[0]!.id;
  const from = DateTime.fromISO(input.startDate, { zone: anchor }).minus({
    days: 1,
  });
  const to = from.plus({ days: days + 2 });
  const zones = input.zones.map((zone) => ({ ...zone }));
  for (const flag of flags) {
    const match = /^([^=]+)=(.+)$/.exec(flag);
    if (!match)
      throw new Error(
        `--busy must use IANA_ZONE=calendar.ics, received ${JSON.stringify(flag)}`,
      );
    const id = match[1]!.trim();
    const zone = zones.find((candidate) => candidate.id === id);
    if (!zone)
      throw new Error(
        `--busy: ${id} is not a selected zone; add it with --zones first`,
      );
    const path = resolve(cwd, match[2]!.trim());
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      throw new Error(
        `Cannot read calendar ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const result = parseIcsBusy(text, {
      from: from.toUTC().toISO()!,
      to: to.toUTC().toISO()!,
      defaultZone: id,
    });
    for (const warning of result.warnings)
      warn(`tzmeet: ${match[2]!.trim()}: ${warning}\n`);
    zone.busy = [...(zone.busy ?? []), ...result.busy];
  }
  return { ...input, zones };
}
