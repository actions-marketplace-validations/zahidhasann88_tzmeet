import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { ApiError } from './errors.js';
import { API_LIMITS } from './schemas.js';

export type ApiEnv = { Bindings: Record<string, unknown>; Variables: { bodyInput: unknown; requestId: string } };
export interface LogEntry { method: string; path: string; status: number; duration: number; id: string }
export interface AppOptions {
  now?: () => Date;
  apiKeys?: readonly string[];
  corsOrigins?: readonly string[];
  rateLimit?: { limit?: number; windowMs?: number; maxBuckets?: number };
  /** Only adapters should derive an IP from trusted platform/socket information. */
  clientIp?: (request: Request, bindings: Record<string, unknown>) => string | undefined;
  log?: (entry: LogEntry) => void;
}
const positive = (value: number, field: string) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`);
  return value;
};
export function optionsFromEnv(env: Record<string, string | undefined>): AppOptions {
  const integer = (name: string, fallback: number) => {
    const value = env[name];
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
    return positive(Number(value), name);
  };
  return {
    apiKeys: env.API_KEYS?.split(',').map(key => key.trim()).filter(Boolean) ?? [],
    corsOrigins: env.CORS_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean) ?? ['*'],
    rateLimit: { limit: integer('RATE_LIMIT', 60), windowMs: integer('RATE_WINDOW_MS', 60000), maxBuckets: integer('RATE_MAX_BUCKETS', 10000) }
  };
}

/** Native WebCrypto HMAC verification avoids JavaScript string/early-byte comparisons.
 * Every configured signature is verified, even after a match; digests are fixed length.
 */
export function keyVerifier(keys: readonly string[]) {
  let signatures: Promise<{ key: CryptoKey; signatures: ArrayBuffer[] }> | undefined;
  return async (candidate: string): Promise<boolean> => {
    signatures ??= (async () => {
      const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
      return { key, signatures: await Promise.all(keys.map(value => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))) };
    })();
    const prepared = await signatures;
    const value = new TextEncoder().encode(candidate);
    const matches = await Promise.all(prepared.signatures.map(signature => crypto.subtle.verify('HMAC', prepared.key, signature, value)));
    return matches.reduce((result, match) => Number(match) | result, 0) !== 0;
  };
}

export function safetyMiddleware(options: AppOptions): MiddlewareHandler<ApiEnv>[] {
  const now = options.now ?? (() => new Date());
  const limit = positive(options.rateLimit?.limit ?? 60, 'rateLimit.limit');
  const windowMs = positive(options.rateLimit?.windowMs ?? 60000, 'rateLimit.windowMs');
  const maxBuckets = positive(options.rateLimit?.maxBuckets ?? 10000, 'rateLimit.maxBuckets');
  const keys = options.apiKeys ?? [];
  if (keys.some(key => key.length === 0)) throw new Error('apiKeys must not contain empty keys');
  const verify = keyVerifier(keys);
  // No timers, payload storage or raw IP retention. Expired hashed counters are swept
  // on requests; full maps use one shared overflow bucket rather than evicting limits.
  const buckets = new Map<string, { count: number; reset: number }>();
  const log = options.log ?? (entry => console.info(JSON.stringify(entry)));
  const observed: MiddlewareHandler<ApiEnv> = async (c, next) => {
    const start = performance.now();
    const id = crypto.randomUUID();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    c.header('Cache-Control', 'no-store');
    await next();
    if (c.res.status >= 400) c.header('Cache-Control', 'no-store');
    try { log({ method: c.req.method, path: c.req.path, status: c.res.status, duration: Math.round((performance.now() - start) * 1000) / 1000, id }); }
    catch { /* An optional logging sink must not break API responses. */ }
  };
  const rate: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const timestamp = now().getTime();
    for (const [id, bucket] of buckets) if (bucket.reset <= timestamp) buckets.delete(id);
    const ip = options.clientIp?.(c.req.raw, c.env ?? {}) ?? 'unknown';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    let id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (!buckets.has(id) && buckets.size >= maxBuckets) id = 'overflow';
    const bucket = buckets.get(id) ?? { count: 0, reset: timestamp + windowMs };
    buckets.set(id, bucket);
    bucket.count++;
    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(bucket.reset / 1000)));
    if (bucket.count > limit) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - timestamp) / 1000))));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again after the indicated delay.');
    }
    await next();
  };
  const auth: MiddlewareHandler<ApiEnv> = async (c, next) => {
    // Health/docs are deliberately public. Health still shares the rate limiter.
    if (!keys.length || !['/v1/slots', '/v1/zones', '/v1/convert'].includes(c.req.path)) return next();
    const authorization = c.req.header('Authorization');
    const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const candidate = authorization !== undefined ? bearer : c.req.header('X-API-Key');
    if (!candidate || !await verify(candidate)) {
      c.header('WWW-Authenticate', 'Bearer realm="tzmeet"');
      throw new ApiError(401, 'UNAUTHORIZED', 'A valid Bearer token or X-API-Key is required.');
    }
    await next();
  };
  const origins = options.corsOrigins ?? ['*'];
  return [observed, secureHeaders(), cors({
    origin: (origin, c) => origins.includes('*') && ['GET', 'HEAD'].includes(c.req.header('Access-Control-Request-Method') ?? c.req.method) ? '*' : origins.includes(origin) ? origin : undefined,
    allowMethods: ['GET', 'HEAD', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    exposeHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'], credentials: false, maxAge: 600
  }), rate, auth];
}

/** Read actual stream bytes even if Content-Length is absent or dishonest. */
export const boundedBody: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const tooLarge = () => new ApiError(413, 'BODY_TOO_LARGE', 'Request body must not exceed 32768 bytes.');
  if (Number(c.req.header('Content-Length')) > API_LIMITS.bodyBytes) throw tooLarge();
  if (c.req.header('Content-Encoding') && c.req.header('Content-Encoding') !== 'identity') throw new ApiError(400, 'UNSUPPORTED_CONTENT_ENCODING', 'Compressed request bodies are not supported.');
  const reader = c.req.raw.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > API_LIMITS.bodyBytes) {
          void reader.cancel().catch(() => undefined);
          throw tooLarge();
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    c.req.raw = new Request(c.req.raw, { body: bytes });
  }
  await next();
};
