// @vitest-environment node
/**
 * 🛑 THE CROSS-LEAGUE MATCHUP BOARD DOES NOT RANK A CATEGORY OR ROTO LEAGUE BY POINTS ODDS.
 *
 * `getMatchupPulse` ranks every head-to-head by a points win probability and a points margin. A
 * categories or rotisserie league (Fantrax states it only as `fantrax_settings.scoringSystem.type`) is
 * not won on points, so it was ranked by numbers that mean nothing there. It is now counted under
 * `notRanked.scoringType` — said on the board, never silently dropped — the way an elimination league
 * already is. Harness copied from matchup-pulse-win-probability.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  claimed: [] as Array<Record<string, unknown>>,
  weekRows: [] as Array<Record<string, unknown>>,
  teams: [] as Array<Record<string, unknown>>,
  rosters: [] as Array<Record<string, unknown>>,
  scores: [] as Array<Record<string, unknown>>,
  games: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    /* The slimmed settings read — one row per league, from the claimed fixture's own settings. */
    $queryRawUnsafe: vi.fn(async (_sql: string, ids: string[]) =>
      db.claimed.flatMap((c) => {
        const l = c.league as { id?: string; settings?: unknown } | undefined
        return l?.id && ids.includes(l.id) ? [{ id: l.id, settings: l.settings ?? null }] : []
      }),
    ),
    leagueTeam: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (where.claimedByUserId ? db.claimed : db.teams)),
    },
    weeklyMatchup: {
      groupBy: vi.fn(async () =>
        db.weekRows.map((r) => ({ leagueId: r.leagueId, seasonYear: r.seasonYear, week: r.week, _max: { pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst } })),
      ),
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ leagueId: string; seasonYear: number; week: number }> } }) =>
        db.weekRows.filter((row) => where.OR.some((p) => row.leagueId === p.leagueId && row.seasonYear === p.seasonYear && row.week === p.week)),
      ),
    },
    roster: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const keys = (where.platformUserId as { in?: string[] } | undefined)?.in
        return db.rosters.filter((r) => !keys || keys.includes(String(r.platformUserId)))
      }),
    },
    leaguePlayerWeeklyScore: {
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ leagueId: string; seasonYear: number; week: number }> } }) =>
        db.scores.filter((s) => where.OR.some((p) => s.leagueId === p.leagueId && s.seasonYear === p.seasonYear && s.week === p.week)),
      ),
    },
    sportsGame: { findMany: vi.fn(async (args?: { where?: { OR?: unknown } }) => (args?.where?.OR ? db.games : [])) },
  },
}))

/*
 * id → [projection, NFL club]. Each player carries a component line the league's rules price at
 * exactly his projection (`rec: 1` against `rec: P`): the odds use only league-rescored prices since
 * the forecast became shared with the league page (`matchupForecast.ts`). A `GENERIC_ONLY` player
 * carries the vendor total and nothing the rules can score.
 */
const PLAYERS: Record<string, [number, string]> = {}
const GENERIC_ONLY = new Set<string>()
/* Ruled out or on bye this week, by Sleeper id. */
const OUT = new Set<string>()
const lookups = vi.hoisted(() => [] as Array<{ at: unknown; sport: unknown }>)
/* When set, the feed holds nothing for week 4 — only its newest week, 5. */
const feed = vi.hoisted(() => ({ missingWeek4: false }))
vi.mock('@/lib/core-app/playerProjections', () => ({
  /* The feed's NEWEST week is week 5 — a week AHEAD of the matchups, as production's usually is. */
  latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 5 })),
  lookupProjections: vi.fn(async (ids: string[], at: unknown, _idp: unknown, sport: unknown) => {
    lookups.push({ at, sport })
    if (feed.missingWeek4 && (at as { week?: number } | null)?.week === 4) return new Map()
    return new Map(
      ids
        .filter((id) => PLAYERS[id])
        .map((id) => [
          id,
          {
            projectedPoints: PLAYERS[id][0],
            team: PLAYERS[id][1],
            componentStats: GENERIC_ONLY.has(id) ? null : { rec: PLAYERS[id][0] },
          },
        ]),
    )
  }),
}))
vi.mock('@/lib/core-app/unavailableStarters', () => ({
  loadUnavailableBySport: vi.fn(async ({ sleeperIds }: { sleeperIds: string[] }) =>
    new Map([['NFL', new Set(sleeperIds.filter((id) => OUT.has(id)))]]),
  ),
}))

import { getMatchupPulse } from '@/lib/core-app/matchupPulse'

/* Friday 2 Oct 2026, noon UTC: Thursday night's game is final, Sunday's are to come. */
const NOW = new Date('2026-10-02T12:00:00Z')
const USER = 'u1'
const THU = new Date('2026-10-02T00:15:00Z')
const SUN = new Date('2026-10-04T17:00:00Z')
const game = (home: string, away: string, status: string, startTime: Date) => ({
  season: 2026, week: 4, homeTeam: home, awayTeam: away, status, startTime, seasonType: 'regular', fetchedAt: new Date('2026-10-02T11:00:00Z'),
})

/**
 * One league: my roster '1' (starters `mine`) against roster '2' (starters `theirs`), week 4.
 * `points` are the WeeklyMatchup totals; nonzero makes the row scored.
 */
function league(id: string, mine: string[], theirs: string[], points: [number, number] = [0, 0], extra: Record<string, unknown> = {}) {
  const plid = `p-${id}`
  db.claimed.push({ externalId: '1', platformUserId: `me-${id}`, league: {
    id, name: `League ${id}`, platform: 'sleeper', platformLeagueId: plid, season: '2026', sport: 'NFL',
    logoUrl: null, avatarUrl: null, settings: { leg: 4, scoring_settings: { rec: 1 }, ...extra }, status: 'in_season',
  } })
  db.weekRows.push(
    { leagueId: plid, seasonYear: 2026, week: 4, rosterId: '1', matchupId: 1, pointsFor: points[0], pointsAgainst: points[1] },
    { leagueId: plid, seasonYear: 2026, week: 4, rosterId: '2', matchupId: 1, pointsFor: points[1], pointsAgainst: points[0] },
  )
  db.teams.push(
    { leagueId: id, externalId: '1', platformUserId: `me-${id}`, teamName: 'Mine', ownerName: 'me', avatarUrl: null },
    { leagueId: id, externalId: '2', platformUserId: `them-${id}`, teamName: `Opp ${id}`, ownerName: 'them', avatarUrl: null },
  )
  db.rosters.push(
    { leagueId: id, platformUserId: `me-${id}`, playerData: { starters: mine } },
    { leagueId: id, platformUserId: `them-${id}`, playerData: { starters: theirs } },
  )
  return plid
}

beforeEach(() => {
  vi.clearAllMocks()
  db.claimed = []; db.weekRows = []; db.teams = []; db.rosters = []; db.scores = []
  db.games = [game('KC', 'BUF', 'scheduled', SUN), game('SF', 'LAR', 'scheduled', SUN)]
  for (const k of Object.keys(PLAYERS)) delete PLAYERS[k]
  GENERIC_ONLY.clear()
  OUT.clear()
  lookups.length = 0
  feed.missingWeek4 = false
  Object.assign(PLAYERS, { a1: [20, 'KC'], a2: [20, 'SF'], b1: [8, 'BUF'], b2: [8, 'LAR'] })
})

const fantrax = (type: string) => ({ fantrax_settings: { scoringSystem: { type } } })

describe('matchup pulse — points odds only for head-to-head points leagues', () => {
  it('control: a head-to-head points league is ranked, with odds', async () => {
    league('H', ['a1', 'a2'], ['b1', 'b2'], [0, 0], fantrax('HEAD_TO_HEAD_POINTS_BASED'))
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading.map((r) => r.leagueId)).toEqual(['H'])
    expect(pulse.leading[0].pWin).toBeGreaterThan(0.5)
    expect(pulse.notRanked.scoringType ?? 0).toBe(0)
  })

  it.each([
    ['categories', fantrax('HEAD_TO_HEAD_CATEGORIES'), [0, 0]],
    ['roto', fantrax('ROTISSERIE'), [0, 0]],
    /* A scored category week: its "points" are whatever the provider wrote, still not a points margin. */
    ['scored categories', fantrax('HEAD_TO_HEAD_CATEGORIES'), [7, 5]],
  ] as Array<[string, Record<string, unknown>, [number, number]]>)('🛑 a %s league is not ranked by points — it is counted and said', async (_label, extra, points) => {
    league('C', ['a1', 'a2'], ['b1', 'b2'], points, extra)
    league('H', ['a1', 'a2'], ['b1', 'b2'], [0, 0])
    const pulse = await getMatchupPulse(USER, NOW)
    const shown = [...pulse.leading, ...pulse.trailing, ...pulse.closest].map((r) => r.leagueId)
    expect(shown).not.toContain('C')
    expect(shown).toContain('H')
    expect(pulse.notRanked.scoringType).toBe(1)
    expect(pulse.ranked).toBe(1)
  })
})
