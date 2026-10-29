/**
 * Saving the per-day waiver schedule through the real settings PATCH pipeline:
 * - enabling derives the engine processing days AND remembers the league's prior schedule;
 * - an all Free-agents / Locked week writes [] (no stale day survives);
 * - turning it off restores the prior processing schedule and forgets the backup;
 * - every change recomputes LeagueWaiverState.nextRunAt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
  },
  upsertWaiverSettings: vi.fn(),
  refreshNextRun: vi.fn(),
  derivedSync: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn().mockResolvedValue({ hasAccess: false })
  }),
}))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn() }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: m.derivedSync }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: m.upsertWaiverSettings }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ refreshLeagueWaiverNextRunAt: m.refreshNextRun }))

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import {
  DAILY_WAIVER_PRIOR_PROCESSING_SETTINGS_KEY as PRIOR,
  DAILY_WAIVER_SCHEDULE_SETTINGS_KEY as KEY,
  defaultDailyWaiverSchedule,
  type DailyWaiverSchedule,
} from '@/lib/waivers/dailyWaiverSchedule'

let leagueRow: Record<string, unknown>
let settingsInDb: Record<string, unknown>

function schedule(over: Partial<DailyWaiverSchedule> = {}, days: Partial<DailyWaiverSchedule['days']> = {}): DailyWaiverSchedule {
  const b = defaultDailyWaiverSchedule()
  return { ...b, enabled: true, processHour: 3, ...over, days: { ...b.days, ...days } }
}

/** All `League` column patches (the update calls that do not write `settings`). */
function columnPatches() {
  return m.prisma.league.update.mock.calls.map((c) => c[0].data).filter((d) => !('settings' in d))
}
function lastSettingsWrite(): Record<string, unknown> {
  const writes = m.prisma.league.update.mock.calls.map((c) => c[0].data).filter((d) => 'settings' in d)
  return writes.at(-1)!.settings as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  settingsInDb = {}
  leagueRow = {
    id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00',
    get settings() { return settingsInDb },
  }
  m.prisma.league.findFirst.mockImplementation(async () => leagueRow)
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: settingsInDb }))
  m.prisma.league.update.mockResolvedValue({})
  m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue({ processingDays: [2], processingTimeUtc: '09:00' })
  m.refreshNextRun.mockResolvedValue(null)
})

describe('daily waiver schedule through executeLeagueSettingsPatch', () => {
  it('enabling: derives UTC days, stores the schedule and the PRIOR engine schedule, refreshes nextRunAt', async () => {
    const s = schedule({}, { mon: 'rolling', wed: 'waivers_then_fa', tue: 'free_agents', thu: 'free_agents', fri: 'free_agents', sat: 'free_agents', sun: 'locked' })
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', dailyWaiverSchedule: s }, { section: 'waivers' })
    expect(res.status).toBe(200)
    expect(columnPatches()[0]).toMatchObject({ customDailyWaivers: true, waiverSchedule: [1, 3], waiverProcessTime: '03:00' })
    const written = lastSettingsWrite()
    expect(written[KEY]).toEqual(s)
    expect(written[PRIOR]).toEqual({ processingDays: [2], processingTimeUtc: '09:00', waiverSchedule: null, waiverProcessTime: '02:00' })
    expect(m.derivedSync).toHaveBeenCalledWith('L', expect.arrayContaining(['customDailyWaivers', 'waiverSchedule', 'waiverProcessTime']))
    expect(m.refreshNextRun).toHaveBeenCalledWith('L')
    expect(m.upsertWaiverSettings).not.toHaveBeenCalled()
  })

  it('an all Free-agents / Locked week writes NO processing days rather than leaving stale ones', async () => {
    settingsInDb = { [KEY]: schedule({}, { mon: 'rolling' }), [PRIOR]: { processingDays: [2], processingTimeUtc: '09:00', waiverSchedule: null, waiverProcessTime: '02:00' } }
    const s = schedule({}, { mon: 'free_agents', tue: 'free_agents', wed: 'locked', thu: 'free_agents', fri: 'free_agents', sat: 'free_agents', sun: 'locked' })
    await executeLeagueSettingsPatch('u', { leagueId: 'L', dailyWaiverSchedule: s }, { section: 'waivers' })
    expect(columnPatches()[0]).toMatchObject({ customDailyWaivers: true, waiverSchedule: [] })
    // Already enabled: the original prior is kept, not overwritten with derived days.
    expect(lastSettingsWrite()[PRIOR]).toEqual(settingsInDb[PRIOR])
    expect(m.prisma.leagueWaiverSettings.findUnique).not.toHaveBeenCalled()
    expect(m.refreshNextRun).toHaveBeenCalledWith('L')
  })

  it('turning it OFF restores the prior processing schedule and forgets the backup', async () => {
    const prior = { processingDays: [2], processingTimeUtc: '09:00', waiverSchedule: [2], waiverProcessTime: '02:00' }
    settingsInDb = { [KEY]: schedule({}, { mon: 'rolling' }), [PRIOR]: prior }
    leagueRow.waiverSchedule = [1, 3]
    await executeLeagueSettingsPatch('u', { leagueId: 'L', dailyWaiverSchedule: { ...schedule(), enabled: false } }, { section: 'waivers' })
    expect(columnPatches()[0]).toMatchObject({ customDailyWaivers: false, waiverSchedule: [2], waiverProcessTime: '02:00' })
    expect(m.upsertWaiverSettings).toHaveBeenCalledWith('L', { processingDays: [2], processingTimeUtc: '09:00' })
    expect(lastSettingsWrite()).not.toHaveProperty(PRIOR)
    expect((lastSettingsWrite()[KEY] as DailyWaiverSchedule).enabled).toBe(false)
    expect(m.refreshNextRun).toHaveBeenCalledWith('L')
  })

  it('turning it off with no stored prior clears the derived days (engine falls back to its single day)', async () => {
    settingsInDb = { [KEY]: schedule({}, { mon: 'rolling' }) }
    await executeLeagueSettingsPatch('u', { leagueId: 'L', dailyWaiverSchedule: { ...schedule(), enabled: false } }, { section: 'waivers' })
    expect(columnPatches()[0]).toMatchObject({ customDailyWaivers: false, waiverSchedule: Prisma.JsonNull })
    expect(m.upsertWaiverSettings).toHaveBeenCalledWith('L', { processingDays: Prisma.JsonNull, processingTimeUtc: undefined })
  })

  it('saving a still-disabled schedule touches no processing days', async () => {
    await executeLeagueSettingsPatch('u', { leagueId: 'L', dailyWaiverSchedule: { ...schedule(), enabled: false } }, { section: 'waivers' })
    expect(columnPatches()[0]).toEqual({ customDailyWaivers: false })
    expect(m.upsertWaiverSettings).not.toHaveBeenCalled()
  })

  it('rejects a malformed schedule before writing anything', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', dailyWaiverSchedule: { enabled: true } }, { section: 'waivers' })
    expect(res.status).toBe(400)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })
})
