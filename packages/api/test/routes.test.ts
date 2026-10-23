import { describe, expect, it } from "vitest";
import {
  explainCron,
  convertCronZone,
  parseNaturalCron,
  findSlots,
  parseScheduleInput,
  recurringImpact,
  type FindSlotsInput,
} from "@tzmeet/core";
import { API_VERSION, createApp } from "../src/app.js";
import {
  conversionResultSchema,
  cronResultSchema,
  cronConvertResultSchema,
  cronNaturalResultSchema,
  errorSchema,
  recurringResultSchema,
  healthSchema,
  slotsResultSchema,
} from "../src/schemas.js";

const clock = () => new Date("2026-10-14T12:00:00.000Z");
const app = createApp({
  now: clock,
  log: () => {},
  rateLimit: { limit: 10000 },
});
const input: FindSlotsInput = {
  zones: [
    { id: "Asia/Dhaka", weekend: [5, 6] },
    { id: "America/New_York" },
    { id: "Europe/London" },
  ],
  startDate: "2026-11-02",
  days: 1,
  durationMinutes: 30,
  stepMinutes: 30,
};
const post = (body: unknown, query = "") =>
  app.request(`/v1/slots${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const queryUrl = (path: string, query: Record<string, string>) =>
  `${path}?${new URLSearchParams(query)}`;

async function publicError(response: Response, status = 400) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Type")).toContain("application/json");
  const body = errorSchema.parse(await response.json());
  expect(body).not.toHaveProperty("stack");
  return body.error;
}

describe("stateless JSON routes (in-process app.request only)", () => {
  it("returns fixed-clock health and zones snapshots", async () => {
    const health = await app.request("/v1/health");
    expect(health.status).toBe(200);
    expect(healthSchema.parse(await health.json())).toMatchSnapshot();
    const zones = await app.request("/v1/zones?search=dhaka");
    expect(zones.status).toBe(200);
    expect(await zones.json()).toMatchSnapshot();
  });
  it("POST is exactly core scheduling output with only top/envelope added", async () => {
    const response = await post(input, "?top=2");
    expect(response.status).toBe(200);
    const body = slotsResultSchema.parse(await response.json());
    const core = findSlots(input);
    expect(body.slots).toEqual(core.slots.slice(0, 2));
    expect(body.diagnostics).toEqual(core.diagnostics);
    expect(body.meta).toEqual({
      count: 2,
      generatedAt: clock().toISOString(),
      version: API_VERSION,
    });
    expect(body).toMatchSnapshot();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("GET shares the CLI parser, including repeated zoneWork/weekend and global prayers", async () => {
    const options = {
      zones: "Asia/Dhaka,Europe/London",
      date: "2026-11-02",
      days: "1",
      duration: "30",
      step: "30",
      work: "09:00-18:00",
      quiet: "07:00-22:00",
      zoneWork: ["Asia/Dhaka=09:00-17:00", "Europe/London=10:00-18:00"],
      weekend: ["Asia/Dhaka=fri,sat", "Europe/London=sat,sun"],
      prayerLocation: "Dhaka",
      prayerMethod: "MWL",
      prayerBuffer: "5",
    };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) {
      for (const item of Array.isArray(value) ? value : [value])
        query.append(key, item);
    }
    query.set("top", "2");
    const response = await app.request(`/v1/slots?${query}`);
    expect(response.status).toBe(200);
    const body = slotsResultSchema.parse(await response.json());
    const core = findSlots(parseScheduleInput(options));
    expect(body.slots).toEqual(core.slots.slice(0, 2));
    expect(body.diagnostics).toEqual(core.diagnostics);
    expect(body).toMatchSnapshot();
  });
  it("preserves per-zone prayer/work/weekend rules and global fallback exactly", async () => {
    const body: FindSlotsInput = {
      ...input,
      zones: [
        {
          id: "Asia/Dhaka",
          label: "Home",
          weekend: [],
          workStart: "10:00",
          workEnd: "17:00",
          quietBefore: "07:00",
          quietAfter: "22:00",
          prayer: { location: "Dhaka", method: "MWL", bufferMinutes: 15 },
        },
        {
          id: "Europe/London",
          label: "Office",
          prayer: {
            location: "London",
            method: "NorthAmerica",
            bufferMinutes: 5,
          },
        },
      ],
      prayer: { location: "Dhaka", method: "Karachi", bufferMinutes: 10 },
    };
    const response = await post(body, "?top=50");
    expect(response.status).toBe(200);
    const result = slotsResultSchema.parse(await response.json());
    const core = findSlots(body);
    expect(result.slots).toEqual(core.slots.slice(0, 50));
    expect(result.diagnostics).toEqual(core.diagnostics);
  });
  it("treats no available slots as 200 with empty results and diagnostics", async () => {
    const response = await post({
      zones: [{ id: "Asia/Dhaka" }],
      startDate: "2026-10-30",
      days: 1,
    });
    expect(response.status).toBe(200);
    const body = slotsResultSchema.parse(await response.json());
    expect(body.slots).toEqual([]);
    expect(body.meta.count).toBe(0);
    expect(body.diagnostics.mostRestrictive?.constraint).toBe("weekend");
    expect(body).toMatchSnapshot();
  });
  it("returns the requested conversion snapshot", async () => {
    const response = await app.request(
      queryUrl("/v1/convert", {
        time: "2026-11-02T10:00",
        from: "Asia/Dhaka",
        to: "Europe/London,America/New_York",
      }),
    );
    expect(response.status).toBe(200);
    expect(
      conversionResultSchema.parse(await response.json()),
    ).toMatchSnapshot();
  });
  it.each([
    ["2026-03-23T10:00", 0, -240],
    ["2026-03-30T10:00", 60, -240],
    ["2026-10-26T10:00", 0, -240],
    ["2026-11-02T10:00", 0, -300],
  ])(
    "converts mismatched Dhaka/NY/London DST dates: %s",
    async (time, london, ny) => {
      const response = await app.request(
        queryUrl("/v1/convert", {
          time,
          from: "Asia/Dhaka",
          to: "Europe/London,America/New_York",
        }),
      );
      expect(response.status).toBe(200);
      const body = conversionResultSchema.parse(await response.json());
      expect(body.conversions.map((zone) => zone.offsetMinutes)).toEqual([
        london,
        ny,
      ]);
    },
  );
  it("resolves an ambiguous fold explicitly, but rejects folds and gaps by default", async () => {
    const options = {
      time: "2026-11-01T01:30",
      from: "America/New_York",
      to: "UTC",
    };
    expect(
      (await publicError(await app.request(queryUrl("/v1/convert", options))))
        .details,
    ).toContainEqual(
      expect.objectContaining({
        field: "time",
        message: expect.stringContaining("ambiguous"),
      }),
    );
    const earlier = await app.request(
      queryUrl("/v1/convert", { ...options, disambiguation: "earlier" }),
    );
    expect(conversionResultSchema.parse(await earlier.json()).utc).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    const later = await app.request(
      queryUrl("/v1/convert", { ...options, disambiguation: "later" }),
    );
    expect(conversionResultSchema.parse(await later.json()).utc).toBe(
      "2026-11-01T06:30:00.000Z",
    );
    expect(
      (
        await publicError(
          await app.request(
            queryUrl("/v1/convert", { ...options, time: "2026-03-08T02:30" }),
          ),
        )
      ).message,
    ).toContain("does not exist");
  });
  it("generates OpenAPI from the shared schemas", async () => {
    const response = await app.request("/openapi.json");
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      openapi: "3.0.3",
      info: { title: "tzmeet REST API", version: API_VERSION },
      paths: {
        "/v1/slots": { get: {}, post: {} },
        "/v1/convert": { get: {} },
        "/v1/zones": { get: {} },
        "/v1/health": { get: {} },
      },
    });
  });
});

describe("holidays over HTTP", () => {
  it("accepts repeated GET holiday parameters and POST holidays, returning holiday diagnostics", async () => {
    const get = await app.request(
      "/v1/slots?zones=Asia/Dhaka,Europe/London&date=2026-12-16&days=1&holiday=Asia/Dhaka=2026-12-16",
    );
    expect(get.status).toBe(200);
    const body = slotsResultSchema.parse(await get.json());
    expect(body.slots).toEqual([]);
    expect(body.diagnostics.mostRestrictive?.constraint).toBe("holiday");
    const viaPost = await post({
      zones: [
        { id: "Asia/Dhaka", holidays: ["2026-12-16"] },
        { id: "Europe/London" },
      ],
      startDate: "2026-12-16",
      days: 1,
    });
    expect(
      slotsResultSchema.parse(await viaPost.json()).diagnostics.mostRestrictive
        ?.constraint,
    ).toBe("holiday");
  });
});

describe("precise, sanitized transport errors", () => {
  it("suggests unknown zones with bracket-indexed POST fields and no duplicate prefixes", async () => {
    const error = await publicError(
      await post({ ...input, zones: [{ id: "UTC" }, { id: "Asia/Dhka" }] }),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details).toEqual([
      {
        field: "zones[1].id",
        message:
          "'Asia/Dhka' is not a valid IANA time zone. Did you mean 'Asia/Dhaka'?",
        suggestion: "Asia/Dhaka",
      },
    ]);
    expect(error.message).toBe(
      "zones[1].id: 'Asia/Dhka' is not a valid IANA time zone. Did you mean 'Asia/Dhaka'?",
    );
  });
  it("gives the same precise unknown-zone suggestion on GET", async () => {
    const error = await publicError(
      await app.request("/v1/slots?zones=UTC,Asia/Dhka&date=2026-11-02"),
    );
    expect(error.details).toContainEqual(
      expect.objectContaining({
        field: "zones[1].id",
        suggestion: "Asia/Dhaka",
      }),
    );
  });
  it("suggests conversion source/destination typos", async () => {
    const source = await publicError(
      await app.request(
        queryUrl("/v1/convert", {
          time: "2026-11-02T10:00",
          from: "Asia/Dhka",
          to: "UTC",
        }),
      ),
    );
    expect(source.details).toContainEqual(
      expect.objectContaining({ field: "from", suggestion: "Asia/Dhaka" }),
    );
    const destination = await publicError(
      await app.request(
        queryUrl("/v1/convert", {
          time: "2026-11-02T10:00",
          from: "UTC",
          to: "Europe/London,Asia/Dhka",
        }),
      ),
    );
    expect(destination.details).toContainEqual(
      expect.objectContaining({ field: "to[1]", suggestion: "Asia/Dhaka" }),
    );
  });
  it.each([
    ["days", 15],
    ["stepMinutes", 4],
    ["durationMinutes", 4],
    ["durationMinutes", 481],
  ])("enforces API-only POST limits for %s=%s", async (field, value) => {
    const error = await publicError(await post({ ...input, [field]: value }));
    expect(error.details).toContainEqual(expect.objectContaining({ field }));
  });
  it.each([
    ["days", "15"],
    ["days", "0"],
    ["step", "4"],
    ["duration", "481"],
    ["duration", "4"],
    ["top", "51"],
    ["top", "0"],
    ["top", "2.5"],
    ["days", "1e1"],
  ])(
    "enforces exact GET field bounds/syntax for %s=%s",
    async (field, value) => {
      const error = await publicError(
        await app.request(
          queryUrl("/v1/slots", {
            zones: "UTC",
            date: "2026-11-02",
            [field]: value,
          }),
        ),
      );
      expect(error.details).toContainEqual(expect.objectContaining({ field }));
    },
  );
  it("caps participants and conversion destinations at eight", async () => {
    const ids = [
      "UTC",
      "Asia/Dhaka",
      "Europe/London",
      "America/New_York",
      "Asia/Tokyo",
      "Australia/Sydney",
      "Europe/Paris",
      "Asia/Singapore",
      "Asia/Dubai",
    ];
    expect(
      (
        await publicError(
          await post({ ...input, zones: ids.map((id) => ({ id })) }),
        )
      ).details,
    ).toContainEqual(
      expect.objectContaining({
        field: "zones",
        message: "zones must contain at most 8 participants",
      }),
    );
    expect(
      (
        await publicError(
          await app.request(
            queryUrl("/v1/slots", { zones: ids.join(","), date: "2026-11-02" }),
          ),
        )
      ).details,
    ).toContainEqual(
      expect.objectContaining({
        field: "zones",
        message: "zones must contain at most 8 participants",
      }),
    );
    expect(
      (
        await publicError(
          await app.request(
            queryUrl("/v1/convert", {
              time: "2026-11-02T10:00",
              from: "UTC",
              to: ids.join(","),
            }),
          ),
        )
      ).details,
    ).toContainEqual(
      expect.objectContaining({
        field: "to",
        message: "to must contain at most 8 destination zones",
      }),
    );
  });
  it("does not leak the library’s higher zone cap into API errors", async () => {
    const tooMany = Array.from({ length: 21 }, () => ({ id: "UTC" }));
    expect(
      (await publicError(await post({ ...input, zones: tooMany }))).details,
    ).toEqual([
      { field: "zones", message: "zones must contain at most 8 participants" },
    ]);
    expect(
      (
        await publicError(
          await app.request(
            queryUrl("/v1/convert", {
              time: "2026-11-02T10:00",
              from: "UTC",
              to: tooMany.map((zone) => zone.id).join(","),
            }),
          ),
        )
      ).details,
    ).toEqual([
      { field: "to", message: "to must contain at most 8 destination zones" },
    ]);
  });
  it("maps CLI flag errors to actual GET query field names", async () => {
    const error = await publicError(
      await app.request(
        queryUrl("/v1/slots", {
          zones: "UTC",
          date: "2026-11-02",
          zoneWork: "Europe/London=09:00-17:00",
        }),
      ),
    );
    expect(error.details).toEqual([
      {
        field: "zoneWork",
        message:
          "Europe/London is not a selected zone; add it with --zones first",
      },
    ]);
    expect(error.message).not.toContain("zone-work:");
  });
  it("requires a date, rejects civil date skips, and rejects duplicate zones", async () => {
    expect(
      (await publicError(await app.request("/v1/slots?zones=UTC"))).details,
    ).toContainEqual(expect.objectContaining({ field: "date" }));
    expect(
      (
        await publicError(
          await post({
            zones: [{ id: "Pacific/Apia" }],
            startDate: "2011-12-30",
          }),
        )
      ).details,
    ).toContainEqual(
      expect.objectContaining({
        field: "startDate",
        message: "This civil date does not exist in the first zone",
      }),
    );
    expect(
      (
        await publicError(
          await post({ ...input, zones: [{ id: "UTC" }, { id: "UTC" }] }),
        )
      ).message,
    ).toContain("unique");
  });
  it("rejects unknown fields instead of silently accepting them", async () => {
    expect(
      (await publicError(await post({ ...input, typo: 1 }))).details,
    ).toContainEqual({ field: "typo", message: "Unknown field" });
    expect(
      (
        await publicError(
          await app.request("/v1/slots?zones=UTC&date=2026-11-02&typo=1"),
        )
      ).details,
    ).toContainEqual({ field: "typo", message: "Unknown field" });
  });
  it("uses clear JSON/content-type errors and rejects non-object JSON", async () => {
    const malformed = await app.request("/v1/slots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect((await publicError(malformed)).code).toBe("INVALID_JSON");
    const wrongType = await app.request("/v1/slots", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(input),
    });
    expect((await publicError(wrongType)).code).toBe(
      "UNSUPPORTED_CONTENT_TYPE",
    );
    expect((await publicError(await post(null))).details).toContainEqual(
      expect.objectContaining({ field: "body" }),
    );
  });
  it("returns JSON 404, JSON 405 with Allow, and valid empty HEAD responses", async () => {
    expect((await publicError(await app.request("/unknown"), 404)).code).toBe(
      "NOT_FOUND",
    );
    const response = await app.request("/v1/slots", { method: "PUT" });
    expect((await publicError(response, 405)).code).toBe("METHOD_NOT_ALLOWED");
    expect(response.headers.get("Allow")).toBe("GET, POST, HEAD");
    const head = await app.request("/v1/health", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
  it("never leaks unexpected exception messages or stacks", async () => {
    const broken = createApp({
      now: () => {
        throw new Error("PRIVATE_INTERNAL_TOKEN stack /secret/path");
      },
      log: () => {},
    });
    const response = await broken.request("/v1/zones?search=dhaka");
    const error = await publicError(response, 500);
    expect(error).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  });
  it("rejects unknown output formats", async () => {
    expect(
      (await publicError(await post(input, "?format=xml"))).details,
    ).toContainEqual(expect.objectContaining({ field: "format" }));
  });
});

describe("cron over HTTP", () => {
  const cron = (query: Record<string, string>) =>
    app.request(queryUrl("/v1/cron", query));

  it("returns core explainCron output, with display zones", async () => {
    const query = {
      expression: "30 2 * * *",
      zone: "America/New_York",
      from: "2027-03-12T00:00:00Z",
      count: "3",
      display: "Asia/Dhaka,UTC",
    };
    const response = await cron(query);
    expect(response.status).toBe(200);
    const body = cronResultSchema.parse(await response.json());
    expect(body).toEqual(
      explainCron({
        expression: "30 2 * * *",
        zone: "America/New_York",
        from: "2027-03-12T00:00:00Z",
        count: 3,
        displayZones: ["Asia/Dhaka", "UTC"],
      }),
    );
    expect(body.runs[2]).toMatchObject({
      local: "2027-03-14T03:00:00.000-04:00",
      note: "gap-catch-up",
    });
    expect(body.warnings.map((warning) => warning.code)).toContain("dst-late");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("defaults from to the injected clock and count to 10, and is not cached", async () => {
    const response = await cron({
      expression: "0 0 * * *",
      dialect: "kubernetes",
    });
    expect(response.status).toBe(200);
    const body = cronResultSchema.parse(await response.json());
    expect(body.runs).toHaveLength(10);
    expect(body.runs[0]!.utc).toBe("2026-10-15T00:00:00.000Z");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    [
      { expression: "0 99 * * *" },
      "expression.hour",
      "hour must be 0–23, got 99",
    ],
    [
      { expression: "0 0 * * *", count: "51" },
      "count",
      "count must be at most 50",
    ],
    [
      { expression: "0 0 * * *", dialect: "cronie" },
      "dialect",
      expect.any(String),
    ],
    [
      { expression: "0 0 * * *", display: "UTC,UTC" },
      "display",
      "Display zones must be unique",
    ],
    [
      {
        expression: "0 0 * * *",
        display: Array.from({ length: 9 }, () => "UTC").join(","),
      },
      "display",
      "display must contain at most 8 zones",
    ],
    [
      { expression: "0 0 * * *", from: "tomorrow" },
      "from",
      expect.stringContaining("ISO instant"),
    ],
  ])("rejects %j", async (query, field, message) => {
    const error = await publicError(
      await cron(query as Record<string, string>),
    );
    expect(error.details).toContainEqual(
      expect.objectContaining({ field, message }),
    );
  });

  it("suggests a zone for a typo in display", async () => {
    const error = await publicError(
      await cron({ expression: "0 0 * * *", display: "UTC,Asia/Dhka" }),
    );
    expect(error.details).toContainEqual({
      field: "display",
      message:
        "'Asia/Dhka' is not a valid IANA time zone. Did you mean 'Asia/Dhaka'?",
      suggestion: "Asia/Dhaka",
    });
  });

  it("only allows GET and HEAD", async () => {
    const response = await app.request("/v1/cron?expression=@daily", {
      method: "POST",
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });
});

describe("recurring meetings over HTTP", () => {
  const recurring = (query: Record<string, string | string[]>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      for (const item of Array.isArray(value) ? value : [value])
        params.append(key, item);
    return app.request(`/v1/recurring?${params}`);
  };

  it("returns core recurringImpact output, sharing the slots query parser", async () => {
    const response = await recurring({
      zones: "Europe/London,Asia/Dhaka",
      date: "2026-10-19",
      time: "15:00",
      weeks: "3",
      duration: "45",
      quiet: "08:00-21:00",
      weekend: "Asia/Dhaka=fri,sat",
    });
    expect(response.status).toBe(200);
    const body = recurringResultSchema.parse(await response.json());
    expect(body).toEqual(
      recurringImpact({
        zones: [
          { id: "Europe/London", quietBefore: "08:00", quietAfter: "21:00" },
          {
            id: "Asia/Dhaka",
            quietBefore: "08:00",
            quietAfter: "21:00",
            weekend: [5, 6],
          },
        ],
        startDate: "2026-10-19",
        time: "15:00",
        weeks: 3,
        durationMinutes: 45,
      }),
    );
    expect(
      body.periods.map((period) => [
        period.from,
        period.zones[1]!.localTime,
        period.zones[1]!.classification,
      ]),
    ).toEqual([
      ["2026-10-19", "20:00", "acceptable"],
      ["2026-10-26", "21:00", "blocked"],
    ]);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("defaults to 26 weeks", async () => {
    const body = recurringResultSchema.parse(
      await (
        await recurring({ zones: "UTC", date: "2026-10-19", time: "09:00" })
      ).json(),
    );
    expect(body.occurrences).toHaveLength(26);
  });

  it.each([
    [{ zones: "UTC", date: "2026-10-19" }, "time"],
    [{ zones: "UTC", date: "2026-10-19", time: "9am" }, "time"],
    [{ zones: "UTC", date: "2026-10-19", time: "09:00", weeks: "53" }, "weeks"],
    [{ zones: "UTC", time: "09:00" }, "date"],
    [
      { zones: "UTC,Asia/Dhka", date: "2026-10-19", time: "09:00" },
      "zones[1].id",
    ],
    [{ zones: "UTC", date: "2026-10-19", time: "09:00", top: "5" }, "top"],
  ])("rejects %j", async (query, field) => {
    const error = await publicError(await recurring(query));
    expect(error.details).toContainEqual(expect.objectContaining({ field }));
  });
});

describe("holiday presets over HTTP", () => {
  it("applies repeated holidayPreset parameters on GET and per-zone presets on POST", async () => {
    const base = "zones=Asia/Dhaka,Europe/London&date=2026-12-16&days=1";
    const open = slotsResultSchema.parse(
      await (await app.request(`/v1/slots?${base}`)).json(),
    );
    expect(open.slots.length).toBeGreaterThan(0);
    const blocked = slotsResultSchema.parse(
      await (
        await app.request(`/v1/slots?${base}&holidayPreset=Asia/Dhaka=BD`)
      ).json(),
    );
    expect(blocked.slots).toEqual([]);
    expect(blocked.diagnostics.mostRestrictive).toMatchObject({
      zoneId: "Asia/Dhaka",
      constraint: "holiday",
    });
    const posted = slotsResultSchema.parse(
      await (
        await post({
          zones: [
            { id: "Asia/Dhaka", holidayPreset: "BD" },
            { id: "Europe/London" },
          ],
          startDate: "2026-12-16",
          days: 1,
        })
      ).json(),
    );
    expect(posted.slots).toEqual([]);
  });

  it("applies presets to recurring meetings", async () => {
    const body = recurringResultSchema.parse(
      await (
        await app.request(
          "/v1/recurring?zones=Europe/London,Asia/Dhaka&date=2026-12-09&time=10:00&weeks=2&holidayPreset=Asia/Dhaka=BD",
        )
      ).json(),
    );
    expect(
      body.periods.map((period) => period.zones[1]!.classification),
    ).toEqual(["ideal", "blocked"]);
  });

  it("rejects unknown presets with the parameter name", async () => {
    const error = await publicError(
      await app.request(
        "/v1/slots?zones=UTC&date=2026-12-16&holidayPreset=UTC=FR",
      ),
    );
    expect(error.details).toEqual([
      {
        field: "holidayPreset",
        message:
          'Unknown holiday preset "FR"; use BD, GB-ENG, IN, PK, AE, US or none',
      },
    ]);
  });
});

describe("busy times over HTTP", () => {
  it("blocks POSTed busy intervals and reports them in diagnostics", async () => {
    const response = await post({
      zones: [
        {
          id: "UTC",
          weekend: [],
          busy: [
            { start: "2026-11-02T00:00:00Z", end: "2026-11-03T00:00:00Z" },
          ],
        },
        { id: "Europe/London" },
      ],
      startDate: "2026-11-02",
      days: 1,
    });
    expect(response.status).toBe(200);
    const body = slotsResultSchema.parse(await response.json());
    expect(body.slots).toEqual([]);
    expect(body.diagnostics.mostRestrictive).toMatchObject({
      zoneId: "UTC",
      constraint: "busy",
    });
  });

  it("validates busy intervals with their path", async () => {
    const error = await publicError(
      await post({
        zones: [
          {
            id: "UTC",
            busy: [
              { start: "2026-11-02T11:00:00Z", end: "2026-11-02T10:00:00Z" },
            ],
          },
        ],
        startDate: "2026-11-02",
      }),
    );
    expect(error.details).toContainEqual({
      field: "zones[0].busy[0].end",
      message: "end must be after start",
    });
  });
});

describe("special hours and rotation over HTTP", () => {
  const pair =
    "zones=UTC,Asia/Tokyo&date=2026-11-02&days=1&step=60&weekend=UTC=none&weekend=Asia/Tokyo=none&work=09:00-17:00&quiet=07:00-21:00";

  it("adds a rotation to JSON only when asked, using every slot found", async () => {
    const plain = slotsResultSchema.parse(
      await (await app.request(`/v1/slots?${pair}&top=1`)).json(),
    );
    expect(plain).not.toHaveProperty("rotation");
    const body = slotsResultSchema.parse(
      await (await app.request(`/v1/slots?${pair}&top=1&rotation=2`)).json(),
    );
    expect(body.slots).toHaveLength(1);
    expect(body.rotation).toMatchObject({
      size: 2,
      zones: [
        { id: "UTC", inconvenientTurns: 1 },
        { id: "Asia/Tokyo", inconvenientTurns: 1 },
      ],
    });
    const posted = slotsResultSchema.parse(
      await (
        await post(
          {
            zones: [{ id: "Europe/London" }, { id: "Europe/Paris" }],
            startDate: "2026-11-02",
            days: 1,
          },
          "?rotation=3",
        )
      ).json(),
    );
    expect(posted.rotation).toMatchObject({ size: 1 });
  });

  it("applies ramadan and specialHours query parameters", async () => {
    const classification = async (extra: string) => {
      const body = slotsResultSchema.parse(
        await (
          await app.request(
            `/v1/slots?zones=Asia/Dhaka,Europe/London&date=2027-02-10&days=1&step=60&top=50${extra}`,
          )
        ).json(),
      );
      return body.slots.find((slot) => slot.start.includes("T10:00"))!.zones[0]!
        .classification;
    };
    expect(await classification("")).toBe("ideal");
    expect(await classification("&ramadan=Asia/Dhaka=09:00-15:30")).toBe(
      "acceptable",
    );
    expect(
      await classification(
        "&specialHours=Asia/Dhaka=2027-02-01..2027-02-28@09:00-14:00",
      ),
    ).toBe("acceptable");
  });

  it.each([
    ["/v1/slots?zones=UTC&date=2026-11-02&rotation=4", "rotation"],
    [
      "/v1/slots?zones=UTC&date=2026-11-02&specialHours=UTC=bad",
      "specialHours",
    ],
    [
      "/v1/recurring?zones=UTC&date=2026-11-02&time=09:00&rotation=2",
      "rotation",
    ],
  ])("rejects %s", async (url, field) => {
    const error = await publicError(await app.request(url));
    expect(error.details).toContainEqual(expect.objectContaining({ field }));
  });
});

describe("optional attendees over HTTP", () => {
  it("accepts optional zones on GET and POST", async () => {
    const query =
      "zones=Europe/London,Asia/Dhaka,America/New_York&date=2026-11-02&days=1&step=60&top=50";
    const required = slotsResultSchema.parse(
      await (await app.request(`/v1/slots?${query}`)).json(),
    );
    const optional = slotsResultSchema.parse(
      await (
        await app.request(`/v1/slots?${query}&optional=America/New_York`)
      ).json(),
    );
    expect(optional.slots.length).toBeGreaterThan(required.slots.length);
    expect(
      optional.slots.some(
        (slot) =>
          slot.zones[2]!.classification === "blocked" &&
          slot.zones[2]!.optional,
      ),
    ).toBe(true);
    const posted = slotsResultSchema.parse(
      await (
        await post({
          zones: [
            { id: "Europe/London" },
            { id: "America/New_York", optional: true },
          ],
          startDate: "2026-11-02",
          days: 1,
        })
      ).json(),
    );
    expect(posted.slots[0]!.zones[1]!.optional).toBe(true);
  });
});

describe("cron conversion over HTTP", () => {
  const convert = (query: Record<string, string>) =>
    app.request(`/v1/cron/convert?${new URLSearchParams(query)}`);

  it("converts syntax and time zone, matching core", async () => {
    const response = await convert({
      expression: "0 9 * * 1-5",
      to: "quartz",
      zone: "Asia/Dhaka",
      toZone: "UTC",
      from: "2026-10-23T00:00:00Z",
    });
    expect(response.status).toBe(200);
    const body = cronConvertResultSchema.parse(await response.json());
    expect(body.dialect!.expressions).toEqual(["0 0 9 ? * MON-FRI"]);
    expect(body.zone).toEqual(
      convertCronZone({
        expression: "0 9 * * 1-5",
        fromZone: "Asia/Dhaka",
        toZone: "UTC",
        from: "2026-10-23T00:00:00Z",
      }),
    );
  });

  it("returns only what was asked for", async () => {
    const body = cronConvertResultSchema.parse(
      await (
        await convert({
          expression: "0 0 0 13 * FRI",
          dialect: "spring",
          to: "unix",
        })
      ).json(),
    );
    expect(body.zone).toBeUndefined();
    expect(body.dialect).toMatchObject({
      expressions: [],
      problems: [expect.stringContaining("can't require both")],
    });
  });

  it.each([
    [{ expression: "0 9 * * *" }, "to"],
    [{ expression: "0 9 * * *", to: "cronie" }, "to"],
    [{ expression: "0 99 * * *", to: "quartz" }, "expression.hour"],
    [{ expression: "0 9 * * *", toZone: "Mars/Base" }, "toZone"],
  ])("rejects %j", async (query, field) => {
    const error = await publicError(await convert(query));
    expect(error.details).toContainEqual(expect.objectContaining({ field }));
  });
});

describe("plain-English cron over HTTP", () => {
  it("translates text, matching core", async () => {
    const response = await app.request(
      `/v1/cron/natural?${new URLSearchParams({ text: "every weekday at 9am Dhaka", dialect: "kubernetes" })}`,
    );
    expect(response.status).toBe(200);
    const body = cronNaturalResultSchema.parse(await response.json());
    expect(body).toEqual(
      parseNaturalCron("every weekday at 9am Dhaka", { dialect: "kubernetes" }),
    );
    expect(body).toMatchObject({
      expressions: ["0 9 * * 1-5"],
      zone: "Asia/Dhaka",
    });
  });

  it("returns problems for text it can't translate, and validates input", async () => {
    const body = cronNaturalResultSchema.parse(
      await (
        await app.request("/v1/cron/natural?text=every+other+monday")
      ).json(),
    );
    expect(body.expressions).toEqual([]);
    expect(body.problems[0]).toContain("every other monday");
    expect(
      (await publicError(await app.request("/v1/cron/natural"))).details,
    ).toContainEqual(expect.objectContaining({ field: "text" }));
  });
});

describe("recurring series as .ics over HTTP", () => {
  it("returns the weekly series as a calendar file", async () => {
    const response = await app.request(
      "/v1/recurring?zones=Europe/London,America/New_York&date=2026-10-12&time=14:00&weeks=10&format=ics",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/calendar");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="tzmeet-weekly-2026-10-12.ics"',
    );
    const text = await response.text();
    expect(text).toContain("DTSTART;TZID=Europe/London:20261012T140000\r\n");
    expect(text).toContain("RRULE:FREQ=WEEKLY;COUNT=10\r\n");
    expect(text).toContain(
      `DTSTAMP:${clock().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    );
  });
});
