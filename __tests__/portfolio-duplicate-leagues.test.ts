import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  teamFindMany: vi.fn(),
  groupBy: vi.fn(),
  findRoster: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: h.teamFindMany, groupBy: h.groupBy },
  },
}))
vi.mock('@/lib/leagues/rosterForTeam', () => ({
  findRosterForTeam: h.findRoster,
  rosterPlayerIds: (pd: any) => (Array.isArray(pd?.players) ? pd.players.map(String) : null),
}))

import { getPortfolio } from '@/lib/core-app/portfolio'

const USER = 'user-1'

/**
 * Modelled on the real production rows: ONE Sleeper league (platform id
 * 1338541390891606016) imported by two different managers, so it appeared twice
 * in a portfolio belonging to someone who is in both copies.
 */
function claimedTeam(over: Record<string, unknown> = {}) {
  return {
    leagueId: 'l-mine',
    teamName: '(F) New York BroVengers!',
    ownerName: 'TheCiege24',
    wins: 0,
    losses: 0,
    ties: 0,
    currentRank: null,
    platformUserId: 'sleeper-user-1',
    externalId: '7',
    isCommissioner: false,
    league: {
      id: 'l-mine',
      name: 'KBFL',
      platform: 'sleeper',
      sport: 'NFL',
      season: 2026,
      avatarUrl: null,
      platformLeagueId: '1338541390891606016',
      userId: USER,
    },
    ...over,
  }
}

function theirCopy(over: Record<string, unknown> = {}) {
  const t = claimedTeam(over)
  return {
    ...t,
    leagueId: 'l-theirs',
    league: { ...t.league, id: 'l-theirs', userId: 'someone-else' },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  h.groupBy.mockResolvedValue([])
  h.findRoster.mockResolvedValue({ id: 'r1', playerData: { players: ['a', 'b'] }, matchedBy: 'source_manager_id' })
})

describe('one league imported twice shows once', () => {
  it('collapses copies sharing a platformLeagueId', async () => {
    h.teamFindMany.mockResolvedValue([claimedTeam(), theirCopy()])

    const out = await getPortfolio(USER)

    expect(out.leagues.available).toBe(true)
    expect(out.leagues.available && out.leagues.data).toHaveLength(1)
  })

  /* The reader's own import is the one they can act on. */
  it('keeps the copy the user imported', async () => {
    h.teamFindMany.mockResolvedValue([theirCopy(), claimedTeam()])

    const out = await getPortfolio(USER)
    const rows = out.leagues.available ? out.leagues.data : []

    expect(rows[0].leagueId).toBe('l-mine')
  })

  /*
   * ⚠ COLLAPSE ON THE PROVIDER'S ID, NEVER THE NAME. Two leagues can share a
   * name and be genuinely different — that is a real thing in a 65-league
   * portfolio, and merging them would hide one.
   */
  it('does not merge same-named leagues with different platform ids', async () => {
    const other = theirCopy()
    other.league.platformLeagueId = '9999999999'

    h.teamFindMany.mockResolvedValue([claimedTeam(), other])

    const out = await getPortfolio(USER)
    expect(out.leagues.available && out.leagues.data).toHaveLength(2)
  })

  /*
   * ⚠ SEASON IS IN THE KEY. Some providers reuse one league id across years and
   * merging those would silently hide a whole season.
   */
  it('keeps different seasons of the same platform league', async () => {
    const older = theirCopy()
    older.league.season = 2025

    h.teamFindMany.mockResolvedValue([claimedTeam(), older])

    const out = await getPortfolio(USER)
    expect(out.leagues.available && out.leagues.data).toHaveLength(2)
  })

  /* No provider id means no evidence they are the same thing. */
  it('never collapses rows with no platformLeagueId', async () => {
    const a = claimedTeam()
    const b = theirCopy()
    a.league.platformLeagueId = null as never
    b.league.platformLeagueId = null as never

    h.teamFindMany.mockResolvedValue([a, b])

    const out = await getPortfolio(USER)
    expect(out.leagues.available && out.leagues.data).toHaveLength(2)
  })
})

describe('the roster count uses the resolver that actually works', () => {
  /*
   * ⚠ MATCHING ON `Roster.platformUserId` REACHES 13 OF 98 CLAIMED TEAMS.
   * `findRosterForTeam` tries the durable `source_manager_id` first and reaches
   * 96. This asserts we go through it rather than re-rolling the bad join.
   */
  it('calls findRosterForTeam with the raw platform manager id', async () => {
    h.teamFindMany.mockResolvedValue([claimedTeam()])

    await getPortfolio(USER)

    expect(h.findRoster).toHaveBeenCalledWith('l-mine', 'sleeper-user-1')
  })

  it('reports a real count from the resolved roster', async () => {
    h.teamFindMany.mockResolvedValue([claimedTeam()])
    h.findRoster.mockResolvedValue({ id: 'r1', playerData: { players: ['a', 'b', 'c'] }, matchedBy: 'source_manager_id' })

    const out = await getPortfolio(USER)
    const rows = out.leagues.available ? out.leagues.data : []

    expect(rows[0].rosterCount).toBe(3)
  })

  /*
   * ⚠ NULL IS "NEVER IMPORTED", 0 IS "IMPORTED AND EMPTY". Collapsing them
   * turns an import problem into a message telling the user to fix their team.
   */
  it('keeps null distinct from zero', async () => {
    h.teamFindMany.mockResolvedValue([claimedTeam()])
    h.findRoster.mockResolvedValue(null)

    const noRoster = await getPortfolio(USER)
    expect((noRoster.leagues.available ? noRoster.leagues.data : [])[0].rosterCount).toBeNull()

    h.findRoster.mockResolvedValue({ id: 'r1', playerData: { players: [] }, matchedBy: 'source_manager_id' })
    const emptyRoster = await getPortfolio(USER)
    expect((emptyRoster.leagues.available ? emptyRoster.leagues.data : [])[0].rosterCount).toBe(0)
  })
})
