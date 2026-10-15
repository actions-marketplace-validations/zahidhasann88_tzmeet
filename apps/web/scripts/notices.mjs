import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

const root = fileURLToPath(new URL('..', import.meta.url));
const destination = process.argv[2] ?? 'out';
const notices = ['Third-party licenses for tzmeet web application.\n'];
for (const [name, base, license] of [
  ['luxon', '../core', 'LICENSE.md'], ['adhan', '../core', 'LICENSE'], ['zod', '../core', 'LICENSE'],
  ['react', 'web', 'LICENSE'], ['react-dom', 'web', 'LICENSE']
]) {
  const directory = base === 'web' ? root : `${root}/../../packages/core`;
  notices.push(`===== ${name} =====\n${await readFile(`${directory}/node_modules/${name}/${license}`, 'utf8')}`);
}
await writeFile(`${root}/${destination}/THIRD_PARTY_NOTICES.txt`, notices.join('\n\n'));
await copyFile(`${root}/../../LICENSE`, `${root}/${destination}/LICENSE`);
await writeFile(`${root}/${destination}/.nojekyll`, '');
