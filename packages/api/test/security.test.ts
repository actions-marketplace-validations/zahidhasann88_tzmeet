import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, optionsFromEnv, type LogEntry } from "../src/app.js";
import { keyVerifier } from "../src/security.js";
const quiet = { log: () => {} };
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("API safety", () => {
  it.each([undefined, "1", "99999"])(
    "enforces actual bytes with Content-Length %s",
    async (length) => {
      const app = createApp(quiet);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (length) headers["Content-Length"] = length;
      const response = await app.request("/v1/slots", {
        method: "POST",
        headers,
        body: JSON.stringify({ padding: "x".repeat(32768) }),
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({
        error: { code: "BODY_TOO_LARGE" },
      });
      expect(response.headers.get("X-Request-Id")).toBeTruthy();
    },
  );
  it("measures UTF-8 bytes rather than characters and rejects compressed requests", async () => {
    const app = createApp(quiet);
    expect(
      (
        await app.request("/v1/slots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "বাংলা".repeat(3000) }),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await app.request("/v1/slots", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
          },
          body: "{}",
        })
      ).status,
    ).toBe(400);
  });
  it("resets rates at the window boundary with fake timers and retry/reset headers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const app = createApp({
      ...quiet,
      rateLimit: { limit: 2, windowMs: 60000 },
    });
    expect(
      (await app.request("/v1/health")).headers.get("X-RateLimit-Remaining"),
    ).toBe("1");
    expect((await app.request("/v1/health")).status).toBe(200);
    const denied = await app.request("/v1/health");
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("60");
    expect(denied.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(denied.headers.get("X-RateLimit-Reset")).toBe(
      String(Date.now() / 1000 + 60),
    );
    vi.advanceTimersByTime(60000);
    expect((await app.request("/v1/health")).status).toBe(200);
  });
  it("does not trust forged forwarded headers and bounds distinct-IP counters", async () => {
    const app = createApp({ ...quiet, rateLimit: { limit: 1 } });
    expect(
      (
        await app.request("/v1/health", {
          headers: { "X-Forwarded-For": "1.2.3.4" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/v1/health", {
          headers: {
            "X-Forwarded-For": "5.6.7.8",
            "CF-Connecting-IP": "5.6.7.8",
          },
        })
      ).status,
    ).toBe(429);
    const trusted = createApp({
      ...quiet,
      rateLimit: { limit: 1, maxBuckets: 1 },
      clientIp: (_request, env) => String(env.ip),
    });
    const request = (ip: string) => trusted.request("/v1/health", {}, { ip });
    expect((await request("a")).status).toBe(200);
    expect((await request("b")).status).toBe(200);
    expect((await request("c")).status).toBe(429);
    expect((await request("a")).status).toBe(429);
  });
  it("accepts either key header, rejects invalid keys and keeps public health available", async () => {
    const app = createApp({
      ...quiet,
      apiKeys: ["first-secret", "second-secret"],
    });
    expect((await app.request("/v1/zones?search=dhaka")).status).toBe(401);
    expect(
      (
        await app.request("/v1/zones?search=dhaka", {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("/v1/zones?search=dhaka", {
          headers: { Authorization: "Bearer first-secret" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/v1/zones?search=dhaka", {
          headers: { "X-API-Key": "second-secret" },
        })
      ).status,
    ).toBe(200);
    const conflicting = await app.request("/v1/zones", {
      headers: { Authorization: "Basic invalid", "X-API-Key": "first-secret" },
    });
    expect(conflicting.status).toBe(401);
    expect(conflicting.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect((await app.request("/v1/health")).status).toBe(200);
  });
  it("uses native HMAC verification for every key, without early-match shortcuts", async () => {
    const spy = vi.spyOn(crypto.subtle, "verify");
    const verify = keyVerifier(["alpha", "beta", "gamma"]);
    expect(await verify("alpha")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(await verify("gamma")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(6);
    expect(await verify("no")).toBe(false);
    expect(spy).toHaveBeenCalledTimes(9);
    expect(
      spy.mock.calls.every(
        (call) =>
          call[0] === "HMAC" && (call[2] as ArrayBuffer).byteLength === 32,
      ),
    ).toBe(true);
  });
  it("provides security/request IDs on success and all error responses; logs only approved fields", async () => {
    const entries: LogEntry[] = [];
    const app = createApp({ log: (entry) => entries.push(entry) });
    for (const [path, init] of [
      ["/v1/health?secret=hidden", {}],
      ["/unknown", {}],
      ["/v1/slots", { method: "PUT" }],
      [
        "/v1/slots",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"password":"PRIVATE"}',
        },
      ],
    ] as const) {
      const response = await app.request(path, init);
      expect(response.headers.get("X-Request-Id")).toMatch(/^[\da-f-]{36}$/);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
    expect(entries).toHaveLength(4);
    for (const entry of entries)
      expect(Object.keys(entry).sort()).toEqual([
        "duration",
        "id",
        "method",
        "path",
        "status",
      ]);
    expect(JSON.stringify(entries)).not.toMatch(/PRIVATE|hidden|password/);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(4);
  });
  it("enables wildcard CORS only for GET/HEAD, explicit allowed origins for POST, never credentials", async () => {
    const app = createApp(quiet);
    const get = await app.request("/v1/health", {
      headers: { Origin: "https://example.com" },
    });
    expect(get.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(get.headers.has("Access-Control-Allow-Credentials")).toBe(false);
    const preflight = (a: ReturnType<typeof createApp>, origin: string) =>
      a.request("/v1/slots", {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
      });
    expect(
      (await preflight(app, "https://example.com")).headers.has(
        "Access-Control-Allow-Origin",
      ),
    ).toBe(false);
    const restricted = createApp({
      ...quiet,
      corsOrigins: ["https://allowed.com"],
    });
    expect(
      (await preflight(restricted, "https://allowed.com")).headers.get(
        "Access-Control-Allow-Origin",
      ),
    ).toBe("https://allowed.com");
    expect(
      (await preflight(restricted, "https://evil.com")).headers.has(
        "Access-Control-Allow-Origin",
      ),
    ).toBe(false);
  });
  it("caches only public read-only responses with explicit safe ranges", async () => {
    const app = createApp({
      ...quiet,
      now: () => new Date("2026-11-02T12:00:00Z"),
    });
    expect((await app.request("/v1/health")).headers.get("Cache-Control")).toBe(
      "public, max-age=30",
    );
    expect(
      (await app.request("/v1/zones?search=dhaka")).headers.get(
        "Cache-Control",
      ),
    ).toBe("public, max-age=60");
    for (const [date, cache] of [
      ["2026-11-02", "no-store"],
      ["2026-11-03", "public, max-age=30"],
      ["2026-11-01", "public, max-age=30"],
    ]) {
      expect(
        (
          await app.request(`/v1/slots?zones=UTC&date=${date}&days=1`)
        ).headers.get("Cache-Control"),
      ).toBe(cache);
    }
    const keyed = createApp({ ...quiet, apiKeys: ["key"] });
    expect(
      (
        await keyed.request("/v1/zones", { headers: { "X-API-Key": "key" } })
      ).headers.get("Cache-Control"),
    ).toBe("no-store");
  });
  it("parses environment configuration and fails closed for invalid rate limits", () => {
    expect(
      optionsFromEnv({
        API_KEYS: "one,two",
        CORS_ORIGINS: "https://a,https://b",
        RATE_LIMIT: "5",
      }),
    ).toMatchObject({
      apiKeys: ["one", "two"],
      corsOrigins: ["https://a", "https://b"],
      rateLimit: { limit: 5 },
    });
    expect(() => optionsFromEnv({ RATE_LIMIT: "NaN" })).toThrow();
    expect(() => createApp({ rateLimit: { limit: 0 } })).toThrow();
  });
});
