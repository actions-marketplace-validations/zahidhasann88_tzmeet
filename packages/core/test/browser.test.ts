import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { expect, it } from 'vitest';

it('bundles for browsers and runs with no Node or network APIs', async () => {
  const output = await build({
    entryPoints: ['packages/core/src/index.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'tzmeet',
    write: false,
    target: 'es2022',
    metafile: true
  });
  expect(Object.keys(output.metafile!.inputs).some(path => path.startsWith('node:'))).toBe(false);
  const browser = createContext({});
  runInContext(output.outputFiles[0]!.text, browser);
  expect(runInContext('typeof process', browser)).toBe('undefined');
  expect(runInContext('typeof require', browser)).toBe('undefined');
  expect(runInContext('typeof fetch', browser)).toBe('undefined');
  const result = runInContext(`tzmeet.findSlots({
    zones: [{id: 'Asia/Dhaka', weekend: [5, 6]}],
    startDate: '2026-11-02', days: 1,
    prayer: {location: 'Dhaka', method: 'Karachi', bufferMinutes: 10}
  })`, browser);
  expect(result.slots.length).toBeGreaterThan(0);
  expect(result.diagnostics.constraints.some((entry: { constraint: string }) => entry.constraint === 'prayer')).toBe(true);
});
