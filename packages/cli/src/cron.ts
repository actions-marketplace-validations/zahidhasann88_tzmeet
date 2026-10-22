import { DateTime } from "luxon";
import type { CronExplanation, CronRunNote } from "@tzmeet/core";

export const defaultCronZones = [
  "Asia/Dhaka",
  "UTC",
  "America/New_York",
  "Europe/London",
];

const notes: Record<CronRunNote, string> = {
  "gap-catch-up":
    "late: DST skipped this time, cron runs it right after the change",
  "fold-once": "clocks repeat this time; runs only once",
  "fold-first": "clocks repeat this time; 1st of 2 runs",
  "fold-second": "clocks repeat this time; 2nd of 2 runs",
  "fold-maybe-twice": "clocks repeat this time; may run again",
};

export function formatCron(result: CronExplanation): string {
  const seconds = result.fields.some((field) => field.name === "second");
  const cell = (iso: string) =>
    DateTime.fromISO(iso, { setZone: true })
      .setLocale("en")
      .toFormat(
        seconds ? "ccc d LLL yyyy HH:mm:ss ZZ" : "ccc d LLL yyyy HH:mm ZZ",
      );
  const zones =
    result.runs[0]?.zones
      .filter((zone) => zone.zone !== result.zone)
      .map((zone) => zone.zone) ?? [];
  const lines = [
    `${result.expression}  (${result.dialectName}, runs in ${result.zone})`,
    result.description,
    "",
  ];
  if (result.runs.length) {
    const headers = ["#", `${result.zone} (schedule)`, ...zones, "Note"];
    const rows = result.runs.map((run, index) => [
      String(index + 1),
      cell(run.local),
      ...zones.map((id) =>
        cell(run.zones.find((zone) => zone.zone === id)!.local),
      ),
      run.note ? notes[run.note] : "",
    ]);
    const widths = headers.map((_, i) =>
      Math.max(...[headers, ...rows].map((row) => row[i]!.length)),
    );
    const line = (row: string[]) =>
      row
        .map((value, i) => value.padEnd(widths[i]!))
        .join(" | ")
        .trimEnd();
    lines.push(
      line(headers),
      widths.map((width) => "-".repeat(width)).join("-+-"),
      ...rows.map(line),
      "",
    );
  }
  if (result.skipped.length)
    lines.push(
      "Skipped by DST:",
      ...result.skipped.map(
        (entry) => `  ${entry.scheduled.replace("T", " ")} (${result.zone})`,
      ),
      "",
    );
  if (result.warnings.length)
    lines.push(
      "Warnings:",
      ...result.warnings.map(
        (warning) =>
          `  ${warning.severity === "warning" ? "!" : "i"} ${warning.message}`,
      ),
      "",
    );
  return lines.join("\n");
}
