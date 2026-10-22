import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker.js";
import { API_VERSION } from "../src/app.js";

describe("deployment adapters/configuration without network", () => {
  it("retains Worker rates across requests, isolates IPs and rotates environment keys", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const env = { RATE_LIMIT: "1", API_KEYS: "worker-key" };
      const health = (ip: string) =>
        worker.fetch(
          new Request("https://example.com/v1/health", {
            headers: { "CF-Connecting-IP": ip },
          }),
          env,
        );
      expect((await health("one")).status).toBe(200);
      expect((await health("one")).status).toBe(429);
      expect((await health("two")).status).toBe(200);
      const request = (key: string, settings = { API_KEYS: "worker-key" }) =>
        worker.fetch(
          new Request("https://example.com/v1/zones?search=dhaka", {
            headers: { "X-API-Key": key, "CF-Connecting-IP": "test" },
          }),
          settings,
        );
      expect((await request("worker-key")).status).toBe(200);
      expect((await request("wrong", { API_KEYS: "rotated-key" })).status).toBe(
        401,
      );
      expect(
        (await request("rotated-key", { API_KEYS: "rotated-key" })).status,
      ).toBe(200);
    } finally {
      log.mockRestore();
    }
  });
  it("fails closed with sanitized JSON and request/security headers for invalid Worker configuration", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const response = await worker.fetch(
        new Request("https://example.com/v1/health"),
        { RATE_LIMIT: "invalid" },
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
      });
      expect(response.headers.get("X-Request-Id")).toBeTruthy();
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    } finally {
      log.mockRestore();
    }
  });
  it("has valid entry/version/secure container configuration contracts", () => {
    const packageJson = JSON.parse(
      readFileSync("packages/api/package.json", "utf8"),
    ) as { version: string; scripts: Record<string, string> };
    expect(packageJson.version).toBe(API_VERSION);
    expect(packageJson.scripts.start).toBe("node dist/node.js");
    const docker = readFileSync("packages/api/Dockerfile", "utf8");
    expect(docker.match(/^FROM /gm)).toHaveLength(2);
    expect(docker).toContain("USER node");
    expect(docker).toContain("HEALTHCHECK");
    expect(docker).toContain("deploy --prod --legacy");
    expect(docker).toContain("dist/node.js");
    const wrangler = readFileSync("packages/api/wrangler.toml", "utf8");
    expect(wrangler).toContain('main = "src/worker.ts"');
    expect(wrangler).not.toMatch(
      /\[\[?(kv_namespaces|d1_databases|durable_objects)/,
    );
  });
});
