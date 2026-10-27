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
  target: 'node22',
  // Only commander remains a runtime dependency. Core/Luxon/adhan/zod/yaml are bundled.
  external: ['commander'],
  sourcemap: true,
  legalComments: 'linked',
  // Bundled CommonJS packages (yaml) call require() for Node built-ins.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }
});
await chmod(`${root}/dist/bin.js`, 0o755);
await copyFile(`${root}/../../LICENSE`, `${root}/LICENSE`);
const notices = ['Third-party licenses bundled with tzmeet.\n'];
for (const [name, filename, from] of [['luxon', 'LICENSE.md', 'core'], ['adhan', 'LICENSE', 'core'], ['zod', 'LICENSE', 'core'], ['yaml', 'LICENSE', 'cli']]) {
  const license = await readFile(`${root}/../${from}/node_modules/${name}/${filename}`, 'utf8');
  notices.push(`===== ${name} =====\n${license}`);
}
await writeFile(`${root}/dist/THIRD_PARTY_NOTICES.txt`, notices.join('\n\n'));
