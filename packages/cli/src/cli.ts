import { Command, CommanderError } from "commander";
import {
  explainCron,
  findSlots,
  listTimeZones,
  parseIntegerOption,
  recurringImpact,
  type CronDialect,
} from "@tzmeet/core";
import { readConfig, resolveOptions, type CliFlags } from "./config.js";
import { formatTable, selectTop } from "./output.js";
import { defaultCronZones, formatCron } from "./cron.js";
import { formatRecurring } from "./recurring.js";

export interface CliContext {
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  now?: () => Date;
}

const collect = (value: string, previous: string[] = []): string[] => [
  ...previous,
  value,
];

export function runCLI(
  args: string[] = process.argv.slice(2),
  context: CliContext = {},
): number {
  const writeOut =
    context.stdout ??
    ((text) => {
      process.stdout.write(text);
    });
  const writeErr =
    context.stderr ??
    ((text) => {
      process.stderr.write(text);
    });
  const program = new Command();
  program
    .name("tzmeet")
    .version("0.2.0")
    .description(
      "Find humane meeting slots across IANA time zones. No backend or calendar upload.",
    )
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({ writeOut, writeErr })
    .showHelpAfterError("(Run tzmeet --help for usage.)")
    .option(
      "--zones <ids>",
      "comma-separated IANA zones; the first zone anchors the date range",
    )
    .option(
      "--date <YYYY-MM-DD>",
      "first-zone start date (default: today in that zone)",
    )
    .option("--duration <minutes>", "meeting length (default: 30)")
    .option("--days <count>", "calendar-day range, 1-31 (default: 5)")
    .option("--step <minutes>", "UTC scan step (default: 15)")
    .option(
      "--work <HH:mm-HH:mm>",
      "override work hours in every zone (default: 09:00-18:00)",
    )
    .option(
      "--zone-work <IANA_ZONE=HH:mm-HH:mm>",
      "per-zone work override; repeatable",
      collect,
    )
    .option(
      "--weekend <IANA_ZONE=days>",
      "per-zone weekend, e.g. Asia/Dhaka=fri,sat; repeatable",
      collect,
    )
    .option(
      "--holiday <IANA_ZONE=dates>",
      "per-zone holiday dates, e.g. Asia/Dhaka=2026-12-16,2026-12-25; repeatable",
      collect,
    )
    .option(
      "--holiday-preset <IANA_ZONE=preset>",
      "per-zone public holidays: BD, GB-ENG, US or none, e.g. Asia/Dhaka=BD; repeatable",
      collect,
    )
    .option(
      "--quiet <HH:mm-HH:mm>",
      "override allowed hours in every zone (default: 08:00-21:00)",
    )
    .option(
      "--prayer-buffer <minutes>",
      "symmetric prayer buffer (default when enabled: 10)",
    )
    .option(
      "--prayer-location <city-or-lat,lng>",
      "enable prayers using a built-in city or coordinates",
    )
    .option(
      "--prayer-method <method>",
      "adhan method (default when enabled: Karachi; MWL supported)",
    )
    .option("--top <count>", "limit results, 1-1000 (default: 10)")
    .option(
      "--config <path>",
      "JSON config (default: ./tzmeet.config.json, if present)",
    )
    .option(
      "--json",
      "print capped slots, UTC range, full diagnostics, and totalSlots as JSON",
    )
    .addHelpText(
      "after",
      `
Examples:
  tzmeet --zones Asia/Dhaka,America/New_York,Europe/London --date 2026-11-02 --duration 30
  tzmeet --zones Asia/Dhaka,Europe/London --weekend Asia/Dhaka=fri,sat --json
  tzmeet --config team.json --zone-work America/New_York=08:00-17:00
  tzmeet --zones Asia/Dhaka,Europe/London --holiday-preset Asia/Dhaka=BD --holiday-preset Europe/London=GB-ENG
  tzmeet zones london
  tzmeet cron "30 2 * * *" --zone America/New_York
  tzmeet recurring --zones Europe/London,America/New_York,Asia/Dhaka --date 2026-10-12 --time 14:00

Precedence: config/defaults < global flags < per-zone flags.
Default weekend is Sat/Sun, or Fri/Sat for Dhaka and other Fri/Sat countries.
Prayer locations: Dhaka, London, New York, Karachi, Makkah, Dubai, Singapore.
No slots found is a successful search (exit 0); invalid input exits 1.
`,
    )
    .action(() => {
      const flags = program.opts<CliFlags>();
      const config = readConfig(context.cwd ?? process.cwd(), flags.config);
      const { input, top } = resolveOptions(
        config,
        flags,
        context.now?.() ?? new Date(),
      );
      const result = selectTop(findSlots(input), top);
      writeOut(
        flags.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : formatTable(result, input),
      );
    });
  program
    .command("zones [search]")
    .description(
      "Search runtime IANA identifiers (case-insensitive); no search lists all",
    )
    .allowExcessArguments(false)
    .action((search: string | undefined) => {
      const zones = listTimeZones(search);
      const json = program.opts<CliFlags>().json;
      writeOut(
        json
          ? `${JSON.stringify(zones, null, 2)}\n`
          : zones.length
            ? `${zones.join("\n")}\n`
            : `No time zones matched ${JSON.stringify(search)}.\n`,
      );
    });
  program
    .command("cron <expression...>")
    .description(
      "Explain a Unix, Kubernetes, Spring or Quartz cron expression: next runs across zones and DST warnings",
    )
    .option(
      "--dialect <name>",
      "unix, kubernetes, spring or quartz (default: detected from the expression)",
    )
    .option("--zone <id>", "zone the schedule runs in (default: UTC)")
    .option(
      "--display <ids>",
      `comma-separated zones to show runs in (default: ${defaultCronZones.join(",")})`,
    )
    .option("--count <n>", "number of runs to list, 1-100 (default: 10)")
    .option("--from <iso>", "list runs after this instant (default: now)")
    .addHelpText(
      "after",
      `
Quote the expression so the shell doesn't expand *:
  tzmeet cron "30 2 * * *" --zone America/New_York
  tzmeet cron "0 0 9 ? * MON-FRI" --dialect quartz --zone Asia/Dhaka
  tzmeet cron "0 1 * * *" --dialect kubernetes --zone Europe/London --json
`,
    )
    .action(
      (
        parts: string[],
        options: {
          dialect?: string;
          zone?: string;
          display?: string;
          count?: string;
          from?: string;
        },
      ) => {
        const result = explainCron({
          expression: parts.join(" "),
          ...(options.dialect
            ? { dialect: options.dialect as CronDialect }
            : {}),
          ...(options.zone ? { zone: options.zone } : {}),
          displayZones: options.display
            ? options.display
                .split(",")
                .map((id) => id.trim())
                .filter(Boolean)
            : defaultCronZones,
          count: parseIntegerOption(options.count, "count", 10),
          from: options.from ?? (context.now?.() ?? new Date()).toISOString(),
        });
        writeOut(
          program.opts<CliFlags>().json
            ? `${JSON.stringify(result, null, 2)}
`
            : formatCron(result),
        );
      },
    );
  program
    .command("recurring")
    .description(
      "Follow a weekly meeting through DST changes: local times per zone, week by week",
    )
    .requiredOption("--time <HH:mm>", "meeting time in the first zone")
    .option("--weeks <count>", "how many weeks to check, 1-104 (default: 26)")
    .addHelpText(
      "after",
      `
The meeting repeats every week on the weekday of --date, at --time in the first zone.
Zone flags (--zones, --date, --duration, --work, --zone-work, --weekend, --holiday, --holiday-preset,
--quiet, --prayer-*, --config) work the same as for the main search.
  tzmeet recurring --zones Europe/London,America/New_York,Asia/Dhaka --date 2026-10-12 --time 14:00
  tzmeet recurring --zones America/New_York,Asia/Dhaka --time 09:00 --weeks 52 --json
`,
    )
    .action((options: { time: string; weeks?: string }) => {
      const flags = program.opts<CliFlags>();
      const config = readConfig(context.cwd ?? process.cwd(), flags.config);
      const { input } = resolveOptions(config, flags, context.now?.() ?? new Date());
      const result = recurringImpact({
        zones: input.zones,
        startDate: input.startDate,
        durationMinutes: input.durationMinutes,
        ...(input.prayer ? { prayer: input.prayer } : {}),
        time: options.time,
        weeks: parseIntegerOption(options.weeks, "weeks", 26),
      });
      writeOut(flags.json ? `${JSON.stringify(result, null, 2)}
` : formatRecurring(result));
    });
  try {
    program.parse(args, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 1;
    writeErr(
      `tzmeet: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
