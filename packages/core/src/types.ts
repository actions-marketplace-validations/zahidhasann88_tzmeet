/** Full-span classification; blocked slots are never included in search results. */
export type Classification = 'ideal' | 'acceptable' | 'blocked';
/** Independent rejection causes (a candidate may violate more than one). */
export type Constraint = 'weekend' | 'holiday' | 'quiet' | 'prayer';

/** Local meeting span with offsets preserved, including repeated DST hours. */
export interface ZoneSlot {
  id: string;
  label: string;
  localStart: string;
  localEnd: string;
  formattedStart: string;
  formattedEnd: string;
  classification: Exclude<Classification, 'blocked'>;
}
/** A viable UTC interval, ordered by descending score. */
export interface Slot {
  start: string;
  end: string;
  /** Date of the start in the first zone, not necessarily its UTC date. */
  date: string;
  /** Base sum plus a strictly smaller than 0.1 deterministic tie-break. */
  score: number;
  baseScore: number;
  zones: ZoneSlot[];
  reason: string;
}
/** Per-zone, per-constraint candidate rejection totals. Counts are not mutually exclusive. */
export interface ConstraintCount {
  zoneId: string;
  label: string;
  constraint: Constraint;
  count: number;
}
/** Helpful explanation when no candidate survives; also useful for inspecting viable searches. */
export interface Diagnostics {
  scannedCandidates: number;
  rejectedCandidates: number;
  constraints: ConstraintCount[];
  mostRestrictive: ConstraintCount | null;
  message: string;
  suggestion: string;
}
/** Ranked slots and rejection diagnostics. Invalid input throws InputValidationError. */
export interface FindSlotsResult {
  slots: Slot[];
  diagnostics: Diagnostics;
  range: { start: string; end: string };
}
/** Calculated buffered prayer instant, in UTC. Sunrise is intentionally excluded. */
export interface PrayerWindow {
  name: 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
  time: string;
  start: string;
  end: string;
}
/** Span classification for timelines and independent evaluation. */
export interface SpanEvaluation {
  classification: Classification;
  constraints: Constraint[];
  prayers: string[];
}
