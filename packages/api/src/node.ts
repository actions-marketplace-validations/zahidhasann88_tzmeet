import { serve } from '@hono/node-server';
import type { IncomingMessage } from 'node:http';
import { createApp, optionsFromEnv } from './app.js';

const portText = process.env.PORT ?? '3000';
if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw new Error('PORT must be an integer from 1 to 65535');
const app = createApp({
  ...optionsFromEnv(process.env),
  clientIp: (_request, bindings) => (bindings.incoming as IncomingMessage | undefined)?.socket.remoteAddress
});
const server = serve({ fetch: app.fetch, hostname: process.env.HOST ?? '0.0.0.0', port: Number(portText) });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  server.close(() => process.exit(0));
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  setTimeout(() => process.exit(1), 10000).unref();
});
