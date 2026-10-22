import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';
import { configSchema, parseScheduleInput, parseIntegerOption, type NormalizedInput } from '@tzmeet/core';

/** Raw commander flags. No commander defaults: absent flags must not overwrite config. */
export interface CliFlags {
  zones?: string;
  date?: string;
  duration?: string;
  days?: string;
  step?: string;
  work?: string;
  zoneWork?: string[];
  weekend?: string[];
  holiday?: string[];
  holidayPreset?: string[];
  busy?: string[];
  specialHours?: string[];
  ramadan?: string[];
  rotation?: string;
  optional?: string[];
  quiet?: string;
  prayerBuffer?: string;
  prayerLocation?: string;
  prayerMethod?: string;
  top?: string;
  config?: string;
  json?: boolean;
}

/** Read only cwd/tzmeet.config.json, or an explicitly requested path. */
export function readConfig(cwd: string, explicitPath?: string): unknown {
  const path = resolve(cwd, explicitPath ?? 'tzmeet.config.json');
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    if (!explicitPath && (error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    // Accept a UTF-8 BOM, but not comments or trailing commas.
    return JSON.parse(source.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    throw new Error(`Invalid JSON in config ${path}; use strict JSON without comments or trailing commas`);
  }
}

/** Config/defaults < global flags < per-zone flags. Parsing is shared with core/API. */
export function resolveOptions(config: unknown, flags: CliFlags, now: Date = new Date()): { input: NormalizedInput; top: number } {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) throw new Error(`Invalid config: ${parsed.error.issues.map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`).join('; ')}`);
  const defaults = parsed.data;
  const firstZone = flags.zones?.split(',')[0]?.trim() ?? defaults.zones?.[0]?.id ?? 'UTC';
  const date = flags.date ?? defaults.startDate ?? DateTime.fromJSDate(now, { zone: firstZone }).toISODate() ?? '';
  const input = parseScheduleInput({ ...flags, date }, defaults);
  const top = parseIntegerOption(flags.top, 'top', defaults.top);
  if (top < 1 || top > 1000) throw new Error('--top must be between 1 and 1000');
  return { input, top };
}
