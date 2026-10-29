/** Lineup minimums for eliminated teams: an AF Commissioner rule saved through settingsMerge; switching it off is free. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  hasSub: false,
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn(async () => ({ hasAccess: m.hasSub }))
  }),
}))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn() }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: vi.fn() }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ refreshLeagueWaiverNextRunAt: vi.fn() }))

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'

let settingsInDb: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  settingsInDb = { inviteCode: 'KEEP-ME' }
  // A snapshot, as Prisma returns: later writes do not mutate an object already read.
  m.prisma.league.findFirst.mockImplementation(async () => ({
    id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00',
    settings: structuredClone(settingsInDb),
  }))
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: structuredClone(settingsInDb) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if ('settings' in data) settingsInDb = structuredClone(data.settings as Record<string, unknown>)
    return {}
  })
})

beforeEach(() => {
  m.hasSub = false
})

describe('executeLeagueSettingsPatch: eliminated_lineup_minimum', () => {
  it('stores the rule on the AF Commissioner plan, in the shape the reader knows', async () => {
    m.hasSub = true
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { eliminated_lineup_minimum: { enabled: true, standard: 'playable', autoFill: true, extra: 'dropped' } } })
    expect(res.status).toBe(200)
    expect(settingsInDb.eliminated_lineup_minimum).toEqual({ enabled: true, standard: 'playable', autoFill: true })
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
  })

  it('refuses to switch it on without the plan, and writes nothing', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { eliminated_lineup_minimum: { enabled: true, standard: 'filled' } } })
    expect(res.status).toBe(403)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('switching it off is free', async () => {
    settingsInDb.eliminated_lineup_minimum = { enabled: true, standard: 'filled', autoFill: false }
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { eliminated_lineup_minimum: { enabled: false } } })
    expect(res.status).toBe(200)
    expect(settingsInDb.eliminated_lineup_minimum).toEqual({ enabled: false })
  })

  it('refuses a value the reader would not understand', async () => {
    m.hasSub = true
    for (const bad of [{ enabled: true, standard: 'strict' }, { enabled: 'yes' }, 'on']) {
      expect((await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { eliminated_lineup_minimum: bad } })).status).toBe(400)
    }
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })
})
