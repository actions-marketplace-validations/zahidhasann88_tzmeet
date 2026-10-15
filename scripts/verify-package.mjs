// Pack and install the actual npm artifact, independent of workspace resolution.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'tzmeet-package-'));
try {
  const packed = join(temporary, 'packed');
  const installed = join(temporary, 'installed');
  const empty = join(temporary, 'empty-cwd');
  mkdirSync(packed);
  mkdirSync(empty);
  execFileSync('pnpm', ['--dir', 'packages/cli', 'pack', '--pack-destination', packed], { cwd: root, stdio: 'inherit' });
  const tarballs = readdirSync(packed).filter(name => name.endsWith('.tgz'));
  assert.equal(tarballs.length, 1);
  execFileSync('npm', ['install', '--prefix', installed, join(packed, tarballs[0]), '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit' });
  const packageRoot = join(installed, 'node_modules/tzmeet');
  const executable = join(packageRoot, 'dist/bin.js');
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'tzmeet');
  assert.equal(manifest.bin.tzmeet, './dist/bin.js');
  assert.deepEqual(Object.keys(manifest.dependencies), ['commander']);
  assert.equal(existsSync(join(installed, 'node_modules/@tzmeet/core')), false);
  assert.equal(readFileSync(executable, 'utf8').startsWith('#!/usr/bin/env node'), true);
  assert.ok(readFileSync(join(packageRoot, 'LICENSE'), 'utf8').includes('MIT License'));
  const notices = readFileSync(join(packageRoot, 'dist/THIRD_PARTY_NOTICES.txt'), 'utf8');
  for (const dependency of ['luxon', 'adhan', 'zod']) assert.ok(notices.includes(`===== ${dependency} =====`));
  function run(args, expectedCode = 0) {
    const result = spawnSync(process.execPath, [executable, ...args], { cwd: empty, encoding: 'utf8' });
    assert.equal(result.status, expectedCode, result.stderr);
    if (expectedCode === 0) assert.equal(result.stderr, '');
    return result;
  }
  const input = ['--zones', 'Asia/Dhaka,America/New_York,Europe/London', '--date', '2026-11-02', '--days', '1', '--top', '2'];
  const data = JSON.parse(run([...input, '--json']).stdout);
  assert.equal(data.slots.length, 2);
  assert.equal(data.slots[0].zones.length, 3);
  assert.ok(run(input).stdout.includes(data.slots[0].reason));
  assert.equal(run(['zones', 'london']).stdout, 'Europe/London\n');
  assert.equal(run(['--version']).stdout.trim(), manifest.version);
  assert.ok(run(['--help']).stdout.includes('--zone-work'));
  const error = run(['--zones', 'Mars/Olympus', '--date', '2026-11-02'], 1);
  assert.equal(error.stdout, '');
  assert.ok(error.stderr.includes('Unknown IANA'));
  const none = JSON.parse(run(['--zones', 'Asia/Dhaka,America/New_York', '--date', '2026-11-02', '--quiet', '09:00-18:00', '--json']).stdout);
  assert.deepEqual(none.slots, []);
  assert.ok(none.diagnostics.suggestion.includes('Relax'));
  process.stdout.write('PASS: packed npm CLI installs without @tzmeet/core and passes table/JSON/search/help/error/empty-result checks.\n');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
