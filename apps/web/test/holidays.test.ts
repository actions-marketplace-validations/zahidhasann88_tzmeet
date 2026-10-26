import { describe, expect, it } from "vitest";
import { holidayCalendarText } from "@tzmeet/core";
import {
  googleSubscribeUrl,
  holidayFeedUrl,
  webcalUrl,
} from "../src/holiday-feeds";

describe("holiday calendar links", () => {
  it("point at the API feed, as https, webcal and a Google Calendar subscription", () => {
    expect(holidayFeedUrl("GB-ENG")).toBe(
      "https://tzmeet-api.onrender.com/v1/holidays.ics?preset=GB-ENG",
    );
    expect(webcalUrl("BD")).toBe(
      "webcal://tzmeet-api.onrender.com/v1/holidays.ics?preset=BD",
    );
    expect(googleSubscribeUrl("BD")).toBe(
      "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Ftzmeet-api.onrender.com%2Fv1%2Fholidays.ics%3Fpreset%3DBD",
    );
  });
});

describe("holidayCalendarText", () => {
  const text = holidayCalendarText("IN", {
    years: [2027, 2028],
    created: "2026-10-25T09:30:00Z",
  });

  it("names the calendar and asks apps to refresh daily", () => {
    expect(text).toContain(
      "X-WR-CALNAME:Public holidays: India (central government\\, Delhi)\r\n",
    );
    expect(text).toContain(
      "REFRESH-INTERVAL;VALUE=DURATION:P1D\r\nX-PUBLISHED-TTL:P1D\r\n",
    );
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("writes all-day events with stable IDs, and says when a year's list is incomplete", () => {
    expect(text).toContain(
      "UID:IN-2027-01-26-republic-day@tzmeet.local\r\nDTSTAMP:20261025T093000Z\r\nDTSTART;VALUE=DATE:20270126\r\nDTEND;VALUE=DATE:20270127\r\n",
    );
    const description = text
      .split("\r\n")
      .find((line) => line.startsWith("X-WR-CALDESC:"))!;
    expect(description).toContain("Public holidays for India");
    expect(text.replace(/\r\n /g, "")).toContain(
      "Only fixed national holidays and Good Friday are included for 2028.",
    );
    expect(
      holidayCalendarText("IN", {
        years: [2027, 2028],
        created: "2026-10-26T00:00:00Z",
      }).match(/UID:[^\r]+/g),
    ).toEqual(text.match(/UID:[^\r]+/g));
  });

  it("year boundaries: an event on 31 December ends on 1 January", () => {
    const gb = holidayCalendarText("GB-ENG", {
      years: [2026],
      created: "2026-01-01T00:00:00Z",
    });
    expect(gb).toContain(
      "DTSTART;VALUE=DATE:20261228\r\nDTEND;VALUE=DATE:20261229\r\n",
    );
    const us = holidayCalendarText("US", {
      years: [2027],
      created: "2026-01-01T00:00:00Z",
    });
    expect(us).toContain(
      "DTSTART;VALUE=DATE:20271231\r\nDTEND;VALUE=DATE:20280101\r\n",
    );
  });
});
