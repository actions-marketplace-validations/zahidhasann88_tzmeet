import { build } from "esbuild";
import { webcrypto } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";
import { API_VERSION } from "../src/app.js";

it("bundles the app for Fetch-API runtimes with no Node or network APIs", async () => {
  const output = await build({
    entryPoints: ["packages/api/src/app.ts"],
    alias: { "@tzmeet/core": "./packages/core/src/index.ts" },
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "tzmeetApi",
    write: false,
    target: "es2022",
    metafile: true,
  });
  expect(
    Object.keys(output.metafile!.inputs).some((path) =>
      path.startsWith("node:"),
    ),
  ).toBe(false);
  const runtime = createContext({
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    performance,
  });
  runInContext(output.outputFiles[0]!.text, runtime);
  expect(runInContext("typeof process", runtime)).toBe("undefined");
  expect(runInContext("typeof require", runtime)).toBe("undefined");
  expect(runInContext("typeof fetch", runtime)).toBe("undefined");
  const response = (await runInContext(
    "tzmeetApi.createApp({log: () => {}}).request('/v1/health')",
    runtime,
  )) as Response;
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", version: API_VERSION });
});
