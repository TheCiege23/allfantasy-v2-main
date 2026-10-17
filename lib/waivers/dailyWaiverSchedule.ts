/**
 * Commissioner-chosen per-day waiver schedule for NATIVE AllFantasy leagues (2026-10-14).
 *
 * Modelled on Sleeper's "Custom Daily Waivers": every day Mon–Sun carries its own mode, and claims
 * clear once that day at `processHour` in the league's timezone. AllFantasy additionally lets a day
 * pick its own waiver TYPE (Mon reverse standings, Tue rolling …), which Sleeper does not.
 *
 * Storage: `League.settings[DAILY_WAIVER_SCHEDULE_SETTINGS_KEY]` (JSON — no migration). The
 * settings PATCH pipeline validates it with `dailyWaiverScheduleSchema` and DERIVES the columns the
 * existing waiver engine already schedules from (`League.waiverSchedule` → UTC weekday indices,
 * `League.waiverProcessTime` → UTC "HH:MM", `customDailyWaivers`), so the cron only fires on days
 * whose mode actually processes claims. `process-engine` reads the per-day TYPE via
 * `resolveEngineWaiverTypeForDate`.
 *
 * Everything in this file is pure.
 */
import { z } from 'zod'

export const DAILY_WAIVER_SCHEDULE_SETTINGS_KEY = 'af_daily_waiver_schedule' as const

/** Monday-first, the order the commissioner sees. */
export const WAIVER_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type WaiverDayKey = (typeof WAIVER_DAY_KEYS)[number]

/** JS `Date#getDay()` index for each key (Sun = 0). */
export const WAIVER_DAY_JS_INDEX: Readonly<Record<WaiverDayKey, number>> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

/**
 * - `waivers`            — claims process at `processHour` using the league's main waiver type
 * - `rolling` / `reverse_standings` / `faab` — claims process that day using THIS type
 * - `waivers_then_fa`    — claims process (league type), then unclaimed players are free agents,
 *                          first-come, until the next waiver day
 * - `free_agents`        — no waiver run; adds are first-come
 * - `locked`             — no adds or drops that day
 */
export const DAILY_WAIVER_MODES = [
  'waivers',
  'rolling',
  'reverse_standings',
  'faab',
  'waivers_then_fa',
  'free_agents',
  'locked',
] as const
export type DailyWaiverMode = (typeof DAILY_WAIVER_MODES)[number]

export const LEAGUE_WAIVER_TYPES = ['faab', 'rolling', 'reverse_standings'] as const
export type LeagueWaiverType = (typeof LEAGUE_WAIVER_TYPES)[number]

const modeSchema = z.enum(DAILY_WAIVER_MODES)

export const dailyWaiverScheduleSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    /** Local hour (0–23) in the league timezone at which a processing day's claims clear. */
    processHour: z.number().int().min(0).max(23),
    days: z.object({
      mon: modeSchema,
      tue: modeSchema,
      wed: modeSchema,
      thu: modeSchema,
      fri: modeSchema,
      sat: modeSchema,
      sun: modeSchema,
    }).strict(),
  })
  .strict()

export type DailyWaiverSchedule = z.infer<typeof dailyWaiverScheduleSchema>

export function defaultDailyWaiverSchedule(): DailyWaiverSchedule {
  return {
    version: 1,
    enabled: false,
    processHour: 2,
    days: {
      mon: 'free_agents',
      tue: 'free_agents',
      wed: 'waivers_then_fa',
      thu: 'free_agents',
      fri: 'free_agents',
      sat: 'free_agents',
      sun: 'locked',
    },
  }
}

/** Validated schedule, or null when absent / malformed. */
export function parseDailyWaiverSchedule(raw: unknown): DailyWaiverSchedule | null {
  const r = dailyWaiverScheduleSchema.safeParse(raw)
  return r.success ? r.data : null
}

/** The schedule stored in `League.settings`, or null. */
export function readDailyWaiverScheduleFromSettings(settings: unknown): DailyWaiverSchedule | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  return parseDailyWaiverSchedule((settings as Record<string, unknown>)[DAILY_WAIVER_SCHEDULE_SETTINGS_KEY])
}

export function normalizeLeagueWaiverType(raw: string | null | undefined): LeagueWaiverType {
  const t = String(raw ?? '').trim().toLowerCase().replace(/-/g, '_')
  if (t === 'faab') return 'faab'
  if (t === 'reverse_standings' || t === 'reverse_order') return 'reverse_standings'
  return 'rolling'
}

/** True when that day runs a waiver process (claims clear at `processHour`). */
export function isWaiverProcessingMode(mode: DailyWaiverMode): boolean {
  return mode !== 'free_agents' && mode !== 'locked'
}

/** The engine waiver type a day processes with, or null when the day runs no waiver process. */
export function engineWaiverTypeForMode(
  mode: DailyWaiverMode,
  leagueWaiverType: string | null | undefined,
): LeagueWaiverType | null {
  switch (mode) {
    case 'rolling':
    case 'reverse_standings':
    case 'faab':
      return mode
    case 'waivers':
    case 'waivers_then_fa':
      return normalizeLeagueWaiverType(leagueWaiverType)
    default:
      return null
  }
}

/** FAAB fields matter when the league type is FAAB or any processing day uses FAAB. */
export function scheduleUsesFaab(
  schedule: DailyWaiverSchedule | null,
  leagueWaiverType: string | null | undefined,
): boolean {
  if (normalizeLeagueWaiverType(leagueWaiverType) === 'faab') return true
  if (!schedule?.enabled) return false
  return WAIVER_DAY_KEYS.some((d) => engineWaiverTypeForMode(schedule.days[d], leagueWaiverType) === 'faab')
}

function safeTimeZone(tz: string | null | undefined): string {
  const candidate = (tz ?? '').trim() || 'America/New_York'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate })
    return candidate
  } catch {
    return 'America/New_York'
  }
}

const SHORT_WEEKDAY_TO_KEY: Record<string, WaiverDayKey> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
}

/** The league-local weekday of an instant. */
export function localWeekdayKey(date: Date, timeZone: string | null | undefined): WaiverDayKey {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: safeTimeZone(timeZone), weekday: 'short' }).format(date)
  return SHORT_WEEKDAY_TO_KEY[wd] ?? 'mon'
}

/**
 * The mode in force at `date`, in the league's timezone. Null when the league has no enabled
 * per-day schedule — callers then fall back to the league's single waiver type, unchanged.
 */
export function resolveWaiverModeForDate(
  schedule: DailyWaiverSchedule | null | undefined,
  date: Date,
  timeZone: string | null | undefined,
): DailyWaiverMode | null {
  if (!schedule || !schedule.enabled) return null
  return schedule.days[localWeekdayKey(date, timeZone)] ?? null
}

/**
 * For the waiver processor: the type to process with at `date`, or null to keep the league's
 * configured type — no schedule, a day that uses the league type (`waivers`, `waivers_then_fa`;
 * returning null there keeps engine-only types such as `standard` intact), or a non-processing
 * day reached by a manual run.
 */
export function resolveEngineWaiverTypeForDate(
  settings: unknown,
  date: Date,
  timeZone: string | null | undefined,
): LeagueWaiverType | null {
  const mode = resolveWaiverModeForDate(readDailyWaiverScheduleFromSettings(settings), date, timeZone)
  if (mode === 'rolling' || mode === 'reverse_standings' || mode === 'faab') return mode
  return null
}

/** Minutes east of UTC for `timeZone` at instant `date`. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - date.getTime()) / 60000)
}

/**
 * Converts the local schedule into what the existing engine schedules on: UTC weekday indices and
 * one UTC "HH:MM". The offset is taken at `ref` (DST can move the UTC time by an hour across a
 * change; the next save re-derives it). `processingDaysUtc` is empty when no day processes.
 */
export function deriveEngineProcessingFromSchedule(
  schedule: DailyWaiverSchedule,
  timeZone: string | null | undefined,
  ref: Date = new Date(),
): { processingDaysUtc: number[]; processingTimeUtc: string } {
  const tz = safeTimeZone(timeZone)
  const offset = tzOffsetMinutes(ref, tz)
  const localMinutes = schedule.processHour * 60
  let utcMinutes = localMinutes - offset
  let dayShift = 0
  while (utcMinutes < 0) {
    utcMinutes += 1440
    dayShift -= 1
  }
  while (utcMinutes >= 1440) {
    utcMinutes -= 1440
    dayShift += 1
  }
  const hh = String(Math.floor(utcMinutes / 60)).padStart(2, '0')
  const mm = String(utcMinutes % 60).padStart(2, '0')
  const days = new Set<number>()
  if (schedule.enabled) {
    for (const key of WAIVER_DAY_KEYS) {
      if (!isWaiverProcessingMode(schedule.days[key])) continue
      days.add((((WAIVER_DAY_JS_INDEX[key] + dayShift) % 7) + 7) % 7)
    }
  }
  return { processingDaysUtc: [...days].sort((a, b) => a - b), processingTimeUtc: `${hh}:${mm}` }
}

/* ── Transaction-time enforcement (claims, add/drop, automated runs) ──────────────────────────── */

/** Settings key holding the processing schedule the league had BEFORE the daily schedule was
 *  enabled, so turning it off restores it instead of leaving the derived days behind. */
export const DAILY_WAIVER_PRIOR_PROCESSING_SETTINGS_KEY = 'af_daily_waiver_prior_processing' as const

export type PriorWaiverProcessing = {
  /** `LeagueWaiverSettings.processingDays` (UTC weekday indices) before enabling, or null. */
  processingDays: number[] | null
  /** `LeagueWaiverSettings.processingTimeUtc` before enabling, or null. */
  processingTimeUtc: string | null
  /** `League.waiverSchedule` column before enabling, or null. */
  waiverSchedule: number[] | null
  /** `League.waiverProcessTime` column before enabling, or null. */
  waiverProcessTime: string | null
}

const dayIndexArray = z.array(z.number().int().min(0).max(6))
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/)
const priorSchema = z.object({
  processingDays: dayIndexArray.nullable(),
  processingTimeUtc: hhmm.nullable(),
  waiverSchedule: dayIndexArray.nullable(),
  waiverProcessTime: hhmm.nullable(),
})

export function parsePriorWaiverProcessing(raw: unknown): PriorWaiverProcessing | null {
  const r = priorSchema.safeParse(raw)
  return r.success ? r.data : null
}

/** Coerces a stored JSON value into weekday indices, or null when it is not one. */
export function toDayIndexArray(raw: unknown): number[] | null {
  const r = dayIndexArray.safeParse(raw)
  return r.success ? r.data : null
}

export function toHhmmOrNull(raw: unknown): string | null {
  const r = hhmm.safeParse(raw)
  return r.success ? r.data : null
}

export const DAILY_LOCKED_MESSAGE =
  "All roster moves are locked today by the league's daily waiver schedule."
export const DAILY_WAIVER_DAY_MESSAGE =
  "Today is a waiver day in this league — this player must go through waivers. Submit a claim for today's waiver run."
export const DAILY_BEFORE_CLEAR_MESSAGE =
  "This player must go through waivers until today's waiver run clears; after that, unclaimed players are free agents."
export const DAILY_DROP_HOLD_MESSAGE =
  'This player was dropped recently and is still on waivers. Submit a claim for the next waiver run.'

export type DailyTransactionPolicy = {
  mode: DailyWaiverMode
  /** Waiver claims may be submitted. */
  claimsAllowed: boolean
  /** Immediate first-come adds (add/drop) are allowed right now. */
  immediateAddsAllowed: boolean
  /** Why immediate adds are refused, when they are. */
  immediateRefusal: string | null
}

function localParts(date: Date, timeZone: string | null | undefined): { ymd: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return { ymd: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 }
}

/**
 * Whether today's waiver run has cleared, for a `waivers_then_fa` day. Cleared means: the local
 * processing hour has passed AND either the run happened today after that hour, or there was nothing
 * to process (the processor writes no run when no claim is pending, so `lastRunAt` cannot be the
 * only evidence).
 */
export function hasTodaysWaiverRunCleared(
  schedule: DailyWaiverSchedule,
  now: Date,
  timeZone: string | null | undefined,
  opts: { lastRunAt: Date | null; pendingClaimCount: number },
): boolean {
  const n = localParts(now, timeZone)
  if (n.hour < schedule.processHour) return false
  if (opts.pendingClaimCount === 0) return true
  if (!opts.lastRunAt) return false
  const r = localParts(opts.lastRunAt, timeZone)
  return r.ymd === n.ymd && r.hour >= schedule.processHour
}

/**
 * What a manager may do right now under the per-day schedule. Null when the league has no enabled
 * schedule — callers keep their existing rules unchanged.
 */
export function resolveDailyTransactionPolicy(
  schedule: DailyWaiverSchedule | null | undefined,
  now: Date,
  timeZone: string | null | undefined,
  opts: { lastRunAt: Date | null; pendingClaimCount: number },
): DailyTransactionPolicy | null {
  const mode = resolveWaiverModeForDate(schedule, now, timeZone)
  if (!mode || !schedule) return null
  switch (mode) {
    case 'locked':
      return { mode, claimsAllowed: false, immediateAddsAllowed: false, immediateRefusal: DAILY_LOCKED_MESSAGE }
    case 'free_agents':
      return { mode, claimsAllowed: true, immediateAddsAllowed: true, immediateRefusal: null }
    case 'waivers_then_fa': {
      const cleared = hasTodaysWaiverRunCleared(schedule, now, timeZone, opts)
      return {
        mode,
        claimsAllowed: true,
        immediateAddsAllowed: cleared,
        immediateRefusal: cleared ? null : DAILY_BEFORE_CLEAR_MESSAGE,
      }
    }
    default:
      return { mode, claimsAllowed: true, immediateAddsAllowed: false, immediateRefusal: DAILY_WAIVER_DAY_MESSAGE }
  }
}

/** Run types the cron / queue use. A commissioner's manual run is never blocked by the schedule. */
const AUTOMATED_RUN_TYPES = new Set(['scheduled', 'queue'])

/**
 * True when an AUTOMATED waiver run must not process today: a Free-agents or Locked day. Covers
 * stale engine processing days (e.g. an all-free-agent schedule, or `nextRunAt` computed before a
 * schedule change).
 */
export function isAutomatedWaiverRunBlocked(
  settings: unknown,
  now: Date,
  timeZone: string | null | undefined,
  runType: string | null | undefined,
): boolean {
  if (!AUTOMATED_RUN_TYPES.has(runType ?? 'scheduled')) return false
  const mode = resolveWaiverModeForDate(readDailyWaiverScheduleFromSettings(settings), now, timeZone)
  return mode != null && !isWaiverProcessingMode(mode)
}

/** True when a player dropped at `droppedAt` is still inside the after-drop waiver period. */
export function isWithinDropHold(droppedAt: Date | null | undefined, now: Date, holdHours: number | null | undefined): boolean {
  if (!droppedAt || !holdHours || holdHours <= 0) return false
  return now.getTime() - droppedAt.getTime() < holdHours * 3_600_000
}
