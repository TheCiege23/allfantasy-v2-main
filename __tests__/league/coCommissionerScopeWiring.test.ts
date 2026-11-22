import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
  },
  syncDraft: vi.fn(),
  syncDerived: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
const requireRole = vi.hoisted(() => vi.fn())
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: requireRole }))
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

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'


/**
 * The league-settings save asks the gate for the permission area(s) the change touches, so a
 * co-commissioner limited to e.g. trades cannot change scoring through the generic settings PATCH.
 * And every scoped route passes its area (a route that forgets it silently gives limited
 * co-commissioners full rights there).
 */
import { readFileSync } from 'node:fs'

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.league.findFirst.mockResolvedValue(null)
})

describe('executeLeagueSettingsPatch → requireCommissionerRole scopes', () => {
  it.each([
    [{ tradeReviewHours: 24 }, undefined, ['trades']],
    [{ keeperCount: 2, rounds: 14 }, 'draft', ['rosters', 'league']],
    [{ settingsMerge: { scoring_rules: {} } }, 'scoring', ['scoring']],
  ])('%j (section %s) → %j', async (patch, section, scopes) => {
    requireRole.mockResolvedValue(undefined)
    await executeLeagueSettingsPatch('u', { leagueId: 'L', ...patch }, section ? { section } : undefined)
    expect(requireRole).toHaveBeenCalledWith('L', 'u', scopes)
  })

  it('a refusal from the gate is returned as-is and nothing is read or written', async () => {
    requireRole.mockRejectedValue(new Response(JSON.stringify({ error: 'nope', missingScopes: ['trades'] }), { status: 403 }))
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', tradeReviewHours: 24 })
    expect(res.status).toBe(403)
    expect(m.prisma.league.findFirst).not.toHaveBeenCalled()
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })
})

describe('co-commissioner permissions cannot be written through the generic settings patch', () => {
  it('🛑 settingsMerge carrying co_commissioner_scopes is refused before anything is written', async () => {
    requireRole.mockResolvedValue(undefined)
    m.prisma.league.findFirst.mockResolvedValue({
      id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
      waiverSchedule: null, waiverProcessTime: '02:00', settings: {},
    })
    const res = await executeLeagueSettingsPatch('co', {
      leagueId: 'L',
      settingsMerge: { co_commissioner_scopes: { myTeam: ['scoring', 'rosters', 'trades', 'money', 'chat', 'league'] } },
    })
    expect(res.status).toBe(400)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('an ordinary settingsMerge key still saves', async () => {
    requireRole.mockResolvedValue(undefined)
    m.prisma.league.findFirst.mockResolvedValue({
      id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
      waiverSchedule: null, waiverProcessTime: '02:00', settings: {},
    })
    m.prisma.league.findUnique.mockResolvedValue({ settings: {} })
    m.prisma.league.update.mockResolvedValue({})
    m.prisma.leagueSettings.upsert.mockResolvedValue({ updatedAt: new Date() })
    const res = await executeLeagueSettingsPatch('co', { leagueId: 'L', settingsMerge: { publicStandings: true } })
    expect(res.status).toBe(200)
    expect(m.prisma.league.update).toHaveBeenCalled()
  })
})

describe('scoped routes pass their permission area', () => {
  const line = (path: string, re: RegExp) => readFileSync(path, 'utf8').split('\n').filter((l) => re.test(l) && !/^\s*(\*|\/\/)/.test(l))
  it.each([
    ['app/api/leagues/[leagueId]/finance/manual-payment/route.ts', 'money'],
    ['app/api/leagues/[leagueId]/finance/settings/route.ts', 'money'],
    ['app/api/leagues/[leagueId]/finance/waive/route.ts', 'money'],
    ['app/api/zombie/payment-tracker/route.ts', 'money'],
    ['app/api/leagues/[leagueId]/rosters/[rosterId]/commissioner-override/route.ts', 'rosters'],
    ['app/api/keeper/selections/route.ts', 'rosters'],
    ['app/api/keeper/session/route.ts', 'rosters'],
    ['app/api/keeper/draft-prep/route.ts', 'rosters'],
    ['app/api/redraft/lineup-lock/route.ts', 'rosters'],
    ['app/api/redraft/trades/veto/route.ts', 'trades'],
    ['app/api/redraft/trade-votes/route.ts', 'trades'],
    ['app/api/redraft/playoffs/generate/route.ts', 'league'],
    ['app/api/redraft/playoffs/advance/route.ts', 'league'],
    ['app/api/redraft/seasons/finalize/route.ts', 'league'],
    ['app/api/league/settings/randomize-order/route.ts', 'league'],
    ['app/api/league/refresh/route.ts', 'league'],
    ['app/api/bestball/settings/route.ts', 'league'],
    ['app/api/guillotine/season/route.ts', 'league'],
    ['app/api/guillotine/endgame/route.ts', 'league'],
    ['app/api/survivor/commissioner/route.ts', 'league'],
    ['lib/commissioner/broadcastAccess.ts', 'chat'],
  ])('%s → %s', (path, scope) => {
    const calls = line(path, /(requireCommissionerRole|hasLeagueCommissionerRights|canManageLeague|commissionerGuard|coCommissionerAllowed)\(/)
    expect(calls.some((l) => l.includes(`'${scope}'`))).toBe(true)
  })
})
