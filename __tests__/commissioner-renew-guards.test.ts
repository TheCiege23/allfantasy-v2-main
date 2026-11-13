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
    zombieLeague: { findUnique: vi.fn().mockResolvedValue(null) },
    league: { findUnique: leagueFindUniqueMock, update: leagueUpdateMock },
    leagueSeason: { findUnique: leagueSeasonFindUniqueMock, upsert: leagueSeasonUpsertMock },
    redraftSeason: { findFirst: redraftSeasonFindFirstMock },
    leagueTeam: { updateMany: leagueTeamUpdateManyMock, count: leagueTeamCountMock },
    roster: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    findLeagueListing: { upsert: vi.fn() },
  },
}))

// A redraft renew also runs the unified season-engine renew (roster reset + next season + draft).
// These guards are about the route's own history/season writes, so it is stubbed as "no season
// engine" — the legacy roster-only path. Its own behaviour is __tests__/redraft/renew-redraft-league.test.ts.
vi.mock('@/lib/redraft/offseason/renewRedraftLeague', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/offseason/renewRedraftLeague')>()),
  renewRedraftLeague: vi.fn().mockResolvedValue({ ok: false, code: 'NO_SEASON', message: 'no season' }),
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

  /*
   * A keeper (or dynasty) league is already on next season when Renew is pressed: closing 2026 built the
   * 2027 season shell and moved League.season to 2027. `season + 1` renewed it into 2028 and wrote 2027
   * history for a season nobody played (keeper simulation, 2026-11-10: 27 of 27 leagues).
   */
  describe('a league whose season already moved onto the next season shell', () => {
    const keeperLeague = () => baseLeague({ season: 2027, leagueVariant: 'keeper' })
    const seasons = (shellStatus: string) => async (args: { where?: { season?: number; status?: string } }) => {
      if (args?.where?.season === 2027 && args.where.status === 'setup') return shellStatus === 'setup' ? { id: 's2027', season: 2027, status: 'setup' } : null
      if (args?.where?.season === 2026) return { id: 's2026', season: 2026 }
      return null
    }

    it('renews into the season already current, and files history under the season played', async () => {
      leagueFindUniqueMock.mockResolvedValue(keeperLeague())
      redraftSeasonFindFirstMock.mockImplementation(seasons('setup'))
      const res = await post()
      expect(res.status).toBe(200)
      expect(lastLeagueUpdate().data.season).toBe(2027)
      expect(lastLeagueUpdate().data.settings.renewal_completed_for_season).toBe(2027)
      expect(leagueSeasonUpsertMock.mock.calls[0][0].where.leagueId_season.season).toBe(2026)
    })

    it('a second Renew is still refused', async () => {
      leagueFindUniqueMock.mockResolvedValue(keeperLeague())
      redraftSeasonFindFirstMock.mockImplementation(seasons('setup'))
      await post()
      const written = lastLeagueUpdate().data
      leagueFindUniqueMock.mockResolvedValue(baseLeague({ season: written.season, status: written.status, settings: written.settings, leagueVariant: 'keeper' }))
      leagueUpdateMock.mockClear()
      const again = await post()
      expect(again.status).toBe(409)
      expect(leagueUpdateMock).not.toHaveBeenCalled()
    })

    it('a season already being played is not mistaken for the shell: renews one ahead as before', async () => {
      leagueFindUniqueMock.mockResolvedValue(keeperLeague())
      redraftSeasonFindFirstMock.mockImplementation(seasons('active'))
      const res = await post()
      expect(res.status).toBe(200)
      expect(lastLeagueUpdate().data.season).toBe(2028)
    })
  })
})
