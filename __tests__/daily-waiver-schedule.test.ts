import { describe, expect, it } from 'vitest'

import {
  DAILY_WAIVER_SCHEDULE_SETTINGS_KEY,
  defaultDailyWaiverSchedule,
  deriveEngineProcessingFromSchedule,
  engineWaiverTypeForMode,
  localWeekdayKey,
  parseDailyWaiverSchedule,
  readDailyWaiverScheduleFromSettings,
  resolveEngineWaiverTypeForDate,
  resolveWaiverModeForDate,
  scheduleUsesFaab,
  type DailyWaiverSchedule,
} from '@/lib/waivers/dailyWaiverSchedule'

function sched(over: Partial<DailyWaiverSchedule> = {}, days: Partial<DailyWaiverSchedule['days']> = {}): DailyWaiverSchedule {
  const base = defaultDailyWaiverSchedule()
  return { ...base, enabled: true, ...over, days: { ...base.days, ...days } }
}

// 2026-10-12 is a Monday.
const MON_NOON_UTC = new Date('2026-10-12T12:00:00Z')

describe('validation', () => {
  it('accepts the default and a full custom schedule', () => {
    expect(parseDailyWaiverSchedule(defaultDailyWaiverSchedule())).not.toBeNull()
    expect(parseDailyWaiverSchedule(sched({ processHour: 23 }, { mon: 'reverse_standings', tue: 'rolling', wed: 'waivers_then_fa' }))).not.toBeNull()
  })

  it.each([
    ['unknown mode', { ...sched(), days: { ...sched().days, mon: 'chaos' } }],
    ['missing day', { ...sched(), days: { mon: 'waivers' } }],
    ['extra day', { ...sched(), days: { ...sched().days, xyz: 'waivers' } }],
    ['hour 24', sched({ processHour: 24 })],
    ['fractional hour', sched({ processHour: 1.5 })],
    ['wrong version', { ...sched(), version: 2 }],
    ['extra top-level key', { ...sched(), hack: true }],
    ['null', null],
    ['string', 'waivers'],
  ])('rejects %s', (_label, raw) => {
    expect(parseDailyWaiverSchedule(raw)).toBeNull()
  })

  it('reads only from the settings key', () => {
    const s = sched()
    expect(readDailyWaiverScheduleFromSettings({ [DAILY_WAIVER_SCHEDULE_SETTINGS_KEY]: s })).toEqual(s)
    expect(readDailyWaiverScheduleFromSettings({ other: s })).toBeNull()
    expect(readDailyWaiverScheduleFromSettings(null)).toBeNull()
    expect(readDailyWaiverScheduleFromSettings([s])).toBeNull()
  })
})

describe('resolveWaiverModeForDate', () => {
  const s = sched({}, { mon: 'reverse_standings', tue: 'rolling', wed: 'waivers_then_fa', sun: 'locked' })

  it('uses the LEAGUE-LOCAL weekday, not the UTC one', () => {
    // Tue 2026-10-13 02:00 UTC is still Monday evening in New York, already Tuesday in London.
    const at = new Date('2026-10-13T02:00:00Z')
    expect(localWeekdayKey(at, 'America/New_York')).toBe('mon')
    expect(localWeekdayKey(at, 'Europe/London')).toBe('tue')
    expect(resolveWaiverModeForDate(s, at, 'America/New_York')).toBe('reverse_standings')
    expect(resolveWaiverModeForDate(s, at, 'Europe/London')).toBe('rolling')
  })

  it('every day maps', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 7; i += 1) seen.add(localWeekdayKey(new Date(MON_NOON_UTC.getTime() + i * 86_400_000), 'UTC'))
    expect([...seen].sort()).toEqual(['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed'])
  })

  it('null when disabled or absent; a bad timezone falls back instead of throwing', () => {
    expect(resolveWaiverModeForDate({ ...s, enabled: false }, MON_NOON_UTC, 'UTC')).toBeNull()
    expect(resolveWaiverModeForDate(null, MON_NOON_UTC, 'UTC')).toBeNull()
    expect(resolveWaiverModeForDate(s, MON_NOON_UTC, 'Not/AZone')).toBe('reverse_standings')
  })
})

describe('engine types', () => {
  it('a day naming a type overrides; league-type days and non-processing days keep the configured type', () => {
    const settings = { [DAILY_WAIVER_SCHEDULE_SETTINGS_KEY]: sched({}, { mon: 'faab', tue: 'waivers', wed: 'free_agents' }) }
    expect(resolveEngineWaiverTypeForDate(settings, MON_NOON_UTC, 'UTC')).toBe('faab')
    expect(resolveEngineWaiverTypeForDate(settings, new Date('2026-10-13T12:00:00Z'), 'UTC')).toBeNull()
    expect(resolveEngineWaiverTypeForDate(settings, new Date('2026-10-14T12:00:00Z'), 'UTC')).toBeNull()
    expect(resolveEngineWaiverTypeForDate({}, MON_NOON_UTC, 'UTC')).toBeNull()
  })

  it('engineWaiverTypeForMode', () => {
    expect(engineWaiverTypeForMode('waivers', 'faab')).toBe('faab')
    expect(engineWaiverTypeForMode('waivers_then_fa', 'reverse_standings')).toBe('reverse_standings')
    expect(engineWaiverTypeForMode('rolling', 'faab')).toBe('rolling')
    expect(engineWaiverTypeForMode('free_agents', 'faab')).toBeNull()
    expect(engineWaiverTypeForMode('locked', 'faab')).toBeNull()
  })

  it('scheduleUsesFaab: main type FAAB, or any processing day that resolves to FAAB', () => {
    const noFaab = sched({}, { mon: 'rolling', tue: 'reverse_standings', wed: 'waivers', thu: 'free_agents', fri: 'free_agents', sat: 'free_agents', sun: 'locked' })
    expect(scheduleUsesFaab(noFaab, 'rolling')).toBe(false)
    expect(scheduleUsesFaab(noFaab, 'faab')).toBe(true)
    expect(scheduleUsesFaab({ ...noFaab, days: { ...noFaab.days, sat: 'faab' } }, 'rolling')).toBe(true)
    // A disabled schedule's FAAB day does not count.
    expect(scheduleUsesFaab({ ...noFaab, enabled: false, days: { ...noFaab.days, sat: 'faab' } }, 'rolling')).toBe(false)
    expect(scheduleUsesFaab(null, 'rolling')).toBe(false)
  })
})

describe('deriveEngineProcessingFromSchedule', () => {
  it('UTC zone: processing days are the waiver days, time unchanged', () => {
    const s = sched({ processHour: 3 }, { mon: 'rolling', tue: 'free_agents', wed: 'waivers_then_fa', thu: 'free_agents', fri: 'free_agents', sat: 'free_agents', sun: 'locked' })
    expect(deriveEngineProcessingFromSchedule(s, 'UTC', MON_NOON_UTC)).toEqual({ processingDaysUtc: [1, 3], processingTimeUtc: '03:00' })
  })

  it('a late local hour west of UTC rolls into the NEXT UTC day', () => {
    // 22:00 EDT (UTC-4, October) = 02:00 UTC the following day.
    const s = sched({ processHour: 22 }, { mon: 'rolling', tue: 'free_agents', wed: 'free_agents', thu: 'free_agents', fri: 'free_agents', sat: 'free_agents', sun: 'waivers' })
    expect(deriveEngineProcessingFromSchedule(s, 'America/New_York', MON_NOON_UTC)).toEqual({ processingDaysUtc: [1, 2], processingTimeUtc: '02:00' })
  })

  it('an early local hour east of UTC rolls into the PREVIOUS UTC day', () => {
    // 01:00 in Tokyo (UTC+9) = 16:00 UTC the day before; Monday → Sunday (0).
    const s = sched({ processHour: 1 }, { mon: 'faab', tue: 'free_agents', wed: 'free_agents', thu: 'free_agents', fri: 'free_agents', sat: 'free_agents', sun: 'locked' })
    expect(deriveEngineProcessingFromSchedule(s, 'Asia/Tokyo', MON_NOON_UTC)).toEqual({ processingDaysUtc: [0], processingTimeUtc: '16:00' })
  })

  it('a disabled schedule or one with no processing day yields no days', () => {
    expect(deriveEngineProcessingFromSchedule({ ...sched(), enabled: false }, 'UTC', MON_NOON_UTC).processingDaysUtc).toEqual([])
    const none = sched({}, { mon: 'free_agents', tue: 'locked', wed: 'free_agents', thu: 'free_agents', fri: 'free_agents', sat: 'free_agents', sun: 'locked' })
    expect(deriveEngineProcessingFromSchedule(none, 'UTC', MON_NOON_UTC).processingDaysUtc).toEqual([])
  })
})

/* ── Transaction-time enforcement ─────────────────────────────────────────────────────────────── */
import {
  DAILY_BEFORE_CLEAR_MESSAGE,
  DAILY_LOCKED_MESSAGE,
  DAILY_WAIVER_DAY_MESSAGE,
  hasTodaysWaiverRunCleared,
  isAutomatedWaiverRunBlocked,
  isWithinDropHold,
  parsePriorWaiverProcessing,
  resolveDailyTransactionPolicy,
  toDayIndexArray,
} from '@/lib/waivers/dailyWaiverSchedule'
import { assertDailyScheduleAllowsClaim } from '@/lib/waiver-wire/waiver-validation'
import { nextRunAtForSchedule } from '@/lib/waiver-wire/waiver-state-service'

describe('resolveDailyTransactionPolicy', () => {
  // Mon locked, Tue free agents, Wed waivers → FA (process 03:00), Thu rolling.
  const s = sched({ processHour: 3 }, { mon: 'locked', tue: 'free_agents', wed: 'waivers_then_fa', thu: 'rolling' })
  const none = { lastRunAt: null, pendingClaimCount: 0 }

  it('null without an enabled schedule (existing rules apply)', () => {
    expect(resolveDailyTransactionPolicy(null, MON_NOON_UTC, 'UTC', none)).toBeNull()
    expect(resolveDailyTransactionPolicy({ ...s, enabled: false }, MON_NOON_UTC, 'UTC', none)).toBeNull()
  })

  it('Locked day: no claims, no adds, clear message', () => {
    const p = resolveDailyTransactionPolicy(s, MON_NOON_UTC, 'UTC', none)!
    expect(p).toMatchObject({ mode: 'locked', claimsAllowed: false, immediateAddsAllowed: false, immediateRefusal: DAILY_LOCKED_MESSAGE })
    expect(assertDailyScheduleAllowsClaim(p)).toEqual({ ok: false, message: DAILY_LOCKED_MESSAGE })
  })

  it('Free-agents day: instant first-come adds', () => {
    const p = resolveDailyTransactionPolicy(s, new Date('2026-10-13T12:00:00Z'), 'UTC', none)!
    expect(p).toMatchObject({ mode: 'free_agents', claimsAllowed: true, immediateAddsAllowed: true, immediateRefusal: null })
    expect(assertDailyScheduleAllowsClaim(p)).toEqual({ ok: true })
  })

  it('Waiver-type day: claims only', () => {
    const p = resolveDailyTransactionPolicy(s, new Date('2026-10-15T12:00:00Z'), 'UTC', none)!
    expect(p).toMatchObject({ mode: 'rolling', claimsAllowed: true, immediateAddsAllowed: false, immediateRefusal: DAILY_WAIVER_DAY_MESSAGE })
  })

  it('Waivers → Free agents: waivers until the run clears, then instant adds for the rest of the day', () => {
    const before = new Date('2026-10-14T02:00:00Z')
    const after = new Date('2026-10-14T09:00:00Z')
    expect(resolveDailyTransactionPolicy(s, before, 'UTC', none)).toMatchObject({ immediateAddsAllowed: false, immediateRefusal: DAILY_BEFORE_CLEAR_MESSAGE })
    // Past the hour, nothing pending → cleared (the processor writes no run when nothing is pending).
    expect(resolveDailyTransactionPolicy(s, after, 'UTC', none)).toMatchObject({ immediateAddsAllowed: true })
    // Past the hour, claims still pending, no run yet today → not cleared.
    expect(resolveDailyTransactionPolicy(s, after, 'UTC', { lastRunAt: new Date('2026-10-13T03:05:00Z'), pendingClaimCount: 2 })).toMatchObject({ immediateAddsAllowed: false })
    // Today's run happened after the hour → cleared even with new pending claims.
    expect(resolveDailyTransactionPolicy(s, after, 'UTC', { lastRunAt: new Date('2026-10-14T03:01:00Z'), pendingClaimCount: 2 })).toMatchObject({ immediateAddsAllowed: true })
  })

  it('hasTodaysWaiverRunCleared reads the run in LEAGUE-local time', () => {
    // NY: processHour 3 local = 07:00 UTC (EDT). Run at 07:30 UTC is today 03:30 local.
    const ny = sched({ processHour: 3 })
    expect(hasTodaysWaiverRunCleared(ny, new Date('2026-10-14T12:00:00Z'), 'America/New_York', { lastRunAt: new Date('2026-10-14T07:30:00Z'), pendingClaimCount: 1 })).toBe(true)
    // A run at 05:00 UTC is 01:00 local — before the hour, so not today's clear.
    expect(hasTodaysWaiverRunCleared(ny, new Date('2026-10-14T12:00:00Z'), 'America/New_York', { lastRunAt: new Date('2026-10-14T05:00:00Z'), pendingClaimCount: 1 })).toBe(false)
  })
})

describe('automated runs and the after-drop hold', () => {
  const settings = { [DAILY_WAIVER_SCHEDULE_SETTINGS_KEY]: sched({}, { mon: 'free_agents', tue: 'locked', wed: 'rolling' }) }

  it('an automated run on a Free-agents or Locked day is blocked; manual runs and waiver days are not', () => {
    expect(isAutomatedWaiverRunBlocked(settings, MON_NOON_UTC, 'UTC', 'scheduled')).toBe(true)
    expect(isAutomatedWaiverRunBlocked(settings, new Date('2026-10-13T12:00:00Z'), 'UTC', 'queue')).toBe(true)
    expect(isAutomatedWaiverRunBlocked(settings, MON_NOON_UTC, 'UTC', undefined)).toBe(true)
    expect(isAutomatedWaiverRunBlocked(settings, MON_NOON_UTC, 'UTC', 'manual')).toBe(false)
    expect(isAutomatedWaiverRunBlocked(settings, new Date('2026-10-14T12:00:00Z'), 'UTC', 'scheduled')).toBe(false)
    expect(isAutomatedWaiverRunBlocked({}, MON_NOON_UTC, 'UTC', 'scheduled')).toBe(false)
  })

  it('isWithinDropHold', () => {
    const now = new Date('2026-10-14T12:00:00Z')
    expect(isWithinDropHold(new Date('2026-10-14T00:00:00Z'), now, 24)).toBe(true)
    expect(isWithinDropHold(new Date('2026-10-13T11:00:00Z'), now, 24)).toBe(false)
    expect(isWithinDropHold(new Date('2026-10-14T11:00:00Z'), now, 0)).toBe(false)
    expect(isWithinDropHold(null, now, 24)).toBe(false)
  })
})

describe('prior processing + next run', () => {
  it('parses the stored prior schedule strictly', () => {
    const prior = { processingDays: [2], processingTimeUtc: '09:00', waiverSchedule: null, waiverProcessTime: '02:00' }
    expect(parsePriorWaiverProcessing(prior)).toEqual(prior)
    expect(parsePriorWaiverProcessing({ ...prior, processingDays: [9] })).toBeNull()
    expect(toDayIndexArray([0, 6])).toEqual([0, 6])
    expect(toDayIndexArray({ mon: 1 })).toBeNull()
  })

  it('nextRunAtForSchedule: an enabled all-free-agent week has NO next run; otherwise the existing calculator', () => {
    const now = new Date('2026-10-12T12:00:00Z') // Monday
    expect(nextRunAtForSchedule(now, { processingDayOfWeek: 3, processingTimeUtc: '09:00', processingDays: [], dailyScheduleEnabled: true })).toBeNull()
    // Same input without a schedule falls back to processingDayOfWeek (Wednesday).
    expect(nextRunAtForSchedule(now, { processingDayOfWeek: 3, processingTimeUtc: '09:00', processingDays: [], dailyScheduleEnabled: false })).toBe('2026-10-14T09:00:00.000Z')
    expect(nextRunAtForSchedule(now, { processingDayOfWeek: 3, processingTimeUtc: '07:00', processingDays: [2, 5], dailyScheduleEnabled: true })).toBe('2026-10-13T07:00:00.000Z')
  })
})
