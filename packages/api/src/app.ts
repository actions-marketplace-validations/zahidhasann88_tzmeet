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
  convertCronDialect,
  convertCronZone,
  parseNaturalCron,
  findSlots,
  getTimeZoneInfo,
  listTimeZones,
  parseScheduleInput,
  recurringImpact,
  recurringCalendarText,
  holidayCalendarText,
  availabilityNow,
  badgeSvg,
  zoneSchema,
  holidayPresets,
  presetHolidays,
  presetNote,
  fairRotation,
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
  cronConvertQuerySchema,
  cronConvertResultSchema,
  cronNaturalQuerySchema,
  cronNaturalResultSchema,
  cronResultSchema,
  errorSchema,
  recurringQuerySchema,
  recurringResultSchema,
  healthSchema,
  badgeQuerySchema,
  holidaysIcsQuerySchema,
  holidaysQuerySchema,
  holidaysResultSchema,
  resultQuerySchema,
  slotsGetQuerySchema,
  slotsResultSchema,
  zoneInfoSchema,
  zonesQuerySchema,
} from "./schemas.js";

export const API_VERSION = "0.5.0";
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
const getCronConvert = createRoute({
  method: "get",
  path: "/v1/cron/convert",
  tags: ["Cron"],
  summary:
    "Convert a cron expression to another syntax (Unix, Kubernetes, Spring, Quartz) and/or time zone",
  request: { query: cronConvertQuerySchema },
  responses: {
    200: {
      description:
        "Converted expressions with problems and notes; zone conversions list one expression per DST period plus the native time-zone setting",
      content: json(cronConvertResultSchema),
    },
    ...errorResponses,
  },
});
const getCronNatural = createRoute({
  method: "get",
  path: "/v1/cron/natural",
  tags: ["Cron"],
  summary:
    'Turn plain English ("every weekday at 9am Dhaka") into a cron expression',
  request: { query: cronNaturalQuerySchema },
  responses: {
    200: {
      description:
        "The expression(s), the time zone named in the text, a plain-English check and the scheduler's time-zone setting; problems explain anything that couldn't be translated",
      content: json(cronNaturalResultSchema),
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
        "Every occurrence, periods of unchanged local times with their causes, and warnings; or the weekly series as .ics",
      content: {
        ...json(recurringResultSchema),
        "text/calendar": {
          schema: z.string(),
          example: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n",
        },
      },
    },
    ...errorResponses,
  },
});
const getHolidays = createRoute({
  method: "get",
  path: "/v1/holidays",
  tags: ["Holidays"],
  summary: "A holiday preset's public holidays for one year",
  request: { query: holidaysQuerySchema },
  responses: {
    200: {
      description:
        "Dates, names and whether each date is approximate (moon sighting), with a note when part of the year's list isn't available",
      content: json(holidaysResultSchema),
    },
    ...errorResponses,
  },
});
const getHolidaysCalendar = createRoute({
  method: "get",
  path: "/v1/holidays.ics",
  tags: ["Holidays"],
  summary:
    "Subscribe to a holiday preset in Google, Apple or Outlook calendar (this year and next)",
  request: { query: holidaysIcsQuerySchema },
  responses: {
    200: {
      description:
        "All-day events; approximate dates are marked. Stable UIDs, so calendar refreshes update events instead of duplicating them",
      content: {
        "text/calendar": {
          schema: z.string(),
          example: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n",
        },
      },
    },
    304: { description: "Not modified (If-None-Match matched the ETag)" },
    ...errorResponses,
  },
});
const getBadge = createRoute({
  method: "get",
  path: "/v1/badge.svg",
  tags: ["Availability"],
  summary:
    "A small badge saying whether someone is working now (working, off, weekend or holiday), for a README or profile",
  request: { query: badgeQuerySchema },
  responses: {
    200: {
      description:
        "SVG badge, cached for 5 minutes. Wrap it in a link to the person's My hours page",
      content: {
        "image/svg+xml": {
          schema: z.string(),
          example:
            '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20">…</svg>',
        },
      },
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
  "/v1/cron/convert": ["GET", "HEAD"],
  "/v1/cron/natural": ["GET", "HEAD"],
  "/v1/recurring": ["GET", "HEAD"],
  "/v1/holidays": ["GET", "HEAD"],
  "/v1/holidays.ics": ["GET", "HEAD"],
  "/v1/badge.svg": ["GET", "HEAD"],
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
  const slots = (input: FindSlotsInput, top: number, rotation?: "2" | "3") => {
    const result = findSlots(validate(input));
    const selected = result.slots.slice(0, top);
    return {
      range: result.range,
      response: {
        slots: selected,
        diagnostics: result.diagnostics,
        ...(rotation
          ? {
              rotation: fairRotation(result, {
                size: Number(rotation) as 2 | 3,
              }),
            }
          : {}),
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
    return renderSlots(c, slots(body, query.top, query.rotation), query.format);
  });
  app.openapi(getSlots, (c) => {
    const query = c.req.valid("query");
    const input = parseScheduleInput({
      ...query,
      zoneWork: array(query.zoneWork),
      weekend: array(query.weekend),
      holiday: array(query.holiday),
      holidayPreset: array(query.holidayPreset),
      specialHours: array(query.specialHours),
      ramadan: array(query.ramadan),
      optional: array(query.optional),
    });
    const result = slots(input, query.top, query.rotation);
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
  app.openapi(getCronConvert, (c) => {
    const { expression, dialect, to, zone, toZone, from } =
      c.req.valid("query");
    if (from && !options.apiKeys?.length)
      c.header("Cache-Control", "public, max-age=300");
    return c.json(
      {
        ...(to
          ? {
              dialect: convertCronDialect(expression, {
                ...(dialect ? { from: dialect } : {}),
                to,
              }),
            }
          : {}),
        ...(toZone
          ? {
              zone: convertCronZone({
                expression,
                ...(dialect ? { dialect } : {}),
                fromZone: zone ?? "UTC",
                toZone,
                from: from ?? now().toISOString(),
              }),
            }
          : {}),
      },
      200,
    );
  });
  app.openapi(getCronNatural, (c) => {
    const { text, dialect } = c.req.valid("query");
    if (!options.apiKeys?.length)
      c.header("Cache-Control", "public, max-age=3600");
    return c.json(parseNaturalCron(text, dialect ? { dialect } : {}), 200);
  });
  app.openapi(getRecurring, (c) => {
    const { time, weeks, format, ...query } = c.req.valid("query");
    const input = parseScheduleInput({
      ...query,
      zoneWork: array(query.zoneWork),
      weekend: array(query.weekend),
      holiday: array(query.holiday),
      holidayPreset: array(query.holidayPreset),
      specialHours: array(query.specialHours),
      ramadan: array(query.ramadan),
      optional: array(query.optional),
    });
    if (!options.apiKeys?.length)
      c.header("Cache-Control", "public, max-age=300");
    const impact = recurringImpact({
      zones: input.zones,
      startDate: input.startDate,
      durationMinutes: input.durationMinutes,
      ...(input.prayer ? { prayer: input.prayer } : {}),
      time,
      weeks,
    });
    if (format === "ics") {
      c.header(
        "Content-Disposition",
        `attachment; filename="tzmeet-weekly-${impact.occurrences[0]!.date}.ics"`,
      );
      return c.text(
        recurringCalendarText(impact, { created: now().toISOString() }),
        200,
        { "Content-Type": "text/calendar; charset=utf-8" },
      );
    }
    return c.json(impact, 200);
  });
  app.openapi(getHolidays, (c) => {
    const { preset, year = now().getUTCFullYear() } = c.req.valid("query");
    if (!options.apiKeys?.length)
      c.header("Cache-Control", "public, max-age=86400");
    return c.json(
      {
        preset,
        name: holidayPresets[preset],
        year,
        holidays: presetHolidays(preset, year),
        note: presetNote(preset, year),
      },
      200,
    );
  });
  app.openapi(getHolidaysCalendar, (c) => {
    const { preset } = c.req.valid("query");
    const today = now();
    const year = today.getUTCFullYear();
    const created = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`;
    const body = holidayCalendarText(preset, {
      years: [year, year + 1],
      created,
    });
    let hash = 2166136261;
    for (const char of body)
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    const etag = `"${preset}-${hash.toString(16)}"`;
    c.header("ETag", etag);
    if (!options.apiKeys?.length)
      c.header("Cache-Control", "public, max-age=21600");
    if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
    c.header(
      "Content-Disposition",
      `inline; filename="tzmeet-holidays-${preset}.ics"`,
    );
    return c.text(body, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
    });
  });
  app.openapi(getBadge, (c) => {
    const query = c.req.valid("query");
    const [workStart, workEnd] = (query.w ?? "09:00-18:00").split("-") as [
      string,
      string,
    ];
    const shift = (time: string, minutes: number) => {
      const [hours, mins] = time.split(":").map(Number) as [number, number];
      const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440;
      return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    };
    const rule = {
      id: query.z,
      workStart,
      workEnd,
      quietBefore: shift(workStart, -60),
      quietAfter: shift(workEnd, 60),
      ...(query.d !== undefined
        ? { weekend: [...new Set([...query.d].map(Number))].sort() }
        : {}),
      ...(query.h ? { holidayPreset: query.h } : {}),
    };
    const checked = zoneSchema.safeParse(rule);
    if (!checked.success) {
      const parameter: Record<string, string> = {
        id: "z",
        workStart: "w",
        workEnd: "w",
        quietBefore: "w",
        quietAfter: "w",
        weekend: "d",
        holidayPreset: "h",
      };
      throw validationError(
        new z.ZodError(
          checked.error.issues.map((issue) => ({
            ...issue,
            path: [parameter[String(issue.path[0])] ?? "z"],
          })),
        ),
        query,
      );
    }
    const status = availabilityNow(rule, now());
    if (!options.apiKeys?.length)
      c.header(
        "Cache-Control",
        "public, max-age=300, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400",
      );
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    return c.body(
      badgeSvg({
        label:
          query.n ||
          (query.z === "UTC"
            ? "UTC"
            : query.z.split("/").at(-1)!.replaceAll("_", " ")),
        status: status.status,
        ...(status.holiday ? { holiday: status.holiday } : {}),
        zone: query.z,
      }),
      200,
      { "Content-Type": "image/svg+xml; charset=utf-8" },
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
      ["/v1/cron/convert", "cronConvert"],
      ["/v1/cron/natural", "cronNatural"],
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
