import { IANAZone } from "luxon";

export function systemdToFields(
  text: string,
): { fields: string[]; zone?: string } | { error: string } {
  const shorthands: Record<string, string> = {
    minutely: "*-*-* *:*:00",
    hourly: "*-*-* *:00:00",
    daily: "*-*-* 00:00:00",
    monthly: "*-*-01 00:00:00",
    weekly: "Mon *-*-* 00:00:00",
    yearly: "*-01-01 00:00:00",
    annually: "*-01-01 00:00:00",
    quarterly: "*-01,04,07,10-01 00:00:00",
    semiannually: "*-01,07-01 00:00:00",
  };
  let tokens = text.trim().split(/\s+/).filter(Boolean);
  let zone: string | undefined;
  const last = tokens.at(-1);
  if (
    last &&
    tokens.length > 1 &&
    (last === "UTC" || (last.includes("/") && IANAZone.isValidZone(last)))
  ) {
    zone = last;
    tokens = tokens.slice(0, -1);
  }
  if (tokens.length === 1 && shorthands[tokens[0]!.toLowerCase()])
    tokens = shorthands[tokens[0]!.toLowerCase()]!.split(" ");
  if (!tokens.length)
    return {
      error: "Enter an OnCalendar expression, e.g. Mon..Fri *-*-* 09:00:00",
    };

  const convert = (
    component: string,
    what: string,
  ): string | { error: string } => {
    if (component.includes("~"))
      return {
        error: `"~" (counting from the end of the month) isn't supported yet (${component})`,
      };
    if (!/^[0-9*,./]+$/.test(component))
      return { error: `Couldn't read the ${what} "${component}"` };
    return component.replaceAll("..", "-");
  };
  const dayNames: Record<string, string> = {
    mon: "MON",
    monday: "MON",
    tue: "TUE",
    tuesday: "TUE",
    wed: "WED",
    wednesday: "WED",
    thu: "THU",
    thursday: "THU",
    fri: "FRI",
    friday: "FRI",
    sat: "SAT",
    saturday: "SAT",
    sun: "SUN",
    sunday: "SUN",
  };

  let dow = "*";
  if (/^[a-z]/i.test(tokens[0]!)) {
    const parts: string[] = [];
    for (const item of tokens[0]!.split(",")) {
      const [from, to, extra] = item.toLowerCase().split("..");
      if (
        extra !== undefined ||
        !dayNames[from!] ||
        (to !== undefined && !dayNames[to])
      )
        return { error: `Couldn't read the weekday "${item}"` };
      parts.push(
        to === undefined
          ? dayNames[from!]!
          : `${dayNames[from!]}-${dayNames[to]}`,
      );
    }
    dow = parts.join(",");
    tokens = tokens.slice(1);
  }
  let year = "*";
  let month = "*";
  let dom = "*";
  let hour = "0";
  let minute = "0";
  let second = "0";
  for (const token of tokens) {
    if (token.includes(":")) {
      const parts = token.split(":");
      if (parts.length < 2 || parts.length > 3)
        return { error: `Couldn't read the time "${token}"` };
      const values = parts.map((part, index) =>
        convert(index === 2 ? part.replace(/\.\d+$/, "") : part, "time"),
      );
      const failed = values.find((value) => typeof value !== "string");
      if (failed) return failed as { error: string };
      [hour, minute] = values as [string, string];
      second = (values[2] as string | undefined) ?? "0";
    } else if (token.includes("-")) {
      const parts = token.split("-");
      if (parts.length < 2 || parts.length > 3)
        return { error: `Couldn't read the date "${token}"` };
      const values = parts.map((part) => convert(part, "date"));
      const failed = values.find((value) => typeof value !== "string");
      if (failed) return failed as { error: string };
      if (parts.length === 3)
        [year, month, dom] = values as [string, string, string];
      else [month, dom] = values as [string, string];
    } else return { error: `Couldn't read "${token}"` };
  }
  return {
    fields: [second, minute, hour, dom, month, dow, year],
    ...(zone ? { zone } : {}),
  };
}
