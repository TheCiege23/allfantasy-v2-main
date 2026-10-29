/**
 * One commissioner save that touches several `League.settings` keys must keep ALL of them.
 *
 * executeLeagueSettingsPatch writes `settings` in up to five separate blocks (keeper provenance,
 * sportConfig, devyLeagueConfig, settingsMerge, daily waiver schedule). Each block used to spread
 * the `league.settings` read at the top of the request, so every block after the first silently
 * reverted the ones before it. The mock below persists writes so the test sees what the DB holds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
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
    this.resolveForUser = vi.fn().mockResolvedValue({ hasAccess: false })
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

describe('executeLeagueSettingsPatch: every League.settings key in one save sticks', () => {
  it('keeper provenance + sportConfig + devyLeagueConfig + settingsMerge all survive', async () => {
    const res = await executeLeagueSettingsPatch('u', {
      leagueId: 'L',
      keeperCostSystem: 'round_based',
      sportConfig: { nba: { gamesCap: 4 } },
      devyLeagueConfig: { devySlots: 3 },
      settingsMerge: { description: 'Friends league' },
    })
    expect(res.status).toBe(200)

    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
    expect(settingsInDb.description).toBe('Friends league')
    expect(settingsInDb.devy_league_config).toEqual({ devySlots: 3 })
    expect(settingsInDb.sportConfig).toEqual({ nba: { gamesCap: 4 } })
    const ext = (settingsInDb.conceptRules as { extensions?: Record<string, unknown> } | undefined)?.extensions
    expect(ext?.keeperProvenance).toMatchObject({ source: 'commissioner' })
  })

  it('sportConfig is not reverted by a settingsMerge in the same request', async () => {
    await executeLeagueSettingsPatch('u', {
      leagueId: 'L',
      sportConfig: { nhl: { goalieMinimum: 2 } },
      settingsMerge: { publicDashboard: true },
    })
    expect(settingsInDb.sportConfig).toEqual({ nhl: { goalieMinimum: 2 } })
    expect(settingsInDb.publicDashboard).toBe(true)
  })
})
