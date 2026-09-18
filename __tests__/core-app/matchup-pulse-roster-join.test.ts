// @vitest-environment node
/**
 * The cross-league matchup pulse's roster join.
 *
 * 🛑 THE OPPONENT'S KEY IS OFTEN ONE NOBODY CAN NAME. Since #1005 a managerless team's roster is
 * stored under `orphan-<provider>-<teamId>`, which is nobody's manager id. Production 2026-09-17:
 * 207 of the 210 teams no manager id could reach are orphans, and 60 matchups of a claimed team in 16
 * leagues face one. Every such pairing fell into `notRanked.unpriceable`, so the league disappeared
 * from this board rather than showing a projected score.
 *
 * ⚠ This board derives the orphan key rather than resolving through `resolveRostersForTeams`, and the
 * reason is cost: the full rule needs every roster of every league, because the key may be one we
 * cannot name — fine for a single-league screen, ~1.5 MB on the 96-league account this serves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
/* The board's own cache wrapper would otherwise hold one fixture's answer across tests. */
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

const db = vi.hoisted(() => ({
  claimed: [] as Array<Record<string, unknown>>,
  weekRows: [] as Array<Record<string, unknown>>,
  teams: [] as Array<Record<string, unknown>>,
  rosters: [] as Array<Record<string, unknown>>,
  rosterWhere: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.claimedByUserId ? db.claimed : db.teams,
      ),
    },
    weeklyMatchup: {
      groupBy: vi.fn(async () =>
        db.weekRows.map((r) => ({
          leagueId: r.leagueId,
          seasonYear: r.seasonYear,
          week: r.week,
          _max: { pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst },
        })),
      ),
      findMany: vi.fn(async () => db.weekRows),
    },
    roster: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        db.rosterWhere.push(where)
        const keys = (where.platformUserId as { in?: string[] } | undefined)?.in
        return db.rosters.filter((r) => !keys || keys.includes(String(r.platformUserId)))
      }),
    },
    sportsGame: { findMany: vi.fn(async () => []) },
  },
}))

/* Per-player prices, so both sides can start the same NUMBER of players and still differ. */
const PRICES: Record<string, number> = { a: 10, b: 10, c: 6, d: 6 }
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 2 })),
  lookupProjections: vi.fn(async (ids: string[]) =>
    new Map(ids.filter((id) => PRICES[id] != null).map((id) => [id, { projectedPoints: PRICES[id] }])),
  ),
}))

import { getMatchupPulse } from '@/lib/core-app/matchupPulse'

const NOW = new Date('2026-09-17T12:00:00Z')
const USER = 'af-user-1'
const PLID = '99887766'

const LEAGUE = {
  id: 'L1',
  name: 'Test League',
  platform: 'sleeper',
  platformLeagueId: PLID,
  season: '2026',
  sport: 'NFL',
  logoUrl: null,
  avatarUrl: null,
  settings: { scoring_settings: { rec: 1 } },
}

beforeEach(() => {
  vi.clearAllMocks()
  db.rosterWhere = []
  db.claimed = [{ externalId: '1', platformUserId: 'me-sleeper', league: LEAGUE }]
  db.weekRows = [
    { leagueId: PLID, seasonYear: 2026, week: 2, rosterId: '1', matchupId: 5, pointsFor: 0, pointsAgainst: 0 },
    { leagueId: PLID, seasonYear: 2026, week: 2, rosterId: '2', matchupId: 5, pointsFor: 0, pointsAgainst: 0 },
  ]
  db.teams = [
    { leagueId: 'L1', externalId: '1', platformUserId: 'me-sleeper', teamName: 'Mine', ownerName: 'Me', avatarUrl: null },
    /* The opponent is managerless: no manager id exists to offer. */
    { leagueId: 'L1', externalId: '2', platformUserId: null, teamName: 'Theirs', ownerName: null, avatarUrl: null },
  ]
  db.rosters = [
    { leagueId: 'L1', platformUserId: 'me-sleeper', playerData: { starters: ['a', 'b'] } },
    { leagueId: 'L1', platformUserId: 'orphan-sleeper-2', playerData: { source_team_id: '2', starters: ['c', 'd'] } },
  ]
})

describe('getMatchupPulse roster join', () => {
  it('🛑 prices a matchup whose opponent is an orphan team', async () => {
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.notRanked.unpriceable).toBe(0)
    expect(pulse.ranked).toBe(1)
    /* 20 against 12, two starters each: a +8 lead priced from a roster no manager id could reach. */
    expect(pulse.leading[0]?.margin).toBe(8)
    expect(pulse.leading[0]?.basis).toBe('projected')
  })

  it('asks for the orphan key by name, and still asks for the manager keys', async () => {
    await getMatchupPulse(USER, NOW)
    const keys = (db.rosterWhere.at(-1)?.platformUserId as { in: string[] }).in
    expect(keys).toContain('orphan-sleeper-2')
    expect(keys).toContain('me-sleeper')
    /* Derived, not fetched wholesale: the read is still key-scoped. */
    expect(keys.length).toBeLessThan(10)
  })

  it('still prices a normally-keyed opponent', async () => {
    db.teams[1] = { ...db.teams[1], platformUserId: 'them-sleeper' }
    db.rosters[1] = { leagueId: 'L1', platformUserId: 'them-sleeper', playerData: { starters: ['c', 'd'] } }
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.ranked).toBe(1)
    expect(pulse.leading[0]?.margin).toBe(8)
  })

  it('reports a pairing it cannot price rather than inventing one', async () => {
    db.rosters = [db.rosters[0]]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.ranked).toBe(0)
    expect(pulse.leading).toHaveLength(0)
    expect(pulse.trailing).toHaveLength(0)
    expect(pulse.notRanked.unpriceable).toBe(1)
  })
})
