// Development/test static file server only. The deployed app has no server code.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const root = resolve(process.argv[2] ?? 'out');
const port = Number(process.argv[3] ?? 4180);
const base = process.env.TZMEET_STATIC_BASE ?? '';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.map': 'application/json' };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://static.local').pathname);
    if (base && pathname === '/') { response.writeHead(302, { Location: `${base}/` }).end(); return; }
    if (base && !pathname.startsWith(`${base}/`)) { response.writeHead(404).end('Not found'); return; }
    let file = resolve(root, `.${pathname.slice(base.length)}`);
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end('Forbidden'); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(port, '0.0.0.0', () => { process.stdout.write(`Static export: http://0.0.0.0:${port}${base}/\n`); });
