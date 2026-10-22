import { z } from "zod";
import {
  ScheduleInputError,
  InputValidationError,
  suggestTimeZone,
} from "@tzmeet/core";
import type { ErrorBody } from "./schemas.js";

export type ErrorStatus = 400 | 401 | 403 | 404 | 405 | 413 | 429 | 500;
export class ApiError extends Error {
  constructor(
    public readonly status: ErrorStatus,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorBody["error"]["details"],
  ) {
    super(message);
    this.name = "ApiError";
  }
  get body(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}
const fieldName = (path: string) => {
  const aliases: Record<string, string> = {
    "zone-work": "zoneWork",
    "prayer-buffer": "prayerBuffer",
    "prayer-location": "prayerLocation",
    "prayer-method": "prayerMethod",
  };
  return aliases[path] ?? (path.replace(/\.(\d+)(?=\.|$)/g, "[$1]") || "body");
};
function valueAtPath(input: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[String(key)]
        : undefined,
    input,
  );
}
function detail(path: string, message: string, value?: unknown) {
  const field = fieldName(path);
  if (message.includes("Unknown IANA time zone") && typeof value === "string") {
    const suggestion = suggestTimeZone(value);
    const text = `'${value}' is not a valid IANA time zone.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`;
    return { field, message: text, ...(suggestion ? { suggestion } : {}) };
  }
  message = message.replace(/^--/, "");
  const prefix = `${path}: `;
  if (message.startsWith(prefix)) message = message.slice(prefix.length);
  if (field !== path && message.startsWith(`${path} `))
    message = `${field}${message.slice(path.length)}`;
  return { field, message };
}
/** Translate zod and core helper errors into exact field/message pairs. */
export function validationError(
  error: z.ZodError | ScheduleInputError | InputValidationError,
  raw?: unknown,
): ApiError {
  let details: NonNullable<ErrorBody["error"]["details"]>;
  if (error instanceof z.ZodError) {
    details = error.issues.flatMap((issue) =>
      issue.code === "unrecognized_keys"
        ? issue.keys.map((key) =>
            detail([...issue.path, key].join("."), "Unknown field"),
          )
        : [
            detail(
              issue.path.join("."),
              issue.message,
              valueAtPath(raw, issue.path),
            ),
          ],
    );
  } else if (error instanceof ScheduleInputError) {
    details = error.issues.map((issue) =>
      detail(issue.path, issue.message, issue.value),
    );
  } else {
    details = error.errors.map((issue) =>
      detail(
        issue.path,
        issue.message,
        valueAtPath(raw, issue.path.split(".")),
      ),
    );
  }
  return new ApiError(
    400,
    "VALIDATION_ERROR",
    details.map((item) => `${item.field}: ${item.message}`).join("; "),
    details,
  );
}
