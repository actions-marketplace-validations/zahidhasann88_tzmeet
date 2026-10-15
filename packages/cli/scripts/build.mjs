import { build } from 'esbuild';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await mkdir(`${root}/dist`, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/bin.ts'],
  outfile: 'dist/bin.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Only commander remains a runtime dependency. Core/Luxon/adhan/zod are bundled.
  external: ['commander'],
  sourcemap: true,
  legalComments: 'linked'
});
await chmod(`${root}/dist/bin.js`, 0o755);
await copyFile(`${root}/../../LICENSE`, `${root}/LICENSE`);
const notices = ['Third-party licenses bundled with tzmeet.\n'];
for (const [name, filename] of [['luxon', 'LICENSE.md'], ['adhan', 'LICENSE'], ['zod', 'LICENSE']]) {
  const license = await readFile(`${root}/../core/node_modules/${name}/${filename}`, 'utf8');
  notices.push(`===== ${name} =====\n${license}`);
}
await writeFile(`${root}/dist/THIRD_PARTY_NOTICES.txt`, notices.join('\n\n'));
