import { describe, expect, it } from "vitest";
import {
  availabilityNow,
  badgeMessage,
  badgeSvg,
  type ZoneRule,
} from "../src/index.js";

const zahid: ZoneRule = {
  id: "Asia/Dhaka",
  workStart: "09:00",
  workEnd: "18:00",
  weekend: [5, 6],
  holidayPreset: "BD",
};

describe("availabilityNow", () => {
  it.each([
    ["2026-10-14T05:00:00Z", "working", "2026-10-14T11:00:00.000+06:00"],
    ["2026-10-14T12:00:00Z", "off", "2026-10-14T18:00:00.000+06:00"],
    ["2026-10-16T05:00:00Z", "weekend", "2026-10-16T11:00:00.000+06:00"],
  ])("%s → %s", (at, status, local) => {
    expect(availabilityNow(zahid, at)).toEqual({ status, local });
  });

  it("names the holiday from the preset", () => {
    expect(availabilityNow(zahid, "2026-12-16T05:00:00Z")).toEqual({
      status: "holiday",
      holiday: "Victory Day",
      local: "2026-12-16T11:00:00.000+06:00",
    });
    expect(
      availabilityNow(
        { id: "UTC", holidays: ["2026-12-24"] },
        "2026-12-24T10:00:00Z",
      ),
    ).toEqual({
      status: "holiday",
      local: "2026-12-24T10:00:00.000Z",
    });
  });

  it("follows daylight saving in the person's zone", () => {
    const ana: ZoneRule = {
      id: "Europe/London",
      workStart: "09:00",
      workEnd: "17:00",
    };
    expect(availabilityNow(ana, "2026-10-23T08:30:00Z").status).toBe("working");
    expect(availabilityNow(ana, "2026-10-26T08:30:00Z").status).toBe("off");
  });
});

describe("badgeSvg", () => {
  it("draws the name and status, sized to the text", () => {
    const svg = badgeSvg({
      label: "Zahid",
      status: "working",
      zone: "Asia/Dhaka",
    });
    expect(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="'),
    ).toBe(true);
    expect(svg).toContain('aria-label="Zahid: working (Asia/Dhaka)"');
    expect(svg).toContain(">Zahid</text>");
    expect(svg).toContain(">working</text>");
    expect(svg).toContain('fill="#2f7a5c"');
    const width = (text: string) => Number(/width="(\d+)"/.exec(text)![1]);
    expect(
      width(
        badgeSvg({
          label: "Zahid Hasan",
          status: "working",
          zone: "Asia/Dhaka",
        }),
      ),
    ).toBeGreaterThan(width(svg));
  });

  it("shows holidays by name, shortened when long", () => {
    expect(badgeMessage({ status: "holiday", holiday: "Victory Day" })).toBe(
      "holiday: Victory Day",
    );
    expect(badgeMessage({ status: "holiday" })).toBe("holiday");
    expect(
      badgeMessage({
        status: "holiday",
        holiday: "Shaheed Day and International Mother Language Day",
      }),
    ).toBe("holiday: Shaheed Day and International…");
  });

  it("escapes names, so they can't add markup", () => {
    const svg = badgeSvg({
      label: '<script>alert("x")</script>&',
      status: "off",
      zone: "UTC",
    });
    expect(svg).not.toContain("<script");
    expect(svg).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;",
    );
  });
});
