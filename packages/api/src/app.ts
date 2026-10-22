import { Scalar } from "@scalar/hono-api-reference";
import type { Context } from "hono";
import {
  errorExample,
  responseExamples,
  slotRequestExample,
} from "./examples.js";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  calendarCollectionText,
  inviteText,
  convertTime,
  explainCron,
  findSlots,
  getTimeZoneInfo,
  listTimeZones,
  parseScheduleInput,
  recurringImpact,
  validateInput,
  ScheduleInputError,
  InputValidationError,
  type FindSlotsInput,
  type NormalizedInput,
} from "@tzmeet/core";
import {
  boundedBody,
  safetyMiddleware,
  type ApiEnv,
  type AppOptions,
} from "./security.js";
import { HTTPException } from "hono/http-exception";
import { ApiError, validationError } from "./errors.js";
import {
  apiConversionSchema,
  apiInputSchema,
  convertQuerySchema,
  conversionResultSchema,
  cronQuerySchema,
  cronResultSchema,
  errorSchema,
  recurringQuerySchema,
  recurringResultSchema,
  healthSchema,
  resultQuerySchema,
  slotsGetQuerySchema,
  slotsResultSchema,
  zoneInfoSchema,
  zonesQuerySchema,
} from "./schemas.js";

export const API_VERSION = "0.2.0";
/** Platform-neutral dependencies; injected clocks make app.request() tests deterministic. */
export type { AppOptions, LogEntry } from "./security.js";
export { optionsFromEnv } from "./security.js";
const json = <T extends z.ZodTypeAny>(schema: T, example?: unknown) => ({
  "application/json": {
    schema,
    example:
      example ??
      ((schema as unknown) === errorSchema ? errorExample : undefined),
  },
});
const slotContent = {
  ...json(slotsResultSchema),
  "text/plain": {
    schema: z.string(),
    example: "Mon 2 Nov 2026: 20:00–20:30 Dhaka / 14:00–14:30 London",
  },
  "text/calendar": {
    schema: z.string(),
    example: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n",
  },
};
const errorResponses = {
  400: { description: "Input validation failed", content: json(errorSchema) },
  401: {
    description: "API key required",
    content: json(errorSchema, {
      error: {
        code: "UNAUTHORIZED",
        message: "A valid Bearer token or X-API-Key is required.",
      },
    }),
  },
  413: {
    description: "Request body exceeds 32 KB",
    content: json(errorSchema, {
      error: {
        code: "BODY_TOO_LARGE",
        message: "Request body must not exceed 32768 bytes.",
      },
    }),
  },
  429: {
    description: "Rate limit exceeded",
    content: json(errorSchema, {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Try again after the indicated delay.",
      },
    }),
  },
  404: {
    description: "Unknown route",
    content: json(errorSchema, {
      error: {
        code: "NOT_FOUND",
        message: "The requested route does not exist.",
      },
    }),
  },
  405: {
    description: "Method not allowed",
    content: json(errorSchema, {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Allowed methods: GET, POST, HEAD",
      },
    }),
  },
  500: {
    description: "Unexpected failure, without stack traces",
    content: json(errorSchema, {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    }),
  },
};
const getSlots = createRoute({
  method: "get",
  path: "/v1/slots",
  tags: ["Slots"],
  summary: "Find shared meeting slots with CLI-style query syntax",
  request: { query: slotsGetQuerySchema },
  responses: {
    200: {
      description:
        "Ranked slots and diagnostics; an empty search is successful",
      content: slotContent,
    },
    ...errorResponses,
  },
});
const postSlots = createRoute({
  method: "post",
  path: "/v1/slots",
  tags: ["Slots"],
  summary: "Find shared meeting slots with per-zone rules",
  request: {
    query: resultQuerySchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: apiInputSchema,
          example: slotRequestExample,
        },
      },
    },
  },
  responses: {
    200: {
      description:
        "Ranked slots and diagnostics; an empty search is successful",
      content: slotContent,
    },
    ...errorResponses,
  },
});
const getZones = createRoute({
  method: "get",
  path: "/v1/zones",
  tags: ["Time zones"],
  summary: "Search runtime IANA identifiers and their current offsets",
  request: { query: zonesQuerySchema },
  responses: {
    200: {
      description: "Matching identifiers with friendly labels and UTC offsets",
      content: json(z.object({ zones: z.array(zoneInfoSchema) })),
    },
    ...errorResponses,
  },
});
const getConvert = createRoute({
  method: "get",
  path: "/v1/convert",
  tags: ["Time zones"],
  summary: "Convert a local ISO time to other zones, including DST folds/gaps",
  request: { query: convertQuerySchema },
  responses: {
    200: {
      description: "Source time, UTC instant and destination representations",
      content: json(conversionResultSchema),
    },
    ...errorResponses,
  },
});
const getCron = createRoute({
  method: "get",
  path: "/v1/cron",
  tags: ["Cron"],
  summary:
    "Explain a cron expression: plain English, next runs across zones, DST skips and double runs",
  request: { query: cronQuerySchema },
  responses: {
    200: {
      description:
        "Description, upcoming runs and warnings, using each engine's DST rules",
      content: json(cronResultSchema),
    },
    ...errorResponses,
  },
});
const getRecurring = createRoute({
  method: "get",
  path: "/v1/recurring",
  tags: ["Slots"],
  summary:
    "Follow a weekly meeting through DST changes: each zone's local time, week by week",
  request: { query: recurringQuerySchema },
  responses: {
    200: {
      description:
        "Every occurrence, periods of unchanged local times with their causes, and warnings",
      content: json(recurringResultSchema),
    },
    ...errorResponses,
  },
});
const getHealth = createRoute({
  method: "get",
  path: "/v1/health",
  tags: ["System"],
  summary: "Application health and version",
  responses: {
    200: { description: "Healthy application", content: json(healthSchema) },
    ...errorResponses,
  },
});
const methods: Record<string, readonly string[]> = {
  "/v1/slots": ["GET", "POST", "HEAD"],
  "/v1/zones": ["GET", "HEAD"],
  "/v1/convert": ["GET", "HEAD"],
  "/v1/cron": ["GET", "HEAD"],
  "/v1/recurring": ["GET", "HEAD"],
  "/v1/health": ["GET", "HEAD"],
  "/openapi.json": ["GET", "HEAD"],
  "/docs": ["GET", "HEAD"],
};
const array = (value: string | string[] | undefined) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export function createApp(options: AppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const app = new OpenAPIHono<ApiEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const raw =
          result.target === "json"
            ? c.get("bodyInput")
            : Object.fromEntries(new URL(c.req.url).searchParams);
        return c.json(validationError(result.error, raw).body, 400);
      }
    },
  });
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json(error.body, error.status);
    if (
      error instanceof ScheduleInputError ||
      error instanceof InputValidationError ||
      error instanceof z.ZodError
    )
      return c.json(validationError(error, c.get("bodyInput")).body, 400);
    if (error instanceof HTTPException && error.status === 400)
      return c.json(
        new ApiError(400, "INVALID_JSON", "body must contain valid JSON", [
          { field: "body", message: "Malformed JSON" },
        ]).body,
        400,
      );
    return c.json(
      new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred.").body,
      500,
    );
  });
  app.notFound((c) =>
    c.json(
      new ApiError(404, "NOT_FOUND", "The requested route does not exist.")
        .body,
      404,
    ),
  );
  for (const middleware of safetyMiddleware(options)) app.use("*", middleware);
  app.use("*", boundedBody);
  app.use("*", async (c, next) => {
    const allowed = methods[c.req.path];
    if (allowed && !allowed.includes(c.req.method)) {
      c.header("Allow", allowed.join(", "));
      return c.json(
        new ApiError(
          405,
          "METHOD_NOT_ALLOWED",
          `Allowed methods: ${allowed.join(", ")}`,
        ).body,
        405,
      );
    }
    await next();
  });
  app.use("/v1/slots", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (c.req.method === "POST") {
      const contentType = c.req
        .header("Content-Type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json")
        throw new ApiError(
          400,
          "UNSUPPORTED_CONTENT_TYPE",
          "Content-Type must be application/json",
          [{ field: "headers.content-type", message: "Use application/json" }],
        );
      try {
        c.set("bodyInput", await c.req.json());
      } catch {
        throw new ApiError(
          400,
          "INVALID_JSON",
          "body must contain valid JSON",
          [{ field: "body", message: "Malformed JSON" }],
        );
      }
    }
    await next();
  });
  const validate = (input: FindSlotsInput): NormalizedInput => {
    const limited = apiInputSchema.safeParse(input);
    if (!limited.success) throw validationError(limited.error, input);
    const checked = validateInput(limited.data);
    if (!checked.success)
      throw validationError(new InputValidationError(checked.errors), input);
    return checked.data;
  };
  const slots = (input: FindSlotsInput, top: number) => {
    const result = findSlots(validate(input));
    const selected = result.slots.slice(0, top);
    return {
      range: result.range,
      response: {
        slots: selected,
        diagnostics: result.diagnostics,
        meta: {
          count: selected.length,
          generatedAt: now().toISOString(),
          version: API_VERSION,
        },
      },
    };
  };
  const renderSlots = (
    c: Context<ApiEnv>,
    result: ReturnType<typeof slots>,
    format: "json" | "text" | "ics",
  ) => {
    if (format === "text")
      return c.text(
        result.response.slots.length
          ? result.response.slots.map(inviteText).join("\n\n")
          : `${result.response.diagnostics.message}\n${result.response.diagnostics.suggestion}`,
        200,
      );
    if (format === "ics") {
      c.header(
        "Content-Disposition",
        'attachment; filename="tzmeet-slots.ics"',
      );
      return c.text(
        calendarCollectionText(
          result.response.slots,
          result.response.meta.generatedAt,
        ),
        200,
        { "Content-Type": "text/calendar; charset=utf-8" },
      );
    }
    return c.json(result.response, 200);
  };
  app.openapi(postSlots, (c) => {
    const body = c.req.valid("json");
    const query = c.req.valid("query");
    return renderSlots(c, slots(body, query.top), query.format);
  });
  app.openapi(getSlots, (c) => {
    const query = c.req.valid("query");
    const input = parseScheduleInput({
      ...query,
      zoneWork: array(query.zoneWork),
      weekend: array(query.weekend),
      holiday: array(query.holiday),
      holidayPreset: array(query.holidayPreset),
    });
    const result = slots(input, query.top);
    const at = now().getTime();
    if (
      !options.apiKeys?.length &&
      (Date.parse(result.range.end) <= at ||
        Date.parse(result.range.start) > at)
    )
      c.header("Cache-Control", "public, max-age=30");
    return renderSlots(c, result, query.format);
  });
  app.openapi(getZones, (c) => {
    const at = now().toISOString();
    if (!options.apiKeys?.length)
      c.header("Cache-Control", "public, max-age=60");
    return c.json(
      {
        zones: listTimeZones(c.req.valid("query").search).map((id) =>
          getTimeZoneInfo(id, at),
        ),
      },
      200,
    );
  });
  app.openapi(getConvert, (c) => {
    const query = c.req.valid("query");
    const input = { ...query, to: query.to.split(",").map((id) => id.trim()) };
    const validated = apiConversionSchema.safeParse(input);
    if (!validated.success) throw validationError(validated.error, input);
    return c.json(convertTime(validated.data), 200);
  });
  app.openapi(getCron, (c) => {
    const { display, from, ...query } = c.req.valid("query");
    if (from && !options.apiKeys?.length)
      c.header("Cache-Control", "public, max-age=300");
    try {
      return c.json(
        explainCron({
          ...query,
          from: from ?? now().toISOString(),
          displayZones: display
            ? display.split(",").map((id) => id.trim())
            : [],
        }),
        200,
      );
    } catch (error) {
      if (!(error instanceof ScheduleInputError)) throw error;
      throw new ScheduleInputError(
        error.issues.map((issue) => ({
          ...issue,
          path: issue.path.replace(/^displayZones(?:\.\d+)?/, "display"),
        })),
      );
    }
  });
  app.openapi(getRecurring, (c) => {
    const { time, weeks, ...query } = c.req.valid("query");
    const input = parseScheduleInput({
      ...query,
      zoneWork: array(query.zoneWork),
      weekend: array(query.weekend),
      holiday: array(query.holiday),
      holidayPreset: array(query.holidayPreset),
    });
    if (!options.apiKeys?.length) c.header("Cache-Control", "public, max-age=300");
    return c.json(
      recurringImpact({
        zones: input.zones,
        startDate: input.startDate,
        durationMinutes: input.durationMinutes,
        ...(input.prayer ? { prayer: input.prayer } : {}),
        time,
        weeks,
      }),
      200,
    );
  });
  app.openapi(getHealth, (c) => {
    c.header("Cache-Control", "public, max-age=30");
    return c.json({ status: "ok" as const, version: API_VERSION }, 200);
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "BearerAuth", {
    type: "http",
    scheme: "bearer",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "ApiKeyAuth", {
    type: "apiKey",
    in: "header",
    name: "X-API-Key",
  });
  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/openapi.json",
    tags: ["System"],
    summary: "Generated OpenAPI document",
    responses: {
      200: {
        description: "OpenAPI 3.0.3 specification",
        content: {
          "application/json": {
            schema: z
              .object({
                openapi: z.string(),
                info: z.object({ title: z.string(), version: z.string() }),
                paths: z.record(z.unknown()),
              })
              .passthrough(),
            example: {
              openapi: "3.0.3",
              info: { title: "tzmeet REST API", version: API_VERSION },
              paths: {},
            },
          },
        },
      },
      ...errorResponses,
    },
  });
  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/docs",
    tags: ["System"],
    summary: "Interactive Scalar API reference",
    responses: {
      200: {
        description:
          "Interactive reference HTML (pinned external Scalar script)",
        content: {
          "text/html": {
            schema: z.string(),
            example:
              "<!doctype html><html><body>tzmeet API reference</body></html>",
          },
        },
      },
      ...errorResponses,
    },
  });
  app.get(
    "/docs",
    Scalar({
      url: "/openapi.json",
      pageTitle: "tzmeet API reference",
      cdn: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.74.0/dist/browser/standalone.js",
      withDefaultFonts: false,
      persistAuth: false,
    }),
  );
  app.get("/openapi.json", (c) => {
    const document = app.getOpenAPIDocument({
      openapi: "3.0.3",
      info: {
        title: "tzmeet REST API",
        version: API_VERSION,
        description:
          "Stateless transport over tzmeet core. Explicit dates, Luxon-only conversions, optional API keys, bounded bodies and per-instance IP rate counters. No database. See README for cache and rate-limit scope.",
      },
      servers: [{ url: "/", description: "This API origin" }],
    });
    const examples = responseExamples(API_VERSION);
    for (const [path, name] of [
      ["/v1/slots", "slots"],
      ["/v1/zones", "zones"],
      ["/v1/convert", "convert"],
      ["/v1/cron", "cron"],
      ["/v1/recurring", "recurring"],
      ["/v1/health", "health"],
    ] as const) {
      for (const method of ["get", "post"] as const) {
        const operation = document.paths[path]?.[method];
        if (!operation) continue;
        const ok = operation.responses?.["200"];
        if (ok && "content" in ok && ok.content?.["application/json"])
          ok.content["application/json"].example = examples[name];
        if (name === "slots" && ok && "content" in ok) {
          if (ok.content?.["text/plain"])
            ok.content["text/plain"].example = examples.slots.slots
              .map(inviteText)
              .join("\n\n");
          if (ok.content?.["text/calendar"])
            ok.content["text/calendar"].example = calendarCollectionText(
              examples.slots.slots,
              examples.slots.meta.generatedAt,
            );
        }
        for (const response of Object.values(operation.responses ?? {})) {
          if ("$ref" in response) continue;
          response.headers = {
            "X-Request-Id": {
              schema: { type: "string", format: "uuid" },
              description: "Server-generated request identifier",
            },
            "X-RateLimit-Limit": { schema: { type: "integer" }, example: 60 },
            "X-RateLimit-Remaining": {
              schema: { type: "integer" },
              example: 59,
            },
            "X-RateLimit-Reset": {
              schema: { type: "integer" },
              description: "Reset instant as Unix seconds",
            },
          };
        }
        if (options.apiKeys?.length && name !== "health")
          operation.security = [{ BearerAuth: [] }, { ApiKeyAuth: [] }];
      }
    }
    return c.json(document);
  });
  return app;
}
