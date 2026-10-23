import { describe, expect, it } from "vitest";
import SwaggerParser from "@apidevtools/swagger-parser";
import ICAL from "ical.js";
import { createApp } from "../src/app.js";
import { findSlots } from "@tzmeet/core";
import { inviteText as webInviteText } from "../../../apps/web/src/invite.js";
import {
  conversionResultSchema,
  healthSchema,
  slotsResultSchema,
  cronResultSchema,
} from "../src/schemas.js";
type Document = ReturnType<ReturnType<typeof createApp>["getOpenAPIDocument"]>;
const app = createApp({
  log: () => {},
  now: () => new Date("2026-10-14T12:00:00Z"),
});
const input = {
  zones: [
    { id: "Asia/Dhaka", label: "Dhaka, বাংলা; \\ office" },
    { id: "Europe/London", label: "London" },
  ],
  startDate: "2026-11-02",
  days: 1,
  stepMinutes: 30,
  durationMinutes: 30,
};
const post = (format: string, body = input) =>
  app.request(`/v1/slots?top=2&format=${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
describe("shared formats and generated documentation", () => {
  it("returns exact browser-invite text for each selected slot", async () => {
    const response = await post("text");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toBe(
      findSlots(input).slots.slice(0, 2).map(webInviteText).join("\n\n"),
    );
  });
  it("parses multi-event ICS with exact UTC starts/ends, tentative status and escaped Unicode descriptions", async () => {
    const response = await post("ics");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/calendar");
    expect(response.headers.get("Content-Disposition")).toContain(".ics");
    const text = await response.text();
    for (const line of text.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const calendar = new ICAL.Component(ICAL.parse(text));
    const components = calendar.getAllSubcomponents("vevent");
    expect(components).toHaveLength(2);
    const core = findSlots(input).slots.slice(0, 2);
    components.forEach((component, i) => {
      const event = new ICAL.Event(component);
      expect(event.startDate.toJSDate().toISOString()).toBe(core[i]!.start);
      expect(event.endDate.toJSDate().toISOString()).toBe(core[i]!.end);
      expect(component.getFirstPropertyValue("status")).toBe("TENTATIVE");
      expect(component.getFirstPropertyValue("description")).toBe(
        webInviteText(core[i]!),
      );
    });
    expect(
      new Set(components.map((c) => c.getFirstPropertyValue("uid"))).size,
    ).toBe(2);
  });
  it("supports GET formats and empty calendars/text without treating no slots as an error", async () => {
    const ics = await app.request(
      "/v1/slots?zones=Asia/Dhaka&date=2026-10-30&days=1&format=ics",
    );
    expect(ics.status).toBe(200);
    expect(
      new ICAL.Component(ICAL.parse(await ics.text())).getAllSubcomponents(
        "vevent",
      ),
    ).toHaveLength(0);
    const text = await app.request(
      "/v1/slots?zones=Asia/Dhaka&date=2026-10-30&days=1&format=text",
    );
    expect(text.status).toBe(200);
    expect(await text.text()).toContain("weekend");
  });
  it("validates the entire generated OpenAPI document without remote resolution", async () => {
    const response = await app.request("/openapi.json");
    const document = await response.json();
    const validated = (await SwaggerParser.validate(document, {
      resolve: { http: false, file: false },
    })) as unknown as Document;
    expect(validated.openapi).toBe("3.0.3");
    expect(Object.keys(validated.paths)).toHaveLength(10);
    const slots = validated.paths["/v1/slots"]!.post!;
    const ok = slots.responses["200"];
    expect(ok && "content" in ok ? Object.keys(ok.content ?? {}) : []).toEqual([
      "application/json",
      "text/plain",
      "text/calendar",
    ]);
  });
  it("provides valid request/response examples and conditional authentication schemes", async () => {
    const secured = createApp({ log: () => {}, apiKeys: ["test-key"] });
    const document = (await SwaggerParser.dereference(
      await (await secured.request("/openapi.json")).json(),
      { resolve: { http: false, file: false } },
    )) as unknown as Document;
    const schemas = {
      "/v1/slots": slotsResultSchema,
      "/v1/convert": conversionResultSchema,
      "/v1/cron": cronResultSchema,
      "/v1/health": healthSchema,
    };
    for (const [path, schema] of Object.entries(schemas)) {
      const operation = document.paths[path]!.get!;
      const ok = operation.responses["200"];
      if (!ok || !("content" in ok)) throw new Error("Missing JSON example");
      expect(
        schema.safeParse(ok.content?.["application/json"]?.example).success,
      ).toBe(true);
    }
    expect(document.paths["/v1/slots"]!.get!.security).toEqual([
      { BearerAuth: [] },
      { ApiKeyAuth: [] },
    ]);
    expect(document.paths["/v1/health"]!.get!.security).toBeUndefined();
  });
  it("serves Scalar docs with a pinned script and same-origin schema URL, without persisting keys", async () => {
    const response = await app.request("/docs");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("/openapi.json");
    expect(html).toContain("@scalar/api-reference@1.74.0");
    expect(html).toContain("persistAuth");
    expect(html).toContain("false");
  });
});
