// @vitest-environment node
/**
 * 🛑 MY TEAM NEVER NAMES A PLAYER FROM ANOTHER SPORT.
 *
 * `resolvePlayers` joined `SportsPlayer` on `sleeperId` alone. Sleeper numbers its NFL and NBA pools
 * independently, so an NBA league's roster id can equal an NFL player's — and the unscoped join then
 * rendered the NFL player (name, team, headshot, projection) in a basketball lineup.
 *
 * Drives the REAL `getMyTeamData` over a permissive prisma double (same harness as
 * my-team-foreign-roster-ids.test.ts).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  answers: {} as Record<string, (args: any) => unknown>,
}))

vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) =>
    method === 'count' ? 0 : method === 'findMany' || method.startsWith('$query') ? [] : null
  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            const answer = db.answers[`${model}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key.startsWith('$query') || key.startsWith('$execute')) return vi.fn(async () => [])
        if (key === '$transaction') return vi.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : null))
        if (key === 'then') return undefined
        return modelProxy(key)
      },
    },
  )
  return { prisma, default: prisma }
})

vi.mock('@/lib/core-app/currentWeek', () => ({
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 3 })),
}))
vi.mock('@/lib/core-app/sportsWeek', () => ({
  resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 3, seasonType: 'regular' })),
}))

const LEAGUE_ID = 'league-nba'
const USER_ID = 'af-user-1'
const SPORT = vi.hoisted(() => ({ league: 'NBA' }))

/*
 * Sleeper ids are per sport: the SAME number is one player in Sleeper's NFL pool and another in its
 * NBA pool. `SportsPlayer` holds both, keyed (sport, externalId, source) — so `sleeperId` alone is
 * not an identity. The double below honours a `sport` filter when the caller sends one, exactly as
 * Postgres would, and ignores it when the caller does not.
 */
const ROWS = [
  { sleeperId: '1001', name: 'NFL Namesake', position: 'WR', team: 'NYJ', sport: 'NFL', imageUrl: null },
  { sleeperId: '2002', name: 'NBA Guard', position: 'PG', team: 'BOS', sport: 'NBA', imageUrl: null },
  { sleeperId: '2002', name: 'NFL Other Namesake', position: 'RB', team: 'KC', sport: 'NFL', imageUrl: null },
]

function answerDb() {
  db.answers = {
    'fantasyProjection.findFirst': () => ({ season: '2026', week: 3 }),
    'sportsPlayer.findMany': (args) => {
      const ids: string[] = args?.where?.sleeperId?.in ?? []
      const sport: string | undefined = args?.where?.sport
      return ROWS.filter((r) => ids.includes(r.sleeperId) && (sport == null || r.sport === sport))
    },
    'leagueTeam.findMany': () => [
      { externalId: '4', teamName: 'Mine', ownerName: 'me', avatarUrl: null, platformUserId: 'fu4', claimedByUserId: USER_ID },
    ],
    'roster.findFirst': () => ({ playerData: { players: ['1001', '2002'], starters: ['1001', '2002'] } }),
    'roster.findMany': () => [{ id: 'r4', platformUserId: 'fu4', playerData: { starters: ['1001', '2002'] } }],
  }
}

function context() {
  return {
    leagueId: LEAGUE_ID,
    userId: USER_ID,
    league: vi.fn(async () => ({
      id: LEAGUE_ID,
      name: 'Hoops League',
      platform: 'sleeper',
      platformLeagueId: 's1',
      sport: SPORT.league,
      season: 2026,
      leagueType: 'redraft',
      isDynasty: false,
      starters: null,
      settings: { scoring_settings: { pts: 1 }, roster_positions: ['G', 'UTIL', 'BN'] },
    })),
    claimedTeam: vi.fn(async () => ({
      id: 'lt-4', externalId: '4', platformUserId: 'fu4', teamName: 'Mine', ownerName: 'me', avatarUrl: null,
      wins: 1, losses: 1, ties: 0, pointsFor: 200, pointsAgainst: 190, currentRank: 5,
    })),
    claimedTeams: vi.fn(async () => []),
  }
}

async function namesShown(): Promise<string[]> {
  const { getMyTeamData } = await import('@/lib/core-app/myTeam')
  // The stored roster (a live Sleeper read is a network call this test does not make).
  const data = await getMyTeamData(LEAGUE_ID, USER_ID, context() as any, { savedRosterOnly: true })
  if (!data) throw new Error('no My Team data')
  if (!data.starters.available) throw new Error(`no starters: ${data.starters.reason}`)
  return data.starters.data.map((s) => s.player?.name ?? '').filter(Boolean)
}

describe('My Team — player lookups are scoped to the league sport', () => {
  beforeAll(async () => {
    await import('@/lib/core-app/myTeam')
  }, 180_000)

  beforeEach(() => answerDb())

  it('control: the NBA player whose id the roster holds IS named', async () => {
    SPORT.league = 'NBA'
    expect(await namesShown()).toContain('NBA Guard')
  })

  it('🛑 an NBA league never names the NFL player who shares a Sleeper id', async () => {
    SPORT.league = 'NBA'
    const shown = await namesShown()
    expect(shown).not.toContain('NFL Namesake')
    expect(shown).not.toContain('NFL Other Namesake')
  })

  it('and the mirror: an NFL league never names the NBA player sharing an id', async () => {
    SPORT.league = 'NFL'
    const shown = await namesShown()
    expect(shown).not.toContain('NBA Guard')
    expect(shown).toContain('NFL Namesake')
  })
})
