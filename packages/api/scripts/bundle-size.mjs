import process from 'node:process';
import { default as console } from 'node:console';
import { URL, fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
const directory = new URL('../.wrangler/bundle/', import.meta.url);
const files = readdirSync(directory).filter(name => /\.(?:js|mjs|wasm)$/.test(name));
if (!files.length) throw new Error('Run pnpm worker:dry-run before measuring bundle size');
let raw = 0, gzip = 0;
for (const file of files) {
  const bytes = readFileSync(join(fileURLToPath(directory), file));
  raw += bytes.byteLength; gzip += gzipSync(bytes).byteLength;
}
// Official Cloudflare limits checked 2026-10-14: 64 MiB uncompressed,
// no compressed-size cap. Also check the older conservative 3 MiB gzip cap.
const freeLimit = 64 * 1024 * 1024;
console.log(JSON.stringify({ files, uncompressedBytes: raw, gzipBytes: gzip, freeLimitBytes: freeLimit, belowFreeLimit: raw < freeLimit, belowLegacy3MiBGzip: gzip < 3 * 1024 * 1024 }));
if (raw >= freeLimit) process.exitCode = 1;
