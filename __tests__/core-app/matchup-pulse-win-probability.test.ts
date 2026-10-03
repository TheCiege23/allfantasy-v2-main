// @vitest-environment node
/**
 * The cross-league board ranks by WIN PROBABILITY, not by the margin right now.
 *
 * 🛑 THE CASE THAT WAS WRONG IN PRODUCTION (2026-10-02, the Friday of week 4): a league up 30.9
 * after Thursday night sat third in "Leading" while both lineups had nearly everyone still to play
 * and it was projected to lose 533–571. Ranked by raw margin, the whole board was decided by which
 * leagues happened to start a Thursday player.
 *
 * Also pinned: "left to play" comes from THIS week's game states (it used to read a map of future
 * kickoffs only, so a finished game counted as still to play), and a row the model refuses keeps
 * its place by margin rather than disappearing.
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
function league(id: string, mine: string[], theirs: string[], points: [number, number] = [0, 0]) {
  const plid = `p-${id}`
  db.claimed.push({ externalId: '1', platformUserId: `me-${id}`, league: {
    id, name: `League ${id}`, platform: 'sleeper', platformLeagueId: plid, season: '2026', sport: 'NFL',
    logoUrl: null, avatarUrl: null, settings: { leg: 4, scoring_settings: { rec: 1 } }, status: 'in_season',
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
  db.games = [game('CIN', 'MIA', 'final', THU), game('KC', 'BUF', 'scheduled', SUN), game('SF', 'LAR', 'scheduled', SUN)]
  for (const k of Object.keys(PLAYERS)) delete PLAYERS[k]
  GENERIC_ONLY.clear()
  OUT.clear()
  lookups.length = 0
  feed.missingWeek4 = false
})

describe('🛑 ranked by win probability, not by Thursday night', () => {
  it('a +30 live lead with the stronger lineup still to come for them is an UNDERDOG', async () => {
    /* My Thursday player scored 30 and is done; my other starter is weak. Theirs are both studs on Sunday. */
    Object.assign(PLAYERS, { thu: [12, 'CIN'], weak: [5, 'KC'], stud1: [25, 'SF'], stud2: [25, 'LAR'] })
    const plid = league('A', ['thu', 'weak'], ['stud1', 'stud2'], [30, 0])
    db.scores = [{ leagueId: plid, seasonYear: 2026, week: 4, playerId: 'thu', points: 30 }]
    const pulse = await getMatchupPulse(USER, NOW)
    const row = pulse.trailing[0]
    expect(row).toMatchObject({ leagueId: 'A', basis: 'scored', margin: 30 })
    expect(row.pWin).toBeLessThan(0.5)
    /* 30 banked + 5 to come, against 50 to come. */
    expect(row.projectedMargin).toBeCloseTo(-15, 0)
    expect(pulse.leading).toHaveLength(0)
  })

  it('CONTROL: the same lead with nothing comparable left for them stays FAVOURED', async () => {
    Object.assign(PLAYERS, { thu: [12, 'CIN'], weak: [5, 'KC'], s1: [6, 'SF'], s2: [6, 'LAR'] })
    const plid = league('A', ['thu', 'weak'], ['s1', 's2'], [30, 0])
    db.scores = [{ leagueId: plid, seasonYear: 2026, week: 4, playerId: 'thu', points: 30 }]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading[0]?.leagueId).toBe('A')
    expect(pulse.leading[0]?.pWin).toBeGreaterThan(0.9)
  })

  it('orders the favoured column by odds, not by margin — the two disagree here', async () => {
    /*
     * 'volatile': 80 v 60, +20 — but four big, swingy projections (≈81%).
     * 'steady':   16 v 6,  +10 — half the margin, far less variance (≈92%).
     * By margin 'volatile' leads; by odds 'steady' does.
     */
    Object.assign(PLAYERS, {
      v1: [40, 'KC'], v2: [40, 'SF'], w1: [30, 'BUF'], w2: [30, 'LAR'],
      s1: [8, 'KC'], s2: [8, 'SF'], t1: [3, 'BUF'], t2: [3, 'LAR'],
    })
    league('volatile', ['v1', 'v2'], ['w1', 'w2'])
    league('steady', ['s1', 's2'], ['t1', 't2'])
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading.map((r) => r.leagueId)).toEqual(['steady', 'volatile'])
    expect(pulse.leading[0].margin).toBeLessThan(pulse.leading[1].margin)
    expect(pulse.leading[0].pWin as number).toBeGreaterThan(pulse.leading[1].pWin as number)
  })

  it('a final week is a result: 1 for the winner, with no model in it', async () => {
    Object.assign(PLAYERS, { x: [10, 'CIN'], y: [10, 'MIA'] })
    const plid = league('F', ['x'], ['y'], [40, 20])
    db.scores = [{ leagueId: plid, seasonYear: 2026, week: 4, playerId: 'x', points: 40 }, { leagueId: plid, seasonYear: 2026, week: 4, playerId: 'y', points: 20 }]
    /* Every regular-season game of week 4 final: the week is over even though the league's leg is still 4. */
    db.games = [game('CIN', 'MIA', 'final', THU)]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading[0]).toMatchObject({ leagueId: 'F', final: true, pWin: 1, projectedMargin: 20 })
    expect(pulse.allFinal).toBe(true)
  })
})

describe('a row the model refuses keeps its place, after every row with odds', () => {
  it('live points with no per-player scores: pWin null, placed by margin sign, ranked last', async () => {
    Object.assign(PLAYERS, { p1: [10, 'KC'], p2: [10, 'SF'], q1: [5, 'KC'], q2: [5, 'SF'] })
    league('noAttrib', ['p1'], ['q1'], [50, 0]) /* scored, no score rows → refused */
    league('odds', ['p2'], ['q2']) /* projected 10 v 5 → odds */
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading.map((r) => r.leagueId)).toEqual(['odds', 'noAttrib'])
    expect(pulse.leading[1]).toMatchObject({ pWin: null, projectedMargin: null, margin: 50 })
    expect(pulse.withOdds).toBe(1)
  })

  it('a starter still to play with no projection refuses the odds, like the league page', async () => {
    Object.assign(PLAYERS, { p1: [10, 'KC'], q1: [5, 'SF'] })
    const plid = league('L', ['p1', 'ghost'], ['q1'], [3, 0])
    db.scores = [{ leagueId: plid, seasonYear: 2026, week: 4, playerId: 'p1', points: 3 }]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading[0]).toMatchObject({ leagueId: 'L', pWin: null })
  })
})

describe('expected wins and closest games', () => {
  it('sums the odds into an expected record', async () => {
    Object.assign(PLAYERS, { a: [20, 'KC'], b: [20, 'SF'], c: [20, 'KC'], d: [20, 'SF'] })
    league('even1', ['a'], ['c'])
    league('even2', ['b'], ['d'])
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.withOdds).toBe(2)
    expect(pulse.expectedWins).toBeCloseTo(1, 1)
    /* Two exact coin flips sit in neither column — and are the closest games on the board. */
    expect(pulse.leading).toHaveLength(0)
    expect(pulse.trailing).toHaveLength(0)
    expect(pulse.closest.map((r) => r.leagueId).sort()).toEqual(['even1', 'even2'])
  })

  it('never repeats a row already shown in a column', async () => {
    Object.assign(PLAYERS, { a: [30, 'KC'], c: [5, 'KC'] })
    league('shown', ['a'], ['c'])
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading.map((r) => r.leagueId)).toEqual(['shown'])
    expect(pulse.closest).toHaveLength(0)
  })
})

describe('🛑 left to play, from THIS week’s game states', () => {
  it('a finished Thursday game is not "to play"; Sunday games are', async () => {
    Object.assign(PLAYERS, { thu: [12, 'CIN'], sun: [12, 'KC'], o1: [12, 'SF'], o2: [12, 'LAR'] })
    league('A', ['thu', 'sun'], ['o1', 'o2'])
    const pulse = await getMatchupPulse(USER, NOW)
    expect([...pulse.leading, ...pulse.trailing, ...pulse.closest][0]?.startersLeft).toBe(1)
  })

  it('"0 left to play" can be said once every game is final', async () => {
    Object.assign(PLAYERS, { thu: [12, 'CIN'], o1: [5, 'MIA'] })
    const plid = league('A', ['thu'], ['o1'], [20, 4])
    db.scores = [{ leagueId: plid, seasonYear: 2026, week: 4, playerId: 'thu', points: 20 }, { leagueId: plid, seasonYear: 2026, week: 4, playerId: 'o1', points: 4 }]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading[0]?.startersLeft).toBe(0)
  })

  it('a starter whose club is not on the schedule makes the count unknown, not lower', async () => {
    Object.assign(PLAYERS, { sun: [12, 'KC'], lost: [12, 'NYJ'], o1: [12, 'SF'], o2: [12, 'LAR'] })
    league('A', ['sun', 'lost'], ['o1', 'o2'])
    const pulse = await getMatchupPulse(USER, NOW)
    expect([...pulse.leading, ...pulse.trailing, ...pulse.closest][0]?.startersLeft).toBeNull()
  })
})

/*
 * 🛑 THE BOARD'S ODDS ARE THE LEAGUE PAGE'S ODDS. Production 2026-10-02: 98% here, "—" on the
 * league page, for the same game. Both now go through `forecastMatchup` with the same inputs.
 */
describe('🛑 one win probability, shared with the league page', () => {
  it('prices each league for ITS OWN week, not the feed’s newest one', async () => {
    Object.assign(PLAYERS, { a: [10, 'KC'], c: [5, 'SF'] })
    league('W', ['a'], ['c'])
    await getMatchupPulse(USER, NOW)
    expect(lookups).toContainEqual({ at: { season: '2026', week: 4 }, sport: 'NFL' })
    expect(lookups.some((l) => (l.at as { week: number }).week === 5)).toBe(false)
  })

  it('a week the feed does not hold keeps a margin from the newest week, but no odds', async () => {
    feed.missingWeek4 = true
    Object.assign(PLAYERS, { a: [10, 'KC'], c: [5, 'SF'] })
    league('W', ['a'], ['c'])
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading[0]).toMatchObject({ leagueId: 'W', margin: 5, pWin: null })
  })

  it('🛑 a vendor-only price gives a margin but never odds — a PPR total is not this league’s number', async () => {
    Object.assign(PLAYERS, { a: [10, 'KC'], c: [5, 'SF'] })
    GENERIC_ONLY.add('a')
    league('V', ['a'], ['c'])
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading[0]).toMatchObject({ leagueId: 'V', margin: 5, pWin: null })
  })

  it('🛑 a ruled-out starter is a zero in the margin and the odds, as on the league page', async () => {
    Object.assign(PLAYERS, { a: [10, 'KC'], stud: [25, 'SF'] })
    league('O', ['a'], ['stud'])
    const before = await getMatchupPulse(USER, NOW)
    expect(before.trailing[0]?.leagueId).toBe('O')

    db.claimed = []; db.weekRows = []; db.teams = []; db.rosters = []
    OUT.add('stud')
    league('O', ['a'], ['stud'])
    const after = await getMatchupPulse(USER, NOW)
    expect(after.leading[0]).toMatchObject({ leagueId: 'O', margin: 10 })
    expect(after.leading[0]?.pWin).toBeGreaterThan(0.9)
  })

  it('🛑 an empty slot is a certain zero — the league is ranked, not "cannot compare"', async () => {
    Object.assign(PLAYERS, { a: [10, 'KC'], b: [8, 'SF'], c: [12, 'BUF'] })
    league('E', ['a', 'b'], ['c', '0'])
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.notRanked.uncomparable).toBe(0)
    expect(pulse.leading[0]).toMatchObject({ leagueId: 'E', margin: 6 })
    expect(pulse.leading[0]?.pWin).not.toBeNull()
    /* The hole is nobody, so it is not "to play" either. */
    expect(pulse.leading[0]?.startersLeft).toBe(2)
  })

  it('the number on the board IS the shared function’s number for the same lineup', async () => {
    Object.assign(PLAYERS, { a: [14, 'KC'], b: [9, 'SF'], c: [11, 'BUF'], d: [10, 'LAR'] })
    league('P', ['a', 'b'], ['c', 'd'])
    const pulse = await getMatchupPulse(USER, NOW)
    const { forecastMatchup } = await import('@/lib/core-app/matchupForecast')
    const side = (ids: string[]) => ({
      teamPoints: 0,
      hasPlayerPoints: false,
      starters: ids.map((id) => ({ playerId: id, projected: PLAYERS[id][0], actual: 0, state: 'upcoming' as const })),
    })
    const shared = forecastMatchup(side(['a', 'b']), side(['c', 'd']))
    expect(shared.available).toBe(true)
    expect(pulse.leading[0]?.pWin).toBe(shared.available ? shared.pWin : NaN)
  })
})

/*
 * 🛑 THE 20s CADENCE KEYS ON A GAME IN PROGRESS, NOT ON STARTERS STILL TO PLAY (2026-10-02). This
 * fixture is that Friday: Thursday's game is final, Sunday's are to come, nobody is playing.
 */
describe('🛑 what the refresh cadence reads: liveNow and nextKickoffAt', () => {
  it('Friday, nothing on: not live, and the next kickoff is Sunday’s', async () => {
    Object.assign(PLAYERS, { thu: [12, 'CIN'], sun: [12, 'KC'], o1: [12, 'SF'], o2: [12, 'LAR'] })
    const plid = league('A', ['thu', 'sun'], ['o1', 'o2'], [20, 0])
    db.scores = [{ leagueId: plid, seasonYear: 2026, week: 4, playerId: 'thu', points: 20 }]
    const pulse = await getMatchupPulse(USER, NOW)
    /* Your Sunday starter is still to play — the old test said "in play" here. */
    expect([...pulse.leading, ...pulse.trailing, ...pulse.closest][0]?.startersLeft).toBe(1)
    expect(pulse.liveNow).toBe(false)
    expect(pulse.nextKickoffAt).toBe(SUN.toISOString())
  })

  it('a starter whose game is in progress makes the board live — either side', async () => {
    db.games = [game('CIN', 'MIA', 'final', THU), game('KC', 'BUF', 'in_progress', new Date('2026-10-02T11:30:00Z')), game('SF', 'LAR', 'scheduled', SUN)]
    Object.assign(PLAYERS, { a: [12, 'SF'], o1: [12, 'KC'] })
    league('L', ['a'], ['o1'])
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.liveNow).toBe(true)
  })

  it('a ruled-out starter whose club is playing does not make the board live', async () => {
    db.games = [game('KC', 'BUF', 'in_progress', new Date('2026-10-02T11:30:00Z')), game('SF', 'LAR', 'scheduled', SUN)]
    Object.assign(PLAYERS, { hurt: [12, 'KC'], a: [12, 'SF'], o1: [12, 'LAR'] })
    OUT.add('hurt')
    league('X', ['hurt', 'a'], ['o1', '0'])
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.liveNow).toBe(false)
    expect(pulse.nextKickoffAt).toBe(SUN.toISOString())
  })

  it('a finished week reports no next kickoff and is not live', async () => {
    Object.assign(PLAYERS, { x: [10, 'CIN'], y: [10, 'MIA'] })
    const plid = league('F', ['x'], ['y'], [40, 20])
    db.scores = [{ leagueId: plid, seasonYear: 2026, week: 4, playerId: 'x', points: 40 }, { leagueId: plid, seasonYear: 2026, week: 4, playerId: 'y', points: 20 }]
    db.games = [game('CIN', 'MIA', 'final', THU)]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.liveNow).toBe(false)
    expect(pulse.nextKickoffAt).toBeNull()
  })
})
