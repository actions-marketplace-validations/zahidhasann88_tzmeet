import { describe, expect, it } from "vitest";
import {
  fairRotation,
  findSlots,
  inviteText,
  parseScheduleInput,
} from "../src/index.js";

const zones = [
  { id: "Europe/London" },
  { id: "Asia/Dhaka", weekend: [5, 6] },
  { id: "America/New_York", optional: true },
];
const search = (input = zones) =>
  findSlots({
    zones: input,
    startDate: "2026-11-02",
    days: 1,
    stepMinutes: 60,
  });

describe("optional attendees", () => {
  it("never block a slot, but are shown as unavailable", () => {
    const required = findSlots({
      zones: zones.slice(0, 2),
      startDate: "2026-11-02",
      days: 1,
      stepMinutes: 60,
    });
    const result = search();
    expect(result.slots.map((slot) => slot.start)).toEqual(
      expect.arrayContaining(required.slots.map((slot) => slot.start)),
    );
    expect(result.slots).toHaveLength(required.slots.length);
    const early = result.slots.find((slot) => slot.start.includes("T09:00"))!;
    expect(early.zones[2]).toMatchObject({
      id: "America/New_York",
      optional: true,
      classification: "blocked",
    });
    expect(early.reason).toContain("unavailable for New York (optional)");
    expect(inviteText(early)).toContain("New York (optional, unavailable)");
  });

  it("rank slots they can attend higher", () => {
    const [best] = search().slots;
    expect(best!.zones[2]!.classification).not.toBe("blocked");
    expect(best!.baseScore).toBeGreaterThan(
      search().slots.find(
        (slot) => slot.zones[2]!.classification === "blocked",
      )!.baseScore,
    );
  });

  it("don't count towards diagnostics or rotation", () => {
    const result = search();
    expect(
      result.diagnostics.constraints.some(
        (count) => count.zoneId === "America/New_York",
      ),
    ).toBe(false);
    const rotation = fairRotation(result, { size: 2 });
    expect(
      rotation?.zones.find((zone) => zone.id === "America/New_York")
        ?.inconvenientTurns ?? 0,
    ).toBe(0);
  });

  it("need at least one required zone", () => {
    expect(() =>
      findSlots({
        zones: [{ id: "UTC", optional: true }],
        startDate: "2026-11-02",
      }),
    ).toThrow(/At least one zone must be required/);
  });

  it("parses --optional as repeatable or comma-separated", () => {
    const input = parseScheduleInput({
      zones: "UTC,Asia/Dhaka,Europe/London",
      date: "2026-11-02",
      optional: ["Asia/Dhaka,Europe/London"],
    });
    expect(input.zones.map((zone) => zone.optional)).toEqual([
      undefined,
      true,
      true,
    ]);
    expect(() =>
      parseScheduleInput({
        zones: "UTC",
        date: "2026-11-02",
        optional: ["Asia/Tokyo"],
      }),
    ).toThrow(/Asia\/Tokyo is not a selected zone/);
  });
});
