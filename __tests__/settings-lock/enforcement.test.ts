import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
  },
  syncDraft: vi.fn(),
  syncDerived: vi.fn(),
  lockedForPatch: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn().mockResolvedValue({ hasAccess: false })
  }),
}))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: m.syncDraft }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: m.syncDerived }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ refreshLeagueWaiverNextRunAt: vi.fn() }))
vi.mock('@/lib/league/settingsLockService', () => ({ lockedGroupsForPatch: m.lockedForPatch }))

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'

import { readFileSync } from 'node:fs'

/**
 * The settings lock is enforced where settings are written: the generic settings patch (by the
 * values that would change) and every route that writes one area of the rules.
 */

const LEAGUE = {
  id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
  waiverSchedule: null, waiverProcessTime: '02:00', tradeReviewHours: 24, settings: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.league.findFirst.mockResolvedValue(structuredClone(LEAGUE))
  m.prisma.league.findUnique.mockResolvedValue({ settings: {} })
  m.prisma.league.update.mockResolvedValue({})
  m.prisma.leagueSettings.upsert.mockResolvedValue({ updatedAt: new Date() })
  m.lockedForPatch.mockResolvedValue([])
})

describe('executeLeagueSettingsPatch and the settings lock', () => {
  it('🛑 a change in a locked area is refused with 423, naming it, and nothing is written', async () => {
    m.lockedForPatch.mockResolvedValue(['trades'])
    const res = await executeLeagueSettingsPatch('comm', { leagueId: 'L', tradeReviewHours: 48 })
    expect(res.status).toBe(423)
    expect((await res.json()).error).toMatch(/^Trades settings are locked for the season/)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
    expect(m.lockedForPatch).toHaveBeenCalledWith('L', expect.objectContaining({ id: 'L', tradeReviewHours: 24 }), expect.objectContaining({ tradeReviewHours: 48 }))
  })

  it('🛑 the lock itself cannot be rewritten through settingsMerge', async () => {
    const res = await executeLeagueSettingsPatch('comm', { leagueId: 'L', settingsMerge: { settings_lock: null } })
    expect(res.status).toBe(400)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('nothing locked: the save goes through', async () => {
    const res = await executeLeagueSettingsPatch('comm', { leagueId: 'L', tradeReviewHours: 48 })
    expect(res.status).toBe(200)
    expect(m.prisma.league.update).toHaveBeenCalled()
  })

  it('a lock check that throws does not brick the save (fails open)', async () => {
    m.lockedForPatch.mockRejectedValue(new Error('db down'))
    const res = await executeLeagueSettingsPatch('comm', { leagueId: 'L', tradeReviewHours: 48 })
    expect(res.status).toBe(200)
  })
})

describe('every route that writes one area checks that area', () => {
  const base = 'app/api/commissioner/leagues/[leagueId]/'
  const calls = (path: string) =>
    readFileSync(path, 'utf8').split('\n').filter((l) => /settings(Patch)?LockedResponse\(/.test(l) && !/^\s*(\*|\/\/|import)/.test(l))
  it.each([
    ['scoring/route.ts', 'scoring'], ['nfl-scoring/route.ts', 'scoring'], ['nba-scoring/route.ts', 'scoring'],
    ['mlb-scoring/route.ts', 'scoring'], ['nhl-scoring/route.ts', 'scoring'], ['ncaab-scoring/route.ts', 'scoring'],
    ['ncaaf-scoring/route.ts', 'scoring'], ['soccer-scoring/route.ts', 'scoring'], ['idp/apply-scoring-preset/route.ts', 'scoring'],
    ['idp/scoring-overrides/route.ts', 'scoring'], ['roster-settings/route.ts', 'rosters'], ['roster-settings/import/route.ts', 'rosters'],
    ['roster-settings/reset-default/route.ts', 'rosters'], ['playoff-settings/route.ts', 'playoffs'], ['playoffs/route.ts', 'playoffs'],
  ])('%s → %s', (file, group) => {
    const found = calls(base + file)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain(`'${group}'`)
  })
  it.each([['route.ts'], ['settings/route.ts']])('the %s settings PATCH checks the patch by value', (file) => {
    expect(calls(base + file).some((l) => l.includes('settingsPatchLockedResponse('))).toBe(true)
  })
})
