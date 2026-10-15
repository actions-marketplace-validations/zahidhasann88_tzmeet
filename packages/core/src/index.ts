/** Browser-safe shared time-zone meeting search. No Node APIs or network requests. */
export { findSlots, classifySpan, classifySpans, InputValidationError } from './engine.js';
export { getPrayerWindows } from './prayer.js';
export { validateInput, listTimeZones, findSlotsSchema, configSchema, zoneSchema, prayerSchema, cities, prayerMethods } from './schema.js';
export type { FindSlotsInput, NormalizedInput, ZoneRule, PrayerRule, Config } from './schema.js';
export type { Classification, Constraint, ConstraintCount, Diagnostics, FindSlotsResult, Slot, ZoneSlot, PrayerWindow, SpanEvaluation } from './types.js';

export { parseScheduleInput, parseIntegerOption, ScheduleInputError } from './transport-input.js';
export type { ScheduleTextOptions, ScheduleInputIssue } from './transport-input.js';
export { convertTime, conversionSchema, timeZoneIdSchema, getTimeZoneInfo, suggestTimeZone } from './time-transport.js';
export type { ConvertTimeInput, ConvertTimeResult, ConvertedTime, TimeZoneInfo } from './time-transport.js';

export { inviteText, foldLine, calendarText, calendarCollectionText } from './invite-format.js';
