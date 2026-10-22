export type Classification = "ideal" | "acceptable" | "blocked";
export type Constraint = "weekend" | "holiday" | "quiet" | "prayer" | "busy";
export interface ZoneSlot {
  id: string;
  label: string;
  localStart: string;
  localEnd: string;
  formattedStart: string;
  formattedEnd: string;
  classification: Exclude<Classification, "blocked">;
}
export interface Slot {
  start: string;
  end: string;
  date: string;
  score: number;
  baseScore: number;
  zones: ZoneSlot[];
  reason: string;
}
export interface ConstraintCount {
  zoneId: string;
  label: string;
  constraint: Constraint;
  count: number;
}
export interface Diagnostics {
  scannedCandidates: number;
  rejectedCandidates: number;
  constraints: ConstraintCount[];
  mostRestrictive: ConstraintCount | null;
  message: string;
  suggestion: string;
}
export interface FindSlotsResult {
  slots: Slot[];
  diagnostics: Diagnostics;
  range: { start: string; end: string };
}
export interface PrayerWindow {
  name: "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";
  time: string;
  start: string;
  end: string;
}
export interface SpanEvaluation {
  classification: Classification;
  constraints: Constraint[];
  prayers: string[];
}
