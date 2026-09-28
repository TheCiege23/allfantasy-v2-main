// @vitest-environment node
/**
 * 🛑 THE /core/matchup SCOREBOARD PRICES THE LINEUPS BEING PLAYED, AND A STARTER WHO WILL NOT PLAY
 * IS A 0 WITH HIS REASON BESIDE IT.
 *
 * `loadSideProjections` read no injury data and had no notion of a bye, so the board cells, the
 * projected final and the win probability all counted a ruled-out starter at full value and showed
 * a bye starter as unpriced — while My Team, pricing the same players, showed 0.0. It now reads
 * status through the same helper and rule My Team uses (`readInjuryStatusById` + `isRuledOut`) and
 * the same bye read (`getByeWeeks`), and prices a caller-supplied live lineup over the stored row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  settings: { scoring_settings: { rec: 1 } } as unknown,
  platform: 'sleeper',
  injuries: [] as Array<{ playerName: string; status: string }>,
  crosswalk: new Map<string, string>(),
  games: [] as Array<{ homeTeam: string; awayTeam: string; week: number; seasonType: string }>,
}))

/** Catches projected; the league scores a point a catch, so this IS each player's number. */
const RECEPTIONS: Record<string, number> = { a: 10, b: 6, c: 8, d: 12, e: 7 }
/** Each player's club. */
const CLUB: Record<string, string> = { a: 'NYJ', b: 'MIA', c: 'NE', d: 'KC', e: 'BUF' }

/** Every club these rosters use and then some — thirteen-plus fixtures, the plausible full slate `getByeWeeks` insists on. */
const CLUBS = ['BUF', 'NYJ', 'MIA', 'NE', 'KC', 'LV', 'LAC', 'DEN', 'DAL', 'PHI', 'NYG', 'WAS', 'GB', 'CHI', 'DET', 'MIN', 'SF', 'SEA', 'LAR', 'ARI', 'TB', 'NO', 'ATL', 'CAR', 'PIT', 'BAL', 'CLE']
/** A week-3 slate in which `offClub` does not play. */
function slateWithout(offClub: string) {
  const playing = CLUBS.filter((c) => c !== offClub)
  if (playing.length % 2) playing.push('HOU')
  return Array.from({ length: playing.length / 2 }, (_, i) => ({
    homeTeam: playing[2 * i],
    awayTeam: playing[2 * i + 1],
    week: 3,
    seasonType: 'regular',
  }))
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: {
      findMany: vi.fn(async () => [
        { platformUserId: 'you', playerData: { starters: ['a', 'b'] } },
        { platformUserId: 'them', playerData: { starters: ['c', 'd'] } },
      ]),
    },
    league: { findUnique: vi.fn(async () => ({ settings: db.settings, platform: db.platform, sport: 'NFL' })) },
    fantasyProjection: {
      findMany: vi.fn(async ({ where }: { where: { playerId: { in: string[] } } }) =>
        where.playerId.in
          .filter((id) => id in RECEPTIONS)
          .map((playerId) => ({ playerId, stats: { stats: { rec: RECEPTIONS[playerId] } } })),
      ),
    },
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
        where.sleeperId.in.map((sleeperId) => ({ sleeperId, name: `Player ${sleeperId}`, team: CLUB[sleeperId] ?? null, sport: 'NFL' })),
      ),
    },
    sportsInjury: {
      // Already ordered newest first, as the real query asks for.
      findMany: vi.fn(async ({ where }: { where: { playerName: { in: string[] } } }) =>
        db.injuries.filter((i) => where.playerName.in.includes(i.playerName)),
      ),
    },
    sportsGame: { findMany: vi.fn(async () => db.games) },
  },
}))

vi.mock('@/lib/core-app/rosterIdCrosswalk', () => ({
  crosswalkToSleeperIds: vi.fn(async () => db.crosswalk),
}))

import { loadSideProjections } from '@/lib/core-app/matchupProjections'

const load = (liveLineups?: { you: string[] | null; opponent: string[] | null }) =>
  loadSideProjections({
    leagueId: 'lg',
    season: 2026,
    week: 3,
    yourPlatformUserId: 'you',
    opponentPlatformUserId: 'them',
    ...(liveLineups ? { liveLineups } : {}),
  })

beforeEach(() => {
  db.settings = { scoring_settings: { rec: 1 } }
  db.platform = 'sleeper'
  db.injuries = []
  db.crosswalk = new Map()
  db.games = slateWithout('none') // every club plays
})

describe('Matchup scoreboard — a ruled-out starter', () => {
  it('control: with no injuries and no byes, every starter counts in full', async () => {
    const sides = await load()
    expect(sides?.you.projectedRemaining).toBe(16)
    expect(sides?.opponent.projectedRemaining).toBe(20)
    expect(sides?.you.lineup.every((s) => !s.unavailable)).toBe(true)
  })

  it('🛑 an OUT starter is 0 in the cell, the total and the model — on both sides — and says why', async () => {
    db.injuries = [
      { playerName: 'Player a', status: 'Out' },
      { playerName: 'Player d', status: 'Injured Reserve' },
    ]
    const sides = await load()

    expect(sides?.you.lineup).toEqual([
      { playerId: 'a', projected: 0, unavailable: 'out' },
      { playerId: 'b', projected: 6 },
    ])
    expect(sides?.you.projectedRemaining).toBe(6)
    expect(sides?.opponent.projectedRemaining).toBe(8)
    // Still priced — a known 0, not an unknown — so it is in the model and not a coverage gap.
    expect(sides?.you.starters.find((s) => s.playerId === 'a')?.projectedPoints).toBe(0)
    expect(sides?.you.unprojected).toBe(0)
  })

  it('questionable is not out, and the NEWEST status wins', async () => {
    db.injuries = [
      { playerName: 'Player a', status: 'Questionable' },
      { playerName: 'Player b', status: 'Active' }, // newest
      { playerName: 'Player b', status: 'Out' }, // older
    ]
    const sides = await load()
    expect(sides?.you.projectedRemaining).toBe(16)
  })

  it('reads the status through the crosswalk, and keeps the roster’s own id on the board', async () => {
    db.platform = 'espn'
    db.crosswalk = new Map([['espn-a', 'a']])
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.roster.findMany).mockResolvedValueOnce([
      { platformUserId: 'you', playerData: { starters: ['espn-a', 'b'] } },
      { platformUserId: 'them', playerData: { starters: ['c', 'd'] } },
    ] as never)
    db.injuries = [{ playerName: 'Player a', status: 'OUT' }]
    const sides = await load()
    expect(sides?.you.lineup[0]).toEqual({ playerId: 'espn-a', projected: 0, unavailable: 'out' })
  })

  it('without real rules nothing is priced — an OUT starter included', async () => {
    db.settings = null
    db.injuries = [{ playerName: 'Player a', status: 'Out' }]
    const sides = await load()
    expect(sides?.leagueScoring.available).toBe(false)
    expect(sides?.you.starters).toEqual([])
  })
})

describe('Matchup scoreboard — a starter on bye', () => {
  it('🛑 a starter whose club is off this week is a priced 0 marked BYE, not a coverage gap', async () => {
    db.games = slateWithout('KC') // `d`'s club
    const sides = await load()
    expect(sides?.opponent.lineup).toEqual([
      { playerId: 'c', projected: 8 },
      { playerId: 'd', projected: 0, unavailable: 'bye' },
    ])
    expect(sides?.opponent.projectedRemaining).toBe(8)
    expect(sides?.opponent.unprojected).toBe(0)
  })

  it('a bye wins over an injury status the same player also carries', async () => {
    db.games = slateWithout('KC')
    db.injuries = [{ playerName: 'Player d', status: 'Out' }]
    const sides = await load()
    expect(sides?.opponent.lineup[1]).toEqual({ playerId: 'd', projected: 0, unavailable: 'bye' })
  })

  it('a thin schedule is not evidence of a bye', async () => {
    db.games = slateWithout('KC').slice(0, 5)
    const sides = await load()
    expect(sides?.opponent.projectedRemaining).toBe(20)
  })
})

describe('Matchup scoreboard — the live lineup', () => {
  it('🛑 prices each side’s LIVE lineup over its stored row, holes kept in place', async () => {
    const sides = await load({ you: ['a', '0', 'e'], opponent: ['c'] })
    expect(sides?.you.lineup.map((s) => s.playerId)).toEqual(['a', '0', 'e'])
    expect(sides?.opponent.lineup.map((s) => s.playerId)).toEqual(['c'])
    expect(sides?.you.projectedRemaining).toBe(17) // a 10 + e 7
    expect(sides?.opponent.projectedRemaining).toBe(8)
  })

  it('a side with no live lineup falls back to its stored row', async () => {
    const sides = await load({ you: ['e'], opponent: null })
    expect(sides?.you.lineup.map((s) => s.playerId)).toEqual(['e'])
    expect(sides?.opponent.lineup.map((s) => s.playerId)).toEqual(['c', 'd'])
  })
})
