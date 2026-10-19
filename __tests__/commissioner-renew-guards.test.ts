import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * POST /renew guards. Each of these reproduced a real defect:
 *  1. the PF leader overwrote the playoff champion `enterRedraftOffseason` had already written,
 *  2. a season still being played could be renewed,
 *  3. a second POST bumped `League.season` again.
 */

const {
  getServerSessionMock,
  leagueFindUniqueMock,
  leagueUpdateMock,
  leagueSeasonFindUniqueMock,
  leagueSeasonUpsertMock,
  redraftSeasonFindFirstMock,
  leagueTeamUpdateManyMock,
  leagueTeamCountMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  leagueFindUniqueMock: vi.fn(),
  leagueUpdateMock: vi.fn(),
  leagueSeasonFindUniqueMock: vi.fn(),
  leagueSeasonUpsertMock: vi.fn(),
  redraftSeasonFindFirstMock: vi.fn(),
  leagueTeamUpdateManyMock: vi.fn(),
  leagueTeamCountMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({
  notifyCommissionerChange: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/commissioner/CommissionerRatingTrigger', () => ({
  checkAndTriggerRatingIfOffseason: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUniqueMock, update: leagueUpdateMock },
    leagueSeason: { findUnique: leagueSeasonFindUniqueMock, upsert: leagueSeasonUpsertMock },
    redraftSeason: { findFirst: redraftSeasonFindFirstMock },
    leagueTeam: { updateMany: leagueTeamUpdateManyMock, count: leagueTeamCountMock },
    roster: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    findLeagueListing: { upsert: vi.fn() },
  },
}))

function baseLeague(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'commish',
    season: 2026,
    status: 'pre_draft',
    lifecycleState: 'offseason',
    lifecycleMetadata: { lastTransitionAt: '2026-01-10T00:00:00.000Z' },
    settings: {},
    leagueVariant: 'redraft',
    platform: 'manual',
    isDynasty: false,
    sport: 'NFL',
    name: 'Guard League',
    scoring: 'ppr',
    waiverBudget: 100,
    teams: [
      { id: 't1', teamName: 'Points Kings', ownerName: 'PF Leader', isOrphan: false, isCommissioner: true, wins: 11, losses: 3, pointsFor: 1900, platformUserId: 'u1', currentRank: null },
      { id: 't2', teamName: 'Bracket Busters', ownerName: 'Real Champ', isOrphan: false, isCommissioner: false, wins: 8, losses: 6, pointsFor: 1600, platformUserId: 'u2', currentRank: null },
    ],
    ...overrides,
  }
}

async function post() {
  const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/renew/route')
  const req = new Request('http://localhost/api/commissioner/leagues/l1/renew', { method: 'POST', body: '{}' })
  return POST(req as any, { params: Promise.resolve({ leagueId: 'l1' }) })
}

function lastLeagueUpdate() {
  return leagueUpdateMock.mock.calls[leagueUpdateMock.mock.calls.length - 1]?.[0]
}

describe('POST /renew guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'commish' } })
    leagueFindUniqueMock.mockResolvedValue(baseLeague())
    leagueUpdateMock.mockResolvedValue({ id: 'l1' })
    leagueSeasonFindUniqueMock.mockResolvedValue(null)
    leagueSeasonUpsertMock.mockResolvedValue({ id: 'ls1' })
    redraftSeasonFindFirstMock.mockResolvedValue(null)
    leagueTeamUpdateManyMock.mockResolvedValue({ count: 0 })
    leagueTeamCountMock.mockResolvedValue(0)
  })

  it('keeps the champion enterRedraftOffseason already recorded', async () => {
    leagueSeasonFindUniqueMock.mockResolvedValue({
      championName: 'Bracket Busters',
      runnerUpName: 'Points Kings',
      regularSeasonWinnerName: 'Points Kings',
      teamRecords: [{ rank: 1 }],
    })
    const res = await post()
    expect(res.status).toBe(200)
    for (const call of leagueSeasonUpsertMock.mock.calls) {
      const update = call[0].update
      expect(update.championName).toBeUndefined()
      expect(update.runnerUpName).toBeUndefined()
      expect(update.teamRecords).toBeUndefined()
    }
  })

  it('names the bracket champion, not the points leader, when no snapshot exists yet', async () => {
    redraftSeasonFindFirstMock.mockResolvedValue({
      playoffBracket: { structure: { championRosterId: 'r2', runnerUpRosterId: 'r1' } },
      rosters: [
        { id: 'r1', teamName: 'Points Kings', ownerName: 'PF Leader' },
        { id: 'r2', teamName: 'Bracket Busters', ownerName: 'Real Champ' },
      ],
    })
    const res = await post()
    expect(res.status).toBe(200)
    expect(leagueSeasonUpsertMock).toHaveBeenCalledTimes(1)
    const arg = leagueSeasonUpsertMock.mock.calls[0][0]
    expect(arg.create.championName).toBe('Bracket Busters')
    expect(arg.create.runnerUpName).toBe('Points Kings')
  })

  it('falls back to the points leader only when there is no snapshot and no bracket', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    const arg = leagueSeasonUpsertMock.mock.calls[0][0]
    expect(arg.create.championName).toBe('PF Leader')
  })

  it('refuses to renew a season that is still being played', async () => {
    leagueFindUniqueMock.mockResolvedValue(baseLeague({ status: 'in_season', lifecycleState: 'in_season' }))
    const res = await post()
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('season_not_over')
    expect(leagueUpdateMock).not.toHaveBeenCalled()
    expect(leagueTeamUpdateManyMock).not.toHaveBeenCalled()
    expect(leagueSeasonUpsertMock).not.toHaveBeenCalled()
  })

  it('renews once: a second POST does not advance the season again', async () => {
    const first = await post()
    expect(first.status).toBe(200)
    const written = lastLeagueUpdate().data
    expect(written.season).toBe(2027)

    // The league as the first renewal left it. Its lifecycle has not moved since.
    leagueFindUniqueMock.mockResolvedValue(baseLeague({
      season: written.season,
      status: written.status,
      settings: written.settings,
    }))
    leagueUpdateMock.mockClear()
    leagueTeamUpdateManyMock.mockClear()

    const second = await post()
    expect(second.status).toBe(409)
    const json = await second.json()
    expect(json.error).toBe('already_renewed')
    expect(leagueUpdateMock).not.toHaveBeenCalled()
    expect(leagueTeamUpdateManyMock).not.toHaveBeenCalled()
  })

  it('allows the next renewal once the renewed season has itself moved on', async () => {
    leagueFindUniqueMock.mockResolvedValue(baseLeague({
      season: 2027,
      settings: { renewal_completed_for_season: 2027, renewal_completed_at: '2027-02-01T00:00:00.000Z' },
      lifecycleMetadata: { lastTransitionAt: '2028-01-15T00:00:00.000Z' },
    }))
    const res = await post()
    expect(res.status).toBe(200)
    expect(lastLeagueUpdate().data.season).toBe(2028)
  })
})
