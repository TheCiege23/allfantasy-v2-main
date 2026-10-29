/**
 * The Taxi squad section saves `taxiSlots` through PATCH /api/league/settings
 * (executeLeagueSettingsPatch). NHL / MLB have no prospect pool (lib/league-creation/prospectStashPolicy.ts),
 * so that route refuses a taxi INCREASE for them; keeping or lowering is allowed. NFL / NBA unchanged.
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
vi.mock('@/lib/league/settingsLifecycleGate', () => ({
  decideSettingsEdit: vi.fn().mockResolvedValue({ ok: true, midSeason: false }),
  lifecycleSectionsTouchedByPatch: vi.fn().mockReturnValue([]),
  recordMidSeasonSettingsChange: vi.fn(),
}))
vi.mock('@/lib/league/settingsLockService', () => ({ lockedGroupsForPatch: vi.fn().mockResolvedValue([]) }))
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
import { PROSPECT_STASH_UNAVAILABLE_CODE } from '@/lib/league-creation/prospectStashPolicy'

function leagueRow(sport: string, taxiSlots: number | null) {
  return {
    id: 'L', sport, taxiSlots, platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00', settings: {},
  }
}

function taxiWrites() {
  return m.prisma.league.update.mock.calls.filter(([arg]) => 'taxiSlots' in ((arg as { data: Record<string, unknown> }).data ?? {}))
}

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.league.findUnique.mockResolvedValue({ settings: {} })
  m.prisma.league.update.mockResolvedValue({})
})

describe('PATCH league settings: taxiSlots for NHL / MLB', () => {
  it.each([
    ['NHL', 0, 1],
    ['MLB', 0, 4],
    ['NHL', 3, 4],
    ['MLB', null, 2],
  ])('%s: %s → %s is refused with 400 and the policy code, writing nothing', async (sport, before, next) => {
    m.prisma.league.findFirst.mockResolvedValue(leagueRow(sport, before))
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', taxiSlots: next })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: PROSPECT_STASH_UNAVAILABLE_CODE })
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it.each([
    ['NHL', 3, 1],
    ['MLB', 4, 0],
    ['NHL', 2, 2],
  ])('%s: %s → %s (keep or lower) is not refused', async (sport, before, next) => {
    m.prisma.league.findFirst.mockResolvedValue(leagueRow(sport, before))
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', taxiSlots: next })
    expect(res.status).not.toBe(400)
    expect(taxiWrites().length).toBeGreaterThan(0)
  })

  it.each(['NFL', 'NBA'])('%s: raising taxi is unchanged', async (sport) => {
    m.prisma.league.findFirst.mockResolvedValue(leagueRow(sport, 0))
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', taxiSlots: 5 })
    expect(res.status).not.toBe(400)
    expect(taxiWrites().length).toBeGreaterThan(0)
  })
})
