import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveLeagueMembership: vi.fn(),
  leagueFindUnique: vi.fn(),
  seasonFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  sessionFindUnique: vi.fn(),
  pickGroupBy: vi.fn(),
  historyFindMany: vi.fn(),
  tradeCount: vi.fn(),
}))

vi.mock('@/lib/league-access', () => ({
  resolveLeagueMembership: mocks.resolveLeagueMembership,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    redraftSeason: { findFirst: mocks.seasonFindFirst },
    redraftRoster: { findMany: mocks.rosterFindMany },
    draftSession: { findUnique: mocks.sessionFindUnique },
    draftPick: { groupBy: mocks.pickGroupBy },
    leagueTradeHistory: { findMany: mocks.historyFindMany },
    leagueTrade: { count: mocks.tradeCount },
  },
}))

import { buildCommissionerContext } from '@/lib/chimmy/commissionerGrounding'

function asCommissioner(isCommissioner = true) {
  return { ok: true, access: { isCommissioner, isMember: true, isOwner: isCommissioner } }
}

describe('buildCommissionerContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveLeagueMembership.mockResolvedValue(asCommissioner())
    mocks.leagueFindUnique.mockResolvedValue({
      name: 'The League',
      leagueSize: 12,
      lastSyncedAt: new Date('2026-08-25T00:00:00.000Z'),
      status: 'in_season',
      platform: 'sleeper',
      platformLeagueId: '123',
    })
    mocks.seasonFindFirst.mockResolvedValue({ id: 'season-1' })
    mocks.rosterFindMany.mockResolvedValue([
      { ownerId: 'u1', ownerName: 'Me', teamName: 'My Team', faabBalance: 100, waiverPriority: 1, wins: 0, losses: 0 },
      { ownerId: 'u2', ownerName: 'Them', teamName: 'Their Team', faabBalance: 40, waiverPriority: 2, wins: 0, losses: 0 },
    ])
    mocks.sessionFindUnique.mockResolvedValue({
      id: 'sess-1',
      status: 'in_progress',
      draftType: 'snake',
      rounds: 15,
      teamCount: 12,
      timerSeconds: 60,
    })
    mocks.pickGroupBy.mockResolvedValue([
      { rosterId: 'roster-1', _count: { rosterId: 5 } },
      { rosterId: 'roster-2', _count: { rosterId: 1 } },
    ])
    mocks.historyFindMany.mockResolvedValue([{ id: 'h1' }])
    mocks.tradeCount.mockResolvedValue(14)
  })

  /*
   * The gate is the whole security surface — everything in this block is other
   * managers' data.
   */
  it('returns null for a member who is not the commissioner', async () => {
    mocks.resolveLeagueMembership.mockResolvedValue(asCommissioner(false))
    expect(await buildCommissionerContext('lg1', 'u1')).toBeNull()
    expect(mocks.rosterFindMany).not.toHaveBeenCalled()
  })

  it('returns null for a non-member entirely', async () => {
    mocks.resolveLeagueMembership.mockResolvedValue({ ok: false, reason: 'not_member' })
    expect(await buildCommissionerContext('lg1', 'u1')).toBeNull()
  })

  it('gates on the canonical membership predicate, not a local check', async () => {
    await buildCommissionerContext('lg1', 'u1')
    expect(mocks.resolveLeagueMembership).toHaveBeenCalledWith('lg1', 'u1')
  })

  it('shows every team\'s waiver standing, which a manager cannot see', async () => {
    const out = await buildCommissionerContext('lg1', 'u1')
    expect(out).toContain('My Team (FAAB 100')
    expect(out).toContain('Their Team (FAAB 40')
  })

  /*
   * 984 of 1,078 teams are unclaimed because of how import works. Reporting that
   * as inactivity would tell a commissioner their league had emptied out.
   */
  it('warns that unclaimed teams are not inactive managers', async () => {
    const out = await buildCommissionerContext('lg1', 'u1')
    expect(out).toMatch(/Never report unclaimed teams as inactive managers/i)
  })

  it('reads activity from draft participation and hedges it', async () => {
    const out = await buildCommissionerContext('lg1', 'u1')
    expect(out).toContain('Picks made per roster')
    expect(out).toMatch(/never that they are inactive as fact/i)
  })

  it('offers draft scheduling as options, not as advice', async () => {
    mocks.sessionFindUnique.mockResolvedValue({
      id: 'sess-1',
      status: 'pre_draft',
      draftType: 'snake',
      rounds: 15,
      teamCount: 12,
      timerSeconds: 60,
    })
    const out = await buildCommissionerContext('lg1', 'u1')

    expect(out).toMatch(/Scheduling options/i)
    expect(out).toMatch(/never as what they should choose/i)
  })

  it('reports trade volume without grading the trades', async () => {
    const out = await buildCommissionerContext('lg1', 'u1')
    expect(out).toContain('14 recorded trades')
    expect(out).toMatch(/do not grade them or say who won/i)
    expect(out).toMatch(/no pending-trade queue/i)
  })

  /* Advisory, never directive — the confirmed product stance. */
  it('forbids telling the commissioner to act against anyone', async () => {
    const out = await buildCommissionerContext('lg1', 'u1')
    expect(out).toMatch(/Do NOT tell the commissioner to veto, reverse, remove, replace, pause or discipline/i)
    expect(out).toMatch(/do NOT recommend a punishment/i)
  })

  it('flags a league that has never synced', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      name: 'The League',
      leagueSize: 12,
      lastSyncedAt: null,
      status: null,
      platform: 'sleeper',
      platformLeagueId: null,
    })
    const out = await buildCommissionerContext('lg1', 'u1')
    expect(out).toContain('NEVER SYNCED')
  })
})
