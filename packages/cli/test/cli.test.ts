import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configSchema, type FindSlotsResult } from '@tzmeet/core';
import { runCLI } from '../src/cli.js';
import { readConfig, resolveOptions, type CliFlags } from '../src/config.js';
import { formatTable, type CliResult } from '../src/output.js';

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'tzmeet-cli-')); });
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

function invoke(args: string[], directory = cwd) {
  let stdout = '';
  let stderr = '';
  const code = runCLI(args, {
    cwd: directory,
    stdout: text => { stdout += text; },
    stderr: text => { stderr += text; },
    now: () => new Date('2026-11-01T20:00:00Z')
  });
  return { code, stdout, stderr };
}
function configFile(config: unknown, filename = 'tzmeet.config.json') {
  const path = join(cwd, filename);
  writeFileSync(path, JSON.stringify(config));
  return path;
}
function json(args: string[]) {
  const output = invoke([...args, '--json']);
  expect(output.code, output.stderr).toBe(0);
  expect(output.stderr).toBe('');
  return JSON.parse(output.stdout) as CliResult;
}

const fixedArgs = ['--zones', 'Asia/Dhaka,America/New_York,Europe/London', '--date', '2026-11-02', '--days', '1', '--duration', '30', '--step', '30', '--weekend', 'Asia/Dhaka=fri,sat', '--top', '2'];

describe('fixed CLI output', () => {
  it('snapshots the table with all local dates/offsets and classification markers', () => {
    const output = invoke(fixedArgs);
    expect(output.code).toBe(0);
    expect(output.stderr).toBe('');
    expect(output.stdout).toMatchSnapshot();
  });

  it('snapshots JSON with the same ranked, top-capped data', () => {
    const result = json(fixedArgs);
    expect(result).toMatchSnapshot();
    expect(result.slots).toHaveLength(2);
    expect(result.totalSlots).toBeGreaterThan(2);
    expect(result.diagnostics.scannedCandidates).toBe(48);
  });

  it('makes table and JSON refer to the same first result', () => {
    const result = json(fixedArgs);
    const table = invoke(fixedArgs).stdout;
    expect(table).toContain(result.slots[0]!.reason);
    expect(table).toContain(result.slots[0]!.date);
  });
});

describe('configuration discovery and precedence', () => {
  it('discovers a validated config in cwd when no flags are supplied', () => {
    configFile({ zones: [{ id: 'UTC', label: 'Home', weekend: [] }], startDate: '2026-11-02', days: 1, durationMinutes: 45, stepMinutes: 30, top: 1 });
    const result = json([]);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]!.zones[0]!.label).toBe('Home');
    expect(Date.parse(result.slots[0]!.end) - Date.parse(result.slots[0]!.start)).toBe(45 * 60000);
  });

  it('honors an explicit relative or absolute config path instead of auto-discovery', () => {
    configFile({ invalid: 'must not load this file' });
    const explicit = configFile({ zones: [{ id: 'UTC' }], startDate: '2026-11-02', top: 1 }, 'team.json');
    expect(json(['--config', 'team.json']).slots).toHaveLength(1);
    expect(json(['--config', explicit]).slots).toHaveLength(1);
  });

  it('merges flags over config, retaining matching-zone settings and ordering', () => {
    const original = {
      zones: [
        { id: 'Asia/Dhaka', label: 'HQ', weekend: [5, 6], workStart: '10:00', workEnd: '16:00' },
        { id: 'America/New_York', workStart: '10:00', workEnd: '16:00' },
        { id: 'Europe/London' }
      ],
      startDate: '2026-10-26', days: 3, durationMinutes: 60, stepMinutes: 60, top: 3,
      prayer: { location: 'Dhaka', method: 'MWL', bufferMinutes: 20 }
    };
    const snapshot = structuredClone(original);
    const flags: CliFlags = {
      zones: 'America/New_York,Asia/Dhaka', date: '2026-11-02', days: '2', duration: '15', step: '15', top: '1',
      work: '09:00-18:00', zoneWork: ['America/New_York=08:00-17:00'],
      quiet: '07:00-22:00', weekend: ['Asia/Dhaka=sun'],
      prayerMethod: 'Karachi', prayerBuffer: '5'
    };
    const resolved = resolveOptions(original, flags);
    expect(resolved).toMatchObject({ top: 1, input: {
      startDate: '2026-11-02', days: 2, durationMinutes: 15, stepMinutes: 15,
      prayer: { location: 'Dhaka', method: 'Karachi', bufferMinutes: 5 }
    } });
    expect(resolved.input.zones.map(zone => zone.id)).toEqual(['America/New_York', 'Asia/Dhaka']);
    expect(resolved.input.zones[0]).toMatchObject({ workStart: '08:00', workEnd: '17:00', quietBefore: '07:00', quietAfter: '22:00' });
    expect(resolved.input.zones[1]).toMatchObject({ label: 'HQ', workStart: '09:00', workEnd: '18:00', weekend: [7] });
    expect(original).toEqual(snapshot);
  });

  it('tests precedence through actual CLI flags as well as the resolver', () => {
    configFile({ zones: [{ id: 'UTC' }], startDate: '2026-10-26', days: 5, durationMinutes: 60, top: 8 });
    const result = json(['--date', '2026-11-02', '--days', '1', '--duration', '15', '--top', '1']);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]!.date).toBe('2026-11-02');
    expect(Date.parse(result.slots[0]!.end) - Date.parse(result.slots[0]!.start)).toBe(15 * 60000);
    expect(result.range.end).toBe('2026-11-03T00:00:00.000Z');
  });

  it('applies per-zone overrides after global flags, regardless of command-line order', () => {
    const flags: CliFlags = { zones: 'UTC,Europe/London', date: '2026-11-02', work: '10:00-16:00', zoneWork: ['UTC=09:00-17:00', 'UTC=08:00-18:00'] };
    const result = resolveOptions({}, flags);
    expect(result.input.zones[0]!.workStart).toBe('08:00');
    expect(result.input.zones[1]!.workStart).toBe('10:00');
    const output = invoke(['--zones', 'UTC', '--date', '2026-11-02', '--zone-work', 'UTC=08:00-17:00', '--work', '10:00-16:00', '--days', '1']);
    expect(output.code).toBe(0);
  });

  it('supports repeatable weekend overrides, including no weekend', () => {
    const resolved = resolveOptions({}, { zones: 'Asia/Dhaka,UTC', date: '2026-11-02', weekend: ['Asia/Dhaka=fri,sat', 'UTC=none'] });
    expect(resolved.input.zones[0]!.weekend).toEqual([5, 6]);
    expect(resolved.input.zones[1]!.weekend).toEqual([]);
    const last = resolveOptions({}, { zones: 'UTC', date: '2026-11-02', weekend: ['UTC=Friday,Saturday', 'UTC=7'] });
    expect(last.input.zones[0]!.weekend).toEqual([7]);
  });

  it('collects repeated per-zone flags through commander without losing earlier zones', () => {
    const output = invoke([
      '--zones', 'Asia/Dhaka,Europe/London', '--date', '2026-11-02', '--days', '1', '--json',
      '--zone-work', 'Asia/Dhaka=08:00-17:00', '--zone-work', 'Europe/London=10:00-18:00',
      '--weekend', 'Asia/Dhaka=mon', '--weekend', 'Europe/London=none'
    ]);
    expect(output.code).toBe(0);
    const result = JSON.parse(output.stdout) as CliResult;
    expect(result.slots).toEqual([]);
    expect(result.diagnostics.constraints.some(count => count.zoneId === 'Asia/Dhaka' && count.constraint === 'weekend')).toBe(true);
    expect(result.diagnostics.constraints.some(count => count.zoneId === 'Europe/London' && count.constraint === 'weekend')).toBe(false);
  });

  it('validates the checked-in example with the shared schema and executes it', () => {
    const example = JSON.parse(readFileSync(resolve('examples/tzmeet.config.json'), 'utf8')) as unknown;
    expect(configSchema.safeParse(example).success).toBe(true);
    const output = invoke(['--config', resolve('examples/tzmeet.config.json'), '--top', '1', '--json']);
    expect(output.code, output.stderr).toBe(0);
    expect(JSON.parse(output.stdout).slots).toHaveLength(1);
  });

  it('does not silently repair invalid configs with flags', () => {
    configFile({ zones: [{ id: 'Not/AZone' }], startDate: '2026-11-02' });
    const output = invoke(['--zones', 'UTC']);
    expect(output.code).toBe(1);
    expect(output.stderr).toContain('Invalid config');
    expect(output.stderr).toContain('zones.0.id');
  });

  it('accepts a UTF-8 BOM and reports strict-JSON failures', () => {
    writeFileSync(join(cwd, 'tzmeet.config.json'), '\uFEFF{"zones":[{"id":"UTC"}],"startDate":"2026-11-02","top":1}');
    expect(json([]).slots).toHaveLength(1);
    writeFileSync(join(cwd, 'tzmeet.config.json'), '{"zones": [],}');
    expect(invoke([]).stderr).toContain('Invalid JSON');
  });

  it('only auto-discovers in cwd, not parent directories', () => {
    configFile({ zones: [{ id: 'UTC' }], startDate: '2026-11-02' });
    const child = mkdtempSync(join(cwd, 'child-'));
    expect(invoke([], child).code).toBe(1);
    expect(readConfig(child)).toEqual({});
  });

  it('defaults the omitted date to today in the first zone, not the host date', () => {
    const now = new Date('2026-11-01T20:00:00Z');
    expect(resolveOptions({}, { zones: 'Asia/Dhaka' }, now).input.startDate).toBe('2026-11-02');
    expect(resolveOptions({}, { zones: 'America/New_York' }, now).input.startDate).toBe('2026-11-01');
  });
});

describe('prayer CLI options', () => {
  it('enables prayer constraints with a built-in city and defaults', () => {
    const result = json(['--zones', 'Asia/Dhaka', '--date', '2026-11-02', '--days', '1', '--prayer-location', 'Dhaka']);
    expect(result.diagnostics.constraints.some(constraint => constraint.constraint === 'prayer')).toBe(true);
    expect(resolveOptions({}, { zones: 'Asia/Dhaka', date: '2026-11-02', prayerLocation: 'Dhaka' }).input.prayer).toEqual({ location: 'Dhaka', method: 'Karachi', bufferMinutes: 10 });
  });

  it('parses coordinate locations and zero-minute buffers', () => {
    const result = resolveOptions({}, { zones: 'Asia/Dhaka', date: '2026-11-02', prayerLocation: '23.8103,90.4125', prayerMethod: 'MWL', prayerBuffer: '0' });
    expect(result.input.prayer).toEqual({ location: { lat: 23.8103, lng: 90.4125 }, method: 'MWL', bufferMinutes: 0 });
  });

  it('requires a location to enable prayers, but can use a configured location', () => {
    expect(invoke(['--zones', 'UTC', '--prayer-buffer', '5']).stderr).toContain('--prayer-location is required');
    configFile({ zones: [{ id: 'Asia/Dhaka' }], startDate: '2026-11-02', prayer: { location: 'Dhaka' } });
    expect(json(['--prayer-method', 'MWL', '--prayer-buffer', '5']).slots.length).toBeGreaterThan(0);
  });

  it('keeps explicit per-zone prayer rules as overrides of global rules', () => {
    const result = resolveOptions({ zones: [{ id: 'Asia/Dhaka', prayer: { location: 'Dhaka', method: 'MWL', bufferMinutes: 25 } }], startDate: '2026-11-02', prayer: { location: 'London' } }, { prayerBuffer: '5' });
    expect(result.input.prayer!.bufferMinutes).toBe(5);
    expect(result.input.zones[0]!.prayer!.bufferMinutes).toBe(25);
  });
});

describe('errors, help and search', () => {
  it.each([
    [[], 'Select at least one'],
    [['--zones', 'Mars/Olympus', '--date', '2026-11-02'], 'Unknown IANA'],
    [['--zones', 'UTC', '--work', '9:00-18:00'], 'HH:mm-HH:mm'],
    [['--zones', 'UTC', '--work', '09:00-24:00'], 'HH:mm'],
    [['--zones', 'UTC', '--quiet', '10:00-17:00'], 'fit inside'],
    [['--zones', 'UTC', '--date', '2026-02-30'], 'calendar date'],
    [['--zones', 'UTC', '--duration', 'abc'], 'must be an integer'],
    [['--zones', 'UTC', '--duration', '30.5'], 'must be an integer'],
    [['--zones', 'UTC', '--duration', '-30'], 'must be an integer'],
    [['--zones', 'UTC', '--days', '0'], 'greater than'],
    [['--zones', 'UTC', '--step', '0'], 'greater than'],
    [['--zones', 'UTC', '--top', '0'], 'between 1 and 1000'],
    [['--zones', 'UTC', '--top', '1001'], 'between 1 and 1000'],
    [['--zones', 'UTC', '--duration', '99999999999999999'], 'safe integer'],
    [['--zones', 'UTC,UTC'], 'unique'],
    [['--zones', 'UTC,'], 'Unknown IANA'],
    [['--zones', 'UTC', '--zone-work', 'Europe/London=08:00-17:00'], 'not a selected zone'],
    [['--zones', 'UTC', '--zone-work', '08:00-17:00'], 'IANA_ZONE=value'],
    [['--zones', 'UTC', '--weekend', 'UTC=funday'], 'Unknown weekend day'],
    [['--zones', 'UTC', '--weekend', 'UTC=sat,sat'], 'unique'],
    [['--zones', 'UTC', '--prayer-location', 'Atlantis'], 'prayer.location'],
    [['--zones', 'UTC', '--prayer-location', 'Dhaka', '--prayer-method', 'Bogus'], 'prayer.method'],
    [['--zones', 'UTC', '--prayer-location', '90.1,0'], '90'],
    [['--zones', 'UTC', '--prayer-location', 'bad,coords'], 'latitude,longitude'],
    [['--config', 'missing.json'], 'Cannot read config'],
    [['--unknown'], 'unknown option'],
    [['--zones'], 'argument missing'],
    [['stray'], 'too many arguments']
  ])('exits 1 for %j without writing success output', (args, message) => {
    const result = invoke(args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
  });

  it('rejects unknown config fields through the shared schema', () => {
    configFile({ zones: [{ id: 'UTC' }], startDate: '2026-11-02', stray: true });
    expect(invoke([]).stderr).toContain('Invalid config');
    expect(configSchema.safeParse({ stray: true }).success).toBe(false);
  });

  it('prints help/version with exit code 0 and no errors', () => {
    expect(invoke(['--help']).code).toBe(0);
    expect(invoke(['--help']).stdout).toContain('--zone-work');
    expect(invoke(['--help']).stderr).toBe('');
    expect(invoke(['--version']).stdout).toBe('0.1.0\n');
  });

  it('searches zone names without needing a config or meeting input', () => {
    configFile({ invalid: true });
    expect(invoke(['zones', 'london'])).toEqual({ code: 0, stdout: 'Europe/London\n', stderr: '' });
    expect(invoke(['zones', 'NEW_YORK']).stdout).toBe('America/New_York\n');
    expect(invoke(['zones', 'utc']).stdout).toBe('UTC\n');
    expect(invoke(['zones', 'does_not_exist']).code).toBe(0);
    expect(invoke(['zones', 'does_not_exist']).stdout).toContain('No time zones matched');
    expect(JSON.parse(invoke(['--json', 'zones', 'london']).stdout)).toEqual(['Europe/London']);
    expect(invoke(['zones', '--help']).code).toBe(0);
  });

  it('returns exit 0 with helpful diagnostics when no overlap exists', () => {
    configFile({ zones: [{ id: 'Asia/Dhaka' }, { id: 'America/New_York' }], startDate: '2026-11-02', days: 1 });
    const table = invoke(['--quiet', '09:00-18:00']);
    expect(table.code).toBe(0);
    expect(table.stderr).toBe('');
    expect(table.stdout).toContain('No shared slots');
    expect(table.stdout).toContain('Suggestion: Relax');
    const result = json(['--quiet', '09:00-18:00']);
    expect(result.slots).toEqual([]);
    expect(result.totalSlots).toBe(0);
    expect(result.diagnostics.mostRestrictive?.constraint).toBe('quiet');
  });

  it('renders changed offsets and local dates explicitly for DST/midnight spans', () => {
    const { input } = resolveOptions({}, { zones: 'America/New_York', date: '2026-11-01' });
    const fixture: CliResult = {
      slots: [{
        start: '2026-11-01T05:45:00.000Z', end: '2026-11-01T06:15:00.000Z', date: '2026-11-01', score: 1, baseScore: 1,
        zones: [{ id: 'America/New_York', label: 'New York', localStart: '2026-11-01T01:45:00.000-04:00', localEnd: '2026-11-01T01:15:00.000-05:00', formattedStart: '', formattedEnd: '', classification: 'acceptable' }],
        reason: 'Fold fixture'
      }],
      totalSlots: 1,
      diagnostics: { scannedCandidates: 1, rejectedCandidates: 0, constraints: [], mostRestrictive: null, message: '1 slots found.', suggestion: '' },
      range: { start: '', end: '' }
    };
    expect(formatTable(fixture, input)).toContain('-0400/-0500 ~');
    fixture.slots[0]!.zones[0]!.localEnd = '2026-11-02T01:15:00.000-05:00';
    expect(formatTable(fixture, input)).toContain('Mon 2 Nov 01:15');
  });

  it('neutralizes control characters in configured labels before table output', () => {
    configFile({ zones: [{ id: 'UTC', label: 'HQ\n\u001b[31m' }], startDate: '2026-11-02', top: 1 });
    const output = invoke([]);
    expect(output.code).toBe(0);
    expect(output.stdout).not.toContain('\u001b');
    expect(output.stdout).toContain('HQ  [31m');
  });
});

describe('built Node executable', () => {
  const packageDir = resolve('packages/cli');
  const executable = join(packageDir, 'dist/bin.js');
  let isolated: string;
  beforeAll(() => {
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: packageDir, encoding: 'utf8' });
    isolated = mkdtempSync(join(tmpdir(), 'tzmeet-built-'));
  });
  afterAll(() => { rmSync(isolated, { recursive: true, force: true }); });

  function execute(args: string[]) {
    return spawnSync(process.execPath, [executable, ...args], { cwd: isolated, encoding: 'utf8' });
  }

  it('has an executable shebang and a publishable bin manifest', () => {
    expect(readFileSync(executable, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    expect(manifest.name).toBe('tzmeet');
    expect(manifest.bin.tzmeet).toBe('./dist/bin.js');
    expect(manifest.engines.node).toBe('>=20');
    expect(manifest.dependencies['@tzmeet/core']).toBeUndefined();
  });

  it('runs the real binary with JSON stdout and exit 0', () => {
    const output = execute([...fixedArgs, '--json']);
    expect(output.status, output.stderr).toBe(0);
    expect(output.stderr).toBe('');
    const result = JSON.parse(output.stdout) as FindSlotsResult;
    expect(result.slots).toHaveLength(2);
    expect(result.slots[0]!.zones).toHaveLength(3);
  });

  it('runs table output, zone search and help from an unrelated directory', () => {
    expect(execute(fixedArgs).stdout).toContain('Reason');
    expect(execute(['zones', 'london']).stdout).toBe('Europe/London\n');
    expect(execute(['--help']).status).toBe(0);
  });

  it('propagates the required invalid-input exit code', () => {
    const output = execute(['--zones', 'Mars/Olympus', '--date', '2026-11-02']);
    expect(output.status).toBe(1);
    expect(output.stdout).toBe('');
    expect(output.stderr).toContain('Unknown IANA');
  });

  it('does not treat an empty result as a process error', () => {
    const output = execute(['--zones', 'Asia/Dhaka,America/New_York', '--date', '2026-11-02', '--days', '1', '--quiet', '09:00-18:00', '--json']);
    expect(output.status).toBe(0);
    expect(JSON.parse(output.stdout).slots).toEqual([]);
  });
});
