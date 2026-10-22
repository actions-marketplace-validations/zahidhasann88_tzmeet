import {
  convertTime,
  explainCron,
  findSlots,
  getTimeZoneInfo,
} from "@tzmeet/core";
export const slotRequestExample = {
  zones: [
    {
      id: "Asia/Dhaka",
      label: "Dhaka",
      weekend: [5, 6],
      prayer: {
        location: "Dhaka" as const,
        method: "Karachi" as const,
        bufferMinutes: 10,
      },
    },
    { id: "Europe/London", label: "London" },
  ],
  startDate: "2026-11-02",
  days: 1,
  durationMinutes: 30,
  stepMinutes: 30,
};
export function responseExamples(version: string) {
  const result = findSlots(slotRequestExample);
  return {
    slots: {
      slots: result.slots.slice(0, 2),
      diagnostics: result.diagnostics,
      meta: { count: 2, generatedAt: "2026-10-14T12:00:00.000Z", version },
    },
    zones: { zones: [getTimeZoneInfo("Asia/Dhaka", "2026-10-14T12:00:00Z")] },
    convert: convertTime({
      time: "2026-11-02T10:00",
      from: "Asia/Dhaka",
      to: ["Europe/London", "America/New_York"],
    }),
    cron: explainCron({
      expression: "30 2 * * *",
      zone: "America/New_York",
      from: "2027-03-12T00:00:00Z",
      count: 3,
      displayZones: ["Asia/Dhaka", "UTC"],
    }),
    health: { status: "ok", version },
  };
}
export const errorExample = {
  error: {
    code: "VALIDATION_ERROR",
    message: "zones[1].id: Unknown IANA time zone",
    details: [
      {
        field: "zones[1].id",
        message: "'Asia/Dhka' is not a valid IANA time zone.",
        suggestion: "Asia/Dhaka",
      },
    ],
  },
};
