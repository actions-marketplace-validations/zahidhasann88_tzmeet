import { cronDialects, timeZoneIdSchema, type CronDialect } from "@tzmeet/core";

export interface CronState {
  expression: string;
  dialect: CronDialect | "auto";
  zone: string;
  display: string[];
  count: number;
}

export const CRON_ROUTE = "#/cron";
export const cronCounts = [5, 10, 20, 50];
export const maxDisplayZones = 8;

export function defaultCronState(): CronState {
  return {
    expression: "30 2 * * *",
    dialect: "auto",
    zone: "America/New_York",
    display: ["Asia/Dhaka", "UTC", "America/New_York", "Europe/London"],
    count: 10,
  };
}

export const isCronRoute = (hash: string) =>
  hash === CRON_ROUTE || hash.startsWith(`${CRON_ROUTE}?`);

export function parseCronHash(hash: string): CronState {
  const state = defaultCronState();
  if (!isCronRoute(hash)) return state;
  const params = new URLSearchParams(hash.slice(CRON_ROUTE.length + 1));
  const expression = params.get("e");
  if (expression !== null && expression.length <= 200)
    state.expression = expression;
  const dialect = params.get("d");
  if (dialect && (cronDialects as readonly string[]).includes(dialect))
    state.dialect = dialect as CronDialect;
  const zone = params.get("z");
  if (zone && timeZoneIdSchema.safeParse(zone).success) state.zone = zone;
  const display = params.get("show");
  if (display !== null) {
    const ids = [
      ...new Set(
        display
          .split(",")
          .filter((id) => timeZoneIdSchema.safeParse(id).success),
      ),
    ];
    state.display = ids.slice(0, maxDisplayZones);
  }
  const count = Number(params.get("n"));
  if (cronCounts.includes(count)) state.count = count;
  return state;
}

export function cronHash(state: CronState): string {
  const params = new URLSearchParams({ e: state.expression });
  if (state.dialect !== "auto") params.set("d", state.dialect);
  params.set("z", state.zone);
  params.set("show", state.display.join(","));
  params.set("n", String(state.count));
  return `${CRON_ROUTE}?${params}`;
}

export function fieldLabels(tokens: number): string[] {
  if (tokens === 5)
    return ["minute", "hour", "day of month", "month", "day of week"];
  return [
    "second",
    "minute",
    "hour",
    "day of month",
    "month",
    "day of week",
    "year",
  ].slice(0, tokens);
}

export function cronShareLink(state: CronState, href: string): string {
  const page = new URL("cron/", href.split(/[?#]/)[0]);
  return `${page.href}#${cronHash(state).split("?")[1]}`;
}
