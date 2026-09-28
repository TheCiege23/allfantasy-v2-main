// @vitest-environment node
/**
 * 🛑 MY TEAM SHOWS ONE "YOUR PROJECTED SCORE" FOR A WEEK, NOT TWO.
 *
 * Reported 2026-09-25 on the KBFL Sleeper league (32 teams, IDP dynasty), week 3: the header tile
 * read "148.3 PROJECTED · YOUR LEAGUE" while the "WEEK 3 · PROJECTED MATCHUP" card on the same
 * screen read "175.7 from 15 of 16" for the same team.
 *
 * Two computations over two lineups:
 *   · the header summed the rows the roster shows — Sleeper's LIVE weekly lineup, with a
 *     ruled-out (or bye) starter at 0;
 *   · the card re-read the STORED `Roster` row from the last sync and re-priced it through a path
 *     with no notion of OUT or bye, so an OUT starter counted at his full projection.
 *
 * Reproduced read-only against that league's own roster on the test database: header 138.74
 * (two OUT starters at 0, live lineup), card 164.48 (stored 09-02 lineup — two different
 * receivers — with both OUT starters at full value).
 *
 * This drives the REAL `getMyTeamData` — resolver, OUT rule, bye pass, `getNextMatchup` — over a
 * prisma double, with a live lineup that differs from the stored one and an OUT starter on each
 * side, and pins that the header and the card are the same number.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  answers: {} as Record<string, (args: any) => unknown>,
}))

/** Permissive double: every model and method answers; unlisted reads get an empty-but-valid value. */
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

const live = vi.hoisted(() => ({ starters: [] as string[], weekStarters: null as Record<string, string[]> | null }))

// Sleeper's live weekly lineup — what the header and the roster rows show.
vi.mock('@/lib/core-app/currentSleeperRoster', () => ({
  currentSleeperRoster: vi.fn(async () => ({
    players: [...live.starters, 'wrStale', 'bench1'],
    starters: [...live.starters],
    reserve: [],
    taxi: [],
    weekStarters: live.weekStarters,
    verification: { checkedAt: '2026-09-25T12:00:00.000Z', source: 'Sleeper', week: 3, slots: ['QB', 'RB', 'WR'] },
  })),
}))

vi.mock('@/lib/core-app/currentWeek', () => ({
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 3 })),
}))

vi.mock('@/lib/core-app/sportsWeek', () => ({
  resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 3, seasonType: 'regular' })),
}))

const LEAGUE_ID = 'league-kbfl'
const PLATFORM_LEAGUE_ID = '1338541390891606016'
const USER_ID = 'af-user-1'

/** Catches projected this week. The league scores a point a catch, so this IS each player's number. */
const RECEPTIONS: Record<string, number> = {
  qb1: 20,
  rb1: 30, // OUT
  wrLive: 12, // in the live lineup only
  wrStale: 25, // in the stored (last-synced) lineup only
  o1: 10,
  o2: 15, // OUT
  o3: 8,
  oLive: 20, // in the opponent's live lineup only
}
const OUT = new Set(['rb1', 'o2'])
const nameOf = (id: string) => `Player ${id}`

function answerDb() {
  db.answers = {
    'fantasyProjection.findFirst': () => ({ season: '2026', week: 3 }),
    'fantasyProjection.findMany': (args) =>
      (args?.where?.playerId?.in ?? [])
        .filter((id: string) => id in RECEPTIONS)
        .map((id: string) => ({
          playerId: id,
          projectedPoints: RECEPTIONS[id],
          stats: { name: nameOf(id), position: 'WR', team: 'NYJ', stats: { rec: RECEPTIONS[id] } },
        })),
    'sportsPlayer.findMany': (args) =>
      (args?.where?.sleeperId?.in ?? [])
        .filter((id: string) => id in RECEPTIONS)
        .map((id: string) => ({ sleeperId: id, name: nameOf(id), position: 'WR', team: 'NYJ', sport: 'NFL', imageUrl: null })),
    'sportsInjury.findMany': (args) =>
      (args?.where?.playerName?.in ?? [])
        .filter((n: string) => [...OUT].some((id) => nameOf(id) === n))
        .map((n: string) => ({ playerName: n, status: 'Out' })),
    'weeklyMatchup.findMany': () => [
      { rosterId: '4', matchupId: 1 },
      { rosterId: '9', matchupId: 1 },
    ],
    'leagueTeam.findMany': () => [
      { externalId: '4', teamName: '(F) New York BroVengers!', ownerName: 'me', avatarUrl: null, platformUserId: 'su4', claimedByUserId: USER_ID },
      { externalId: '9', teamName: 'Them', ownerName: 'them', avatarUrl: null, platformUserId: 'su9', claimedByUserId: null },
    ],
    // The STORED rosters, as of the last sync. Mine is stale: wrStale, not wrLive.
    'roster.findMany': () => [
      { id: 'r4', platformUserId: 'su4', playerData: { starters: ['qb1', 'rb1', 'wrStale'] } },
      { id: 'r9', platformUserId: 'su9', playerData: { starters: ['o1', 'o2', 'o3'] } },
    ],
  }
}

function context() {
  return {
    leagueId: LEAGUE_ID,
    userId: USER_ID,
    league: vi.fn(async () => ({
      id: LEAGUE_ID,
      name: 'KBFL',
      platform: 'sleeper',
      platformLeagueId: PLATFORM_LEAGUE_ID,
      sport: 'NFL',
      season: 2026,
      leagueType: 'dynasty',
      isDynasty: true,
      starters: null,
      settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'RB', 'WR', 'BN'] },
    })),
    claimedTeam: vi.fn(async () => ({
      id: 'lt-4',
      externalId: '4',
      platformUserId: 'su4',
      teamName: '(F) New York BroVengers!',
      ownerName: 'me',
      avatarUrl: null,
      wins: 1,
      losses: 1,
      ties: 0,
      pointsFor: 200,
      pointsAgainst: 190,
      currentRank: 5,
    })),
    claimedTeams: vi.fn(async () => []),
  }
}

async function load() {
  const { getMyTeamData } = await import('@/lib/core-app/myTeam')
  const data = await getMyTeamData(LEAGUE_ID, USER_ID, context() as any)
  if (!data) throw new Error('no My Team data')
  if (!data.projections.available) throw new Error(`no projections: ${data.projections.reason}`)
  if (!data.nextMatchup.available) throw new Error(`no matchup: ${data.nextMatchup.reason}`)
  return { header: data.projections.data, card: data.nextMatchup.data, starters: data.starters }
}

describe('My Team — the header and the projected-matchup card agree', () => {
  // The first import pulls in the whole My Team graph; on a contended box that alone can outlast
  // the default per-test timeout, so it is paid once, here, with room to spare.
  beforeAll(async () => {
    await import('@/lib/core-app/myTeam')
  }, 180_000)

  beforeEach(() => {
    live.starters = ['qb1', 'rb1', 'wrLive']
    live.weekStarters = null
    answerDb()
  })

  it('🛑 your side of the card IS the header total, from the same lineup and the same rules', async () => {
    const { header, card } = await load()

    // qb1 20 + rb1 OUT 0 + wrLive 12. The stored lineup and the full-value OUT starter would say 75.
    expect(header.afTotal).toBe(32)
    expect(header.afProjected).toBe(3)

    expect(card.you.projected).toBe(header.afTotal)
    expect(card.you.projectedFrom).toBe(header.afProjected)
    expect(card.you.starterCount).toBe(3)
  })

  it('prices the opponent by the same OUT rule, so the margin compares like with like', async () => {
    const { card } = await load()
    // o1 10 + o2 OUT 0 + o3 8
    expect(card.opponent?.projected).toBe(18)
    expect(card.opponent?.projectedFrom).toBe(3)
  })

  it('an OUT starter is the 0 his roster row shows, in both totals', async () => {
    const { header, card, starters } = await load()
    if (!starters.available) throw new Error('no starters')
    const rb1 = starters.data.find((s) => s.player?.sleeperId === 'rb1')?.player
    expect(rb1?.ruledOut).toBe(true)
    expect(rb1?.afProjectedPoints).toBe(0)
    const rowSum = starters.data.reduce((n, s) => n + (s.player?.afProjectedPoints ?? 0), 0)
    expect(header.afTotal).toBe(rowSum)
    expect(card.you.projected).toBe(rowSum)
  })

  it('follows the live lineup when it changes, on both surfaces at once', async () => {
    live.starters = ['qb1', 'rb1', 'wrStale']
    const { header, card } = await load()
    expect(header.afTotal).toBe(45)
    expect(card.you.projected).toBe(45)
  })

  it("🛑 the opponent is priced from THEIR live lineup too, not the row the last sync stored", async () => {
    // Stored: o1, o2 (OUT), o3. Live this week they benched o2 and started oLive.
    live.weekStarters = { '4': ['qb1', 'rb1', 'wrLive'], '9': ['o1', 'oLive', 'o3'] }
    const { card } = await load()
    // o1 10 + oLive 20 + o3 8. The stored lineup would say 18.
    expect(card.opponent?.projected).toBe(38)
    expect(card.opponent?.projectedFrom).toBe(3)
  })
})
