import { describe, expect, it } from "vitest";
import {
  badgePreview,
  badgeSnippets,
  badgeUrl,
  type MeState,
} from "../src/me-state";

const zahid: MeState = {
  name: "Zahid",
  zone: "Asia/Dhaka",
  workStart: "09:00",
  workEnd: "18:00",
  weekend: [5, 6],
  holidayPreset: "BD",
};
const href = "https://example.github.io/tzmeet/#/me";

describe("status badge", () => {
  it("uses the same parameters as the My hours link", () => {
    expect(badgeUrl(zahid)).toBe(
      "https://tzmeet-api.onrender.com/v1/badge.svg?n=Zahid&z=Asia%2FDhaka&w=09%3A00-18%3A00&d=56&h=BD",
    );
  });

  it("wraps the badge in a link to the hours page, as Markdown and HTML", () => {
    const snippets = badgeSnippets(zahid, href);
    expect(snippets.markdown).toBe(
      `[![Zahid's working hours](${badgeUrl(zahid)})](https://example.github.io/tzmeet/me/#n=Zahid&z=Asia%2FDhaka&w=09%3A00-18%3A00&d=56&h=BD)`,
    );
    expect(snippets.html).toBe(
      `<a href="https://example.github.io/tzmeet/me/#n=Zahid&amp;z=Asia%2FDhaka&amp;w=09%3A00-18%3A00&amp;d=56&amp;h=BD"><img src="${badgeUrl(zahid).replaceAll("&", "&amp;")}" alt="Zahid's working hours" height="20"></a>`,
    );
    expect(badgeSnippets({ ...zahid, name: "" }, href).alt).toBe(
      "Dhaka's working hours",
    );
    expect(
      badgeSnippets({ ...zahid, name: "Zahid [ops]" }, href).markdown,
    ).toMatch(/^\[!\[Zahid ops's working hours\]/);
  });

  it("draws the preview locally, without calling the API", () => {
    const preview = badgePreview(zahid, new Date("2026-10-14T05:00:00Z"));
    expect(preview.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(preview)).toContain(
      'aria-label="Zahid: working (Asia/Dhaka)"',
    );
    expect(
      decodeURIComponent(badgePreview(zahid, new Date("2026-12-16T05:00:00Z"))),
    ).toContain("holiday: Victory Day");
  });
});
