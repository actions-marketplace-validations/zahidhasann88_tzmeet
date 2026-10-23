import { DateTime } from "luxon";
import { calendarText as sharedCalendarText, type Slot } from "@tzmeet/core";
export { inviteText, foldLine } from "@tzmeet/core";

export function calendarText(
  slot: Slot,
  created = new Date().toISOString(),
): string {
  return sharedCalendarText(slot, created);
}
const stamp = (iso: string) =>
  DateTime.fromISO(iso, { zone: "UTC" })
    .toUTC()
    .toFormat("yyyyLLdd'T'HHmmss'Z'");

export function downloadCalendar(slot: Slot): void {
  downloadIcs(calendarText(slot), `tzmeet-${stamp(slot.start)}.ics`);
}

export function downloadIcs(text: string, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/calendar;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
