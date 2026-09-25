import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The waiver wire, DB-first. Native leagues read the waiver engine's own tables; imported leagues
 * report only what the import stored — and say plainly that pending claims on the platform are not
 * visible, because "no claims" and "claims we cannot see" must never read the same.
 */

const h = vi.hoisted(() => ({
  membership: vi.fn(),
  league: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  teamFindMany: vi.fn(async () => [
    { platformUserId: 'u1', teamName: 'Casey Crushers' },
    { platformUserId: 'u2', teamName: 'Jordan Juggernauts' },
  ]),
  teamFindFirst: vi.fn(async () => null),
  claims: vi.fn(),
  transactions: vi.fn(),
  settings: vi.fn(),
  state: vi.fn(),
  names: vi.fn(async (_s: string, ids: string[]) => new Map(ids.map((id) => [id, { name: `Player ${id}`, position: 'WR', team: 'KC', injury: null }]))),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.league },
    roster: { findFirst: h.rosterFindFirst, findMany: h.rosterFindMany },
    leagueTeam: { findMany: h.teamFindMany, findFirst: h.teamFindFirst },
    waiverClaim: { findMany: h.claims },
    waiverTransaction: { findMany: h.transactions },
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.membership }))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({ resolveNames: h.names }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: h.settings }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: h.state }))

import { buildWaiverStatusContext } from '@/lib/chimmy/tools/waiverStatusTool'

const NOW = new Date('2026-09-25T15:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  h.membership.mockResolvedValue({ ok: true })
  h.league.mockResolvedValue({ id: 'L1', name: 'KBFL', sport: 'NFL', platform: 'allfantasy', settings: {} })
  h.rosterFindFirst.mockResolvedValue({ id: 'r1', platformUserId: 'u1', faabRemaining: 63, waiverPriority: 4, settings: null, playerData: {} })
  h.rosterFindMany.mockResolvedValue([
    { id: 'r1', platformUserId: 'u1', waiverPriority: 4, faabRemaining: 63 },
    { id: 'r2', platformUserId: 'u2', waiverPriority: 1, faabRemaining: 90 },
  ])
  h.claims.mockResolvedValue([{ addPlayerId: 'p1', dropPlayerId: 'p2', faabBid: 17, priorityOrder: 1 }])
  h.transactions.mockResolvedValue([{ rosterId: 'r2', addPlayerId: 'p3', dropPlayerId: null, faabSpent: 22, processedAt: new Date('2026-09-24T07:00:00Z') }])
  h.settings.mockResolvedValue({
    waiverType: 'faab',
    normalizedWaiverType: 'faab',
    faabBudget: 100,
    faabMinBid: 0,
    processingDayOfWeek: 3,
    processingTimeUtc: '07:00',
    processingDays: null,
    claimLimitPerWeek: null,
    claimLimitPerPeriod: null,
    claimLimitPerRun: null,
    instantFaAfterClear: true,
  })
  h.state.mockResolvedValue({ nextRunAt: new Date('2026-09-30T07:00:00Z'), lastRunAt: new Date('2026-09-24T07:00:00Z'), processingLocked: false })
})

describe('get_waiver_status — native league', () => {
  it("reports the rules, the user's FAAB and priority, their pending claims, order and recent results", async () => {
    const out = await buildWaiverStatusContext({ leagueId: 'L1', userId: 'u1', now: NOW })
    expect(out).toMatch(/Waiver type: FAAB/)
    expect(out).toMatch(/FAAB budget: \$100 per team/)
    expect(out).toMatch(/Next waiver run: Wed, Sep 30, 3:00 AM ET/)
    expect(out).toMatch(/THIS USER: \$63 FAAB left, waiver priority #4/)
    expect(out).toMatch(/add Player p1, drop Player p2 — bid \$17/)
    expect(out).toMatch(/Waiver order: #1 Jordan Juggernauts, \$90; #4 Casey Crushers \(you\), \$63/)
    expect(out).toMatch(/Jordan Juggernauts added Player p3 for \$22/)
    expect(out).toMatch(/Other managers' pending claims are private/)
    /* Only the asker's own pending claims are read. */
    expect(h.claims.mock.calls[0]![0].where).toEqual({ leagueId: 'L1', rosterId: 'r1', status: 'pending' })
  })

  it('says NO pending claims in words when there are none', async () => {
    h.claims.mockResolvedValue([])
    expect(await buildWaiverStatusContext({ leagueId: 'L1', userId: 'u1', now: NOW })).toMatch(/has NO pending waiver claims/)
  })

  it('reads nothing for a non-member', async () => {
    h.membership.mockResolvedValue({ ok: false })
    expect(await buildWaiverStatusContext({ leagueId: 'L1', userId: 'u1', now: NOW })).toMatch(/NOT read/)
    expect(h.claims).not.toHaveBeenCalled()
  })
})

describe('get_waiver_status — imported league', () => {
  beforeEach(() => {
    h.league.mockResolvedValue({
      id: 'L1',
      name: 'Dynasty',
      sport: 'NFL',
      platform: 'sleeper',
      settings: { settings: { waiver_type: 2, waiver_budget: 200, waiver_day_of_week: 3 } },
    })
    h.rosterFindFirst.mockResolvedValue({ id: 'r1', platformUserId: 'sl-1', faabRemaining: null, waiverPriority: 7, settings: { waiver_budget_used: 45 }, playerData: {} })
  })

  it('reports what the import stored and says pending claims are not visible', async () => {
    const out = await buildWaiverStatusContext({ leagueId: 'L1', userId: 'u1', now: NOW })
    expect(out).toMatch(/imported from Sleeper/)
    expect(out).toMatch(/Waiver type: FAAB/)
    expect(out).toMatch(/\$200 per team/)
    expect(out).toMatch(/\$155 FAAB left \(budget minus what the sync says was spent\)/)
    expect(out).toMatch(/PENDING CLAIMS ARE NOT VISIBLE/)
    expect(out).toMatch(/never say the user has no claims/)
    /* Never a claim read, never a provider call. */
    expect(h.claims).not.toHaveBeenCalled()
    expect(h.settings).not.toHaveBeenCalled()
  })

  it('does not dress schema defaults up as facts when the import sent nothing', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Dynasty', sport: 'NFL', platform: 'espn', settings: {}, waiverType: 'rolling', waiverBudget: 100 })
    const out = await buildWaiverStatusContext({ leagueId: 'L1', userId: 'u1', now: NOW })
    expect(out).toMatch(/Waiver type: not in the data ESPN sent us/)
    expect(out).toMatch(/FAAB budget: not in the imported data/)
    expect(out).not.toMatch(/\$100/)
  })
})
