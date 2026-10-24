import { z } from "@hono/zod-openapi";
import { conversionSchema, cronDialects, findSlotsSchema, type CronDialect } from "@tzmeet/core";

export const API_LIMITS = {
  zones: 8,
  days: 14,
  minStep: 5,
  minDuration: 5,
  maxDuration: 480,
  top: 50,
  bodyBytes: 32768,
} as const;
export const apiInputSchema = findSlotsSchema
  .extend({
    zones: z
      .preprocess((value, ctx) => {
        if (Array.isArray(value) && value.length > API_LIMITS.zones) {
          ctx.addIssue({
            code: "custom",
            message: "zones must contain at most 8 participants",
            fatal: true,
          });
          return z.NEVER;
        }
        return value;
      }, findSlotsSchema.shape.zones)
      .openapi({ maxItems: 8 }),
    days: findSlotsSchema.shape.days
      .removeDefault()
      .max(14, "days must be at most 14")
      .default(5),
    stepMinutes: findSlotsSchema.shape.stepMinutes
      .removeDefault()
      .min(5, "stepMinutes must be at least 5")
      .default(15),
    durationMinutes: findSlotsSchema.shape.durationMinutes
      .removeDefault()
      .min(5, "durationMinutes must be at least 5")
      .max(480, "durationMinutes must be at most 480")
      .default(30),
  })
  .openapi("FindSlotsRequest");
const numeric = (field: string, min?: number, max?: number) =>
  z
    .string()
    .regex(/^\d+$/, `${field} must be an integer`)
    .superRefine((value, ctx) => {
      const number = Number(value);
      if (min !== undefined && number < min)
        ctx.addIssue({
          code: "custom",
          message: `${field} must be at least ${min}`,
        });
      if (max !== undefined && number > max)
        ctx.addIssue({
          code: "custom",
          message: `${field} must be at most ${max}`,
        });
    })
    .optional()
    .openapi({
      example:
        field === "duration"
          ? "30"
          : field === "days"
            ? "1"
            : field === "step"
              ? "15"
              : "10",
    });
const repeated = (field: string) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .openapi({
      example:
        field === "zoneWork"
          ? ["Asia/Dhaka=10:00-17:00"]
          : field === "holiday"
            ? ["Asia/Dhaka=2026-12-16"]
            : field === "holidayPreset"
              ? ["Asia/Dhaka=BD"]
              : field === "specialHours"
                ? ["Europe/London=2026-12-21..2026-12-31@10:00-16:00"]
                : field === "ramadan"
                  ? ["Asia/Dhaka=09:00-15:30"]
                  : field === "optional"
                    ? ["America/New_York"]
                    : ["Asia/Dhaka=fri,sat"],
      description: "Repeat parameter for each IANA_ZONE=value override",
      param: { style: "form", explode: true },
    });
const top = z
  .string()
  .regex(/^\d+$/, "top must be an integer from 1 to 50")
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .min(1, "top must be at least 1")
      .max(50, "top must be at most 50"),
  )
  .default("10")
  .openapi({ description: "Number of returned slots (1–50)", example: "2" });
export const resultQuerySchema = z
  .object({
    top,
    format: z
      .enum(["json", "text", "ics"])
      .default("json")
      .openapi({ example: "json" }),
    rotation: z.enum(["2", "3"]).optional().openapi({
      description: "Also suggest 2 or 3 times to alternate weekly (JSON only)",
      example: "2",
    }),
  })
  .strict();
export const slotsGetQuerySchema = resultQuerySchema.extend({
  zones: z
    .string()
    .min(1, "zones is required as comma-separated IANA identifiers")
    .refine(
      (value) => value.split(",").length <= 8,
      "zones must contain at most 8 participants",
    )
    .openapi({ example: "Asia/Dhaka,Europe/London" }),
  date: findSlotsSchema.shape.startDate.openapi({ example: "2026-11-02" }),
  duration: numeric("duration", 5, 480),
  days: numeric("days", 1, 14),
  step: numeric("step", 5, 1440),
  work: z.string().optional().openapi({ example: "09:00-18:00" }),
  zoneWork: repeated("zoneWork"),
  weekend: repeated("weekend"),
  holiday: repeated("holiday"),
  holidayPreset: repeated("holidayPreset"),
  specialHours: repeated("specialHours"),
  ramadan: repeated("ramadan"),
  optional: repeated("optional"),
  quiet: z.string().optional().openapi({ example: "08:00-21:00" }),
  prayerBuffer: numeric("prayerBuffer", 0, 180),
  prayerLocation: z.string().optional().openapi({ example: "Dhaka" }),
  prayerMethod: z.string().optional().openapi({ example: "Karachi" }),
});
export const zonesQuerySchema = z
  .object({
    search: z.string().max(100).default("").openapi({ example: "dhaka" }),
  })
  .strict();
export const apiConversionSchema = conversionSchema.extend({
  to: z
    .preprocess((value, ctx) => {
      if (Array.isArray(value) && value.length > API_LIMITS.zones) {
        ctx.addIssue({
          code: "custom",
          message: "to must contain at most 8 destination zones",
          fatal: true,
        });
        return z.NEVER;
      }
      return value;
    }, conversionSchema.shape.to)
    .openapi({ maxItems: 8 }),
});
export const convertQuerySchema = apiConversionSchema
  .omit({ to: true })
  .extend({
    time: conversionSchema.shape.time.openapi({ example: "2026-11-02T10:00" }),
    from: conversionSchema.shape.from.openapi({ example: "Asia/Dhaka" }),
    disambiguation: conversionSchema.shape.disambiguation.openapi({
      example: "reject",
    }),
    to: z
      .string()
      .min(1, "to must contain destination IANA identifiers")
      .openapi({
        description: "At most eight unique comma-separated IANA identifiers",
        example: "Europe/London,America/New_York",
      }),
  })
  .strict();

export const errorDetailSchema = z.object({
  field: z.string(),
  message: z.string(),
  suggestion: z.string().optional(),
});
export const errorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.array(errorDetailSchema).optional(),
    }),
  })
  .openapi("Error");
export type ErrorBody = z.infer<typeof errorSchema>;
export const zoneInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  offset: z.string(),
  offsetMinutes: z.number(),
});
export const convertedTimeSchema = zoneInfoSchema.extend({
  localTime: z.string(),
  formatted: z.string(),
});
export const conversionResultSchema = z.object({
  source: convertedTimeSchema,
  utc: z.string(),
  conversions: z.array(convertedTimeSchema),
});
export const zoneSlotSchema = z.object({
  id: z.string(),
  label: z.string(),
  localStart: z.string(),
  localEnd: z.string(),
  formattedStart: z.string(),
  formattedEnd: z.string(),
  classification: z.enum(["ideal", "acceptable", "blocked"]),
  optional: z.boolean().optional(),
});
export const slotSchema = z.object({
  start: z.string(),
  end: z.string(),
  date: z.string(),
  score: z.number(),
  baseScore: z.number(),
  zones: z.array(zoneSlotSchema),
  reason: z.string(),
});
const constraintSchema = z.object({
  zoneId: z.string(),
  label: z.string(),
  constraint: z.enum(["weekend", "holiday", "quiet", "prayer", "busy"]),
  count: z.number().int(),
});
export const diagnosticsSchema = z.object({
  scannedCandidates: z.number().int(),
  rejectedCandidates: z.number().int(),
  constraints: z.array(constraintSchema),
  mostRestrictive: constraintSchema.nullable(),
  message: z.string(),
  suggestion: z.string(),
});
export const rotationSchema = z.object({
  size: z.number().int(),
  picks: z.array(
    z.object({
      time: z.string(),
      slot: slotSchema,
      inconvenient: z.array(z.string()),
    }),
  ),
  zones: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      inconvenientTurns: z.number().int(),
    }),
  ),
  message: z.string(),
});
export const slotsResultSchema = z
  .object({
    slots: z.array(slotSchema),
    diagnostics: diagnosticsSchema,
    rotation: rotationSchema.nullable().optional(),
    meta: z.object({
      count: z.number().int(),
      generatedAt: z.string(),
      version: z.string(),
    }),
  })
  .openapi("SlotsResponse");
export const healthSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
});

const count = z
  .string()
  .regex(/^\d+$/, "count must be an integer from 1 to 50")
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .min(1, "count must be at least 1")
      .max(50, "count must be at most 50"),
  )
  .default("10")
  .openapi({ description: "Number of runs to list (1–50)", example: "3" });
export const cronQuerySchema = z
  .object({
    expression: z
      .string()
      .min(1, "expression is required")
      .max(200, "expression must be at most 200 characters")
      .openapi({
        example: "30 2 * * *",
        description:
          "Cron expression; detected as Unix, Kubernetes, Spring or Quartz unless dialect is set",
      }),
    dialect: z
      .enum(cronDialects as [CronDialect, ...CronDialect[]])
      .optional()
      .openapi({ example: "unix" }),
    zone: z.string().optional().openapi({
      example: "America/New_York",
      description: "Zone the schedule runs in (default: UTC)",
    }),
    from: z.string().optional().openapi({
      example: "2027-03-12T00:00:00Z",
      description: "List runs after this ISO instant (default: now)",
    }),
    count,
    display: z
      .string()
      .optional()
      .refine(
        (value) =>
          value === undefined || value.split(",").length <= API_LIMITS.zones,
        "display must contain at most 8 zones",
      )
      .openapi({
        example: "Asia/Dhaka,UTC",
        description: "At most eight comma-separated zones to show each run in",
      }),
  })
  .strict();
const cronZoneSchema = z.object({
  zone: z.string(),
  local: z.string(),
  offsetMinutes: z.number(),
});
export const cronResultSchema = z
  .object({
    dialect: z.enum(cronDialects as [CronDialect, ...CronDialect[]]),
    dialectName: z.string(),
    expression: z.string(),
    zone: z.string(),
    description: z.string(),
    fields: z.array(z.object({ name: z.string(), text: z.string() })),
    runs: z.array(
      z.object({
        utc: z.string(),
        local: z.string(),
        scheduled: z.string(),
        note: z
          .enum(["gap-catch-up", "fold-once", "fold-first", "fold-second", "fold-maybe-twice"])
          .optional(),
        zones: z.array(cronZoneSchema),
      }),
    ),
    skipped: z.array(
      z.object({ scheduled: z.string(), reason: z.literal("gap") }),
    ),
    warnings: z.array(
      z.object({
        code: z.string(),
        severity: z.enum(["warning", "info"]),
        message: z.string(),
        at: z.string().optional(),
      }),
    ),
  })
  .openapi("CronExplanation");
const weeks = z
  .string()
  .regex(/^\d+$/, "weeks must be an integer from 1 to 52")
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .min(1, "weeks must be at least 1")
      .max(52, "weeks must be at most 52"),
  )
  .default("26")
  .openapi({ description: "Weeks to follow (1–52)", example: "30" });
export const recurringQuerySchema = slotsGetQuerySchema
  .omit({ top: true, format: true, rotation: true, days: true, step: true })
  .extend({
    date: slotsGetQuerySchema.shape.date.openapi({
      example: "2026-10-12",
      description:
        "First meeting date in the first zone; it repeats on this weekday",
    }),
    time: z.string().openapi({
      example: "14:00",
      description: "Meeting time (HH:mm) in the first zone",
    }),
    weeks,
    format: z
      .enum(["json", "ics"])
      .default("json")
      .openapi({
        example: "json",
        description:
          "json report, or ics: the weekly series as a calendar file",
      }),
  });
const recurringZoneSchema = z.object({
  id: z.string(),
  label: z.string(),
  localStart: z.string(),
  localTime: z.string(),
  dayOffset: z.number().int(),
  classification: z.enum(["ideal", "acceptable", "blocked"]),
  constraints: z.array(
    z.enum(["weekend", "holiday", "quiet", "prayer", "busy"]),
  ),
});
export const recurringResultSchema = z
  .object({
    anchor: z.string(),
    time: z.string(),
    weekday: z.string(),
    durationMinutes: z.number().int(),
    weeks: z.number().int(),
    occurrences: z.array(
      z.object({
        date: z.string(),
        start: z.string(),
        end: z.string(),
        status: z.enum(["ok", "shifted", "ambiguous"]),
        zones: z.array(recurringZoneSchema),
      }),
    ),
    periods: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        weeks: z.number().int(),
        causes: z.array(z.string()),
        zones: z.array(recurringZoneSchema),
      }),
    ),
    warnings: z.array(
      z.object({
        severity: z.enum(["warning", "info"]),
        message: z.string(),
        date: z.string(),
      }),
    ),
  })
  .openapi("RecurringImpact");

const dialectEnum = z.enum(
  cronDialects as [CronDialect, ...CronDialect[]],
);
export const cronConvertQuerySchema = z
  .object({
    expression: z
      .string()
      .min(1, "expression is required")
      .max(200, "expression must be at most 200 characters")
      .openapi({ example: "0 9 * * 1-5" }),
    dialect: dialectEnum.optional().openapi({
      example: "unix",
      description: "Source syntax (default: detected)",
    }),
    to: dialectEnum
      .optional()
      .openapi({ example: "quartz", description: "Convert to this syntax" }),
    zone: z.string().optional().openapi({
      example: "Asia/Dhaka",
      description: "Zone the schedule is meant for (default: UTC)",
    }),
    toZone: z.string().optional().openapi({
      example: "UTC",
      description: "Rewrite the schedule for a scheduler running in this zone",
    }),
    from: z.string().optional().openapi({
      example: "2026-10-23T00:00:00Z",
      description: "Start of the year checked for DST changes (default: now)",
    }),
  })
  .strict()
  .refine((query) => query.to !== undefined || query.toZone !== undefined, {
    message: "Give to and/or toZone",
    path: ["to"],
  });
const dialectConversionSchema = z.object({
  from: dialectEnum,
  to: dialectEnum,
  expressions: z.array(z.string()),
  problems: z.array(z.string()),
  notes: z.array(z.string()),
});
const zoneConversionSchema = z.object({
  dialect: dialectEnum,
  expression: z.string(),
  fromZone: z.string(),
  toZone: z.string(),
  constant: z.boolean(),
  periods: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      offsetMinutes: z.number().int(),
      expressions: z.array(z.string()),
      problems: z.array(z.string()),
    }),
  ),
  native: z.string(),
  message: z.string(),
});
export const cronConvertResultSchema = z
  .object({
    dialect: dialectConversionSchema.optional(),
    zone: zoneConversionSchema.optional(),
  })
  .openapi("CronConversion");
export const cronNaturalQuerySchema = z
  .object({
    text: z
      .string()
      .min(1, "text is required")
      .max(200, "text must be at most 200 characters")
      .openapi({ example: "every weekday at 9am Dhaka" }),
    dialect: dialectEnum
      .optional()
      .openapi({
        example: "kubernetes",
        description: "Syntax to write (default: unix)",
      }),
  })
  .strict();
export const cronNaturalResultSchema = z
  .object({
    input: z.string(),
    dialect: dialectEnum,
    expressions: z.array(z.string()),
    zone: z.string().optional(),
    description: z.string(),
    native: z.string().optional(),
    problems: z.array(z.string()),
    notes: z.array(z.string()),
  })
  .openapi("NaturalCron");
