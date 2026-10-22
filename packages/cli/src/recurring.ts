import type { RecurringImpact, RecurringZoneTime } from "@tzmeet/core";

const mark = { ideal: "*", acceptable: "~", blocked: "x" } as const;
const cell = (zone: RecurringZoneTime) =>
  `${zone.localTime}${zone.dayOffset ? ` ${zone.dayOffset > 0 ? "+" : ""}${zone.dayOffset}d` : ""} ${mark[zone.classification]}`;

export function formatRecurring(result: RecurringImpact): string {
  const headers = [
    "Weeks",
    "Count",
    ...result.periods[0]!.zones.map((zone) => `${zone.label} (${zone.id})`),
    "What changed",
  ];
  const rows = result.periods.map((period) => [
    period.weeks === 1 ? period.from : `${period.from} to ${period.to}`,
    String(period.weeks),
    ...period.zones.map(cell),
    period.causes.join("; "),
  ]);
  const widths = headers.map((_, i) =>
    Math.max(...[headers, ...rows].map((row) => row[i]!.length)),
  );
  const line = (row: string[]) =>
    row
      .map((value, i) => value.padEnd(widths[i]!))
      .join(" | ")
      .trimEnd();
  const lines = [
    `Every ${result.weekday} at ${result.time} ${result.anchor} (${result.durationMinutes} min), next ${result.weeks} weeks`,
    `${result.periods.length === 1 ? "Local times stay the same every week." : `Local times change ${result.periods.length - 1} time${result.periods.length === 2 ? "" : "s"}.`} * ideal / ~ acceptable / x blocked`,
    "",
    line(headers),
    widths.map((width) => "-".repeat(width)).join("-+-"),
    ...rows.map(line),
    "",
  ];
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
