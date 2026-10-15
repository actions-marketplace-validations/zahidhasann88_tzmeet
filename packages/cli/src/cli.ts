import { Command, CommanderError } from 'commander';
import { findSlots, listTimeZones } from '@tzmeet/core';
import { readConfig, resolveOptions, type CliFlags } from './config.js';
import { formatTable, selectTop } from './output.js';

export interface CliContext {
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Injectable clock for date defaults; never used by the shared core. */
  now?: () => Date;
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

/** Run the CLI without forcing process exit. Errors/help are testable with injected I/O. */
export function runCLI(args: string[] = process.argv.slice(2), context: CliContext = {}): number {
  const writeOut = context.stdout ?? (text => { process.stdout.write(text); });
  const writeErr = context.stderr ?? (text => { process.stderr.write(text); });
  const program = new Command();
  program
    .name('tzmeet')
    .version('0.1.0')
    .description('Find humane meeting slots across IANA time zones. No backend or calendar upload.')
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({ writeOut, writeErr })
    .showHelpAfterError('(Run tzmeet --help for usage.)')
    .option('--zones <ids>', 'comma-separated IANA zones; the first zone anchors the date range')
    .option('--date <YYYY-MM-DD>', 'first-zone start date (default: today in that zone)')
    .option('--duration <minutes>', 'meeting length (default: 30)')
    .option('--days <count>', 'calendar-day range, 1-31 (default: 5)')
    .option('--step <minutes>', 'UTC scan step (default: 15)')
    .option('--work <HH:mm-HH:mm>', 'override work hours in every zone (default: 09:00-18:00)')
    .option('--zone-work <IANA_ZONE=HH:mm-HH:mm>', 'per-zone work override; repeatable', collect)
    .option('--weekend <IANA_ZONE=days>', 'per-zone weekend, e.g. Asia/Dhaka=fri,sat; repeatable', collect)
    .option('--quiet <HH:mm-HH:mm>', 'override allowed hours in every zone (default: 08:00-21:00)')
    .option('--prayer-buffer <minutes>', 'symmetric prayer buffer (default when enabled: 10)')
    .option('--prayer-location <city-or-lat,lng>', 'enable prayers using a built-in city or coordinates')
    .option('--prayer-method <method>', 'adhan method (default when enabled: Karachi; MWL supported)')
    .option('--top <count>', 'limit results, 1-1000 (default: 10)')
    .option('--config <path>', 'JSON config (default: ./tzmeet.config.json, if present)')
    .option('--json', 'print capped slots, UTC range, full diagnostics, and totalSlots as JSON')
    .addHelpText('after', `
Examples:
  tzmeet --zones Asia/Dhaka,America/New_York,Europe/London --date 2026-11-02 --duration 30
  tzmeet --zones Asia/Dhaka,Europe/London --weekend Asia/Dhaka=fri,sat --json
  tzmeet --config team.json --zone-work America/New_York=08:00-17:00
  tzmeet zones london

Precedence: config/defaults < global flags < per-zone flags.
Default weekend is Sat/Sun, or Fri/Sat for Dhaka, Riyadh, Qatar, Kuwait, Bahrain, Jerusalem.
Prayer locations: Dhaka, London, New York, Karachi, Makkah, Dubai, Singapore.
No slots found is a successful search (exit 0); invalid input exits 1.
`)
    .action(() => {
      const flags = program.opts<CliFlags>();
      const config = readConfig(context.cwd ?? process.cwd(), flags.config);
      const { input, top } = resolveOptions(config, flags, context.now?.() ?? new Date());
      const result = selectTop(findSlots(input), top);
      writeOut(flags.json ? `${JSON.stringify(result, null, 2)}\n` : formatTable(result, input));
    });
  program.command('zones [search]')
    .description('Search runtime IANA identifiers (case-insensitive); no search lists all')
    .allowExcessArguments(false)
    .action((search: string | undefined) => {
      const zones = listTimeZones(search);
      const json = program.opts<CliFlags>().json;
      writeOut(json ? `${JSON.stringify(zones, null, 2)}\n` : zones.length ? `${zones.join('\n')}\n` : `No time zones matched ${JSON.stringify(search)}.\n`);
    });
  try {
    program.parse(args, { from: 'user' });
    return 0;
  } catch (error) {
    // Commander has already written its own errors/help/version to the configured I/O.
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 1;
    writeErr(`tzmeet: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
