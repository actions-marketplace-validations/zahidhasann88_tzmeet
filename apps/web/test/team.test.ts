import { describe, expect, it } from "vitest";
import type { MeState } from "../src/me-state";
import { decodeState, fromBase64Url } from "../src/state";
import {
  bestSharedHours,
  defaultTeamState,
  findMeetingLink,
  parseTeamHash,
  personFromMeLink,
  teamGrid,
  teamHash,
  teamMeetState,
  teamShareLink,
  type TeamState,
} from "../src/team-state";

const zahid: MeState = {
  name: "Zahid",
  zone: "Asia/Dhaka",
  workStart: "09:00",
  workEnd: "18:00",
  weekend: [5, 6],
  holidayPreset: "BD",
};
const ana: MeState = {
  name: "Ana",
  zone: "Europe/London",
  workStart: "09:00",
  workEnd: "17:30",
  weekend: [6, 7],
};
const ben: MeState = {
  name: "Ben",
  zone: "America/New_York",
  workStart: "09:00",
  workEnd: "17:00",
  weekend: [6, 7],
};
const team: TeamState = { name: "Platform", people: [zahid, ana, ben] };
const now = new Date("2026-10-26T06:00:00Z");

describe("team links", () => {
  it("round-trip through the hash and the /team/ preview page, leaving out defaults", () => {
    expect(parseTeamHash(teamHash(team))).toEqual(team);
    const encoded = new URLSearchParams(teamHash(team).split("?")[1]).get("s")!;
    expect(JSON.parse(fromBase64Url(encoded))).toEqual({
      v: 1,
      t: "Platform",
      p: [
        { n: "Zahid", z: "Asia/Dhaka", h: "BD" },
        { n: "Ana", z: "Europe/London", w: "09:00-17:30" },
        { n: "Ben", z: "America/New_York", w: "09:00-17:00" },
      ],
    });
    const link = teamShareLink(
      team,
      "https://example.github.io/tzmeet/?s=abc#/team",
    );
    expect(link.startsWith("https://example.github.io/tzmeet/team/#s=")).toBe(
      true,
    );
    expect(parseTeamHash(`#/team?${link.split("#")[1]}`)).toEqual(team);
  });

  it("reject broken links, bad people and too many people", () => {
    const encode = (value: unknown) =>
      `#/team?s=${btoa(JSON.stringify(value)).replace(/=+$/, "")}`;
    expect(parseTeamHash("#/team")).toBeNull();
    expect(parseTeamHash("#/team?s=%%%")).toBeNull();
    expect(parseTeamHash(encode({ v: 1, p: [] }))).toBeNull();
    expect(parseTeamHash(encode({ v: 1, p: [{ z: "Mars/Base" }] }))).toBeNull();
    expect(
      parseTeamHash(encode({ v: 1, p: [{ z: "UTC", w: "09:00-09:00" }] })),
    ).toBeNull();
    expect(
      parseTeamHash(
        encode({ v: 1, p: Array.from({ length: 13 }, () => ({ z: "UTC" })) }),
      ),
    ).toBeNull();
    expect(
      parseTeamHash(encode({ v: 1, p: [{ z: "Asia/Dhaka" }] }))!.people[0]!
        .weekend,
    ).toEqual([5, 6]);
  });

  it("read people from My hours links", () => {
    expect(
      personFromMeLink(
        "https://example.github.io/tzmeet/me/#n=Zahid&z=Asia%2FDhaka&w=09:00-18:00&d=56&h=BD",
      ),
    ).toEqual(zahid);
    expect(
      personFromMeLink(
        " https://example.github.io/tzmeet/#/me?n=Zahid&z=Asia%2FDhaka&d=56&h=BD ",
      ),
    ).toEqual(zahid);
    expect(personFromMeLink("not a link")).toBeNull();
    expect(personFromMeLink("https://example.com/")).toBeNull();
  });

  it("start with you and one other zone", () => {
    expect(
      defaultTeamState("Asia/Dhaka").people.map((person) => person.zone),
    ).toEqual(["Asia/Dhaka", "Europe/London"]);
    expect(
      defaultTeamState("Europe/London").people.map((person) => person.zone),
    ).toEqual(["Europe/London", "America/New_York"]);
  });
});

describe("overlap", () => {
  it("counts who works in each half hour, in the viewer's zone", () => {
    const rows = teamGrid(team, "Europe/London", now);
    expect(rows).toHaveLength(7);
    expect(rows[0]!.label).toBe("Mon 26 Oct");
    expect(rows[0]!.working[20]).toBe(2);
    expect(rows[0]!.working[28]).toBe(2);
    expect(rows[0]!.people[0]![28]).not.toBe("work");
    expect(rows[5]!.working.every((count) => count === 0)).toBe(true);
  });

  it("lists the longest stretches when the most people work", () => {
    expect(bestSharedHours(team, "Europe/London", now)).toEqual({
      count: 2,
      total: 3,
      everyone: false,
      windows: ["26", "27", "28", "29", "30"].map((day) => ({
        start: `2026-10-${day}T13:00:00.000+00:00`,
        end: `2026-10-${day}T17:30:00.000+00:00`,
        people: ["Ana", "Ben"],
      })),
    });
    const pair = bestSharedHours(
      { name: "", people: [zahid, ana] },
      "Asia/Dhaka",
      now,
    );
    expect(pair).toMatchObject({ count: 2, total: 2, everyone: true });
    expect(pair.windows.map((window) => window.start)).toEqual(
      ["26", "27", "28", "29"].map(
        (day) => `2026-10-${day}T15:00:00.000+06:00`,
      ),
    );
  });

  it("starts from now", () => {
    const later = new Date("2026-10-26T15:00:00Z");
    expect(
      bestSharedHours(team, "Europe/London", later, 20).windows[0]!.start,
    ).toBe("2026-10-26T15:00:00.000+00:00");
  });
});

describe("find a meeting", () => {
  it("opens the meeting finder with one city per zone", () => {
    const cara: MeState = {
      name: "Cara",
      zone: "Europe/London",
      workStart: "10:00",
      workEnd: "18:00",
      weekend: [5, 6, 7],
    };
    const state = teamMeetState({ name: "", people: [zahid, ana, cara] }, now);
    expect(state.input.startDate).toBe("2026-10-26");
    expect(state.input.zones).toEqual([
      expect.objectContaining({
        id: "Asia/Dhaka",
        label: "Zahid",
        workStart: "09:00",
        workEnd: "18:00",
        holidayPreset: "BD",
      }),
      expect.objectContaining({
        id: "Europe/London",
        label: "Ana, Cara",
        workStart: "10:00",
        workEnd: "17:30",
        quietBefore: "09:00",
        quietAfter: "18:30",
        weekend: [5, 6, 7],
      }),
    ]);
    const link = findMeetingLink(
      team,
      "https://example.github.io/tzmeet/#/team?s=x",
      now,
    )!;
    expect(link.startsWith("https://example.github.io/tzmeet/?s=")).toBe(true);
    expect(
      decodeState(link.split("?")[1]!)!.input.zones.map((zone) => zone.label),
    ).toEqual(["Zahid", "Ana", "Ben"]);
  });
});
