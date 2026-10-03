import { describe, expect, it, vi } from 'vitest'

import { bestLineup, loadWaiverBoard, lockedBestLineup, type Scored } from '@/lib/waivers/waiverBoard'
import { FOREIGN_IDS_UNREADABLE } from '@/lib/core-app/foreignIdSpaceCopy'

/*
 * Doubles for the loader tests at the bottom of this file. `bestLineup` above is pure and touches
 * none of them. The projection feed is keyed by Sleeper id: '6038' IS Sleeper's "Wrong Player".
 */
vi.mock('@/lib/core-app/myRoster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/myRoster')>()),
  findMyRoster: vi.fn(async () => ({ found: true, playerData: { players: ['6038'] } })),
}))
vi.mock('@/lib/core-app/playerProjections', async (importOriginal) => ({
  // The AF engine column: the carry-over arithmetic stays real, and the read finds no AF rows.
  afEngineForLeague: (await importOriginal<typeof import('@/lib/core-app/playerProjections')>()).afEngineForLeague,
  lookupAfEngineProjections: vi.fn(async () => new Map()),
  latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 4 })),
  lookupProjections: vi.fn(async (ids: readonly string[]) => {
    const feed: Record<string, { name: string; line: number; position?: string; team?: string }> = {
      '6038': { name: 'Wrong Player', line: 5 },
      fa1: { name: 'Free Agent', line: 12 },
      ...extraFeed,
    }
    return new Map(
      ids
        .filter((id) => feed[id])
        .map((id) => [
          id,
          {
            projectedPoints: feed[id].line,
            name: feed[id].name,
            position: feed[id].position ?? 'TE',
            team: feed[id].team ?? 'KC',
            componentStats: { rec: feed[id].line },
          },
        ]),
    )
  }),
}))
vi.mock('@/lib/projections/leagueScoring', () => ({
  computeLeagueProjectedPoints: (line: Record<string, number>) => ({ points: Number(line.rec) }),
}))
vi.mock('@/lib/waivers/recentFormProjection', () => ({ projectFromRecentForm: vi.fn(async () => new Map()) }))
// Nobody ruled out unless a test says so.
vi.mock('@/lib/core-app/unavailableStarters', () => ({ loadUnavailableBySport: vi.fn(async () => new Map()) }))
// The week the fixtures say is being played: the kickoff tests set it; every other test has none.
vi.mock('@/lib/core-app/sportsWeek', () => ({ resolveSportsWeek: vi.fn(async () => null), isPreseason: () => false }))
/** Extra projection-feed players for one test, keyed by id. Each test that sets it resets it. */
let extraFeed: Record<string, { name: string; line: number; position?: string; team?: string }> = {}

/**
 * The waiver board this replaces read nothing at all: `waiverRecommendationService` selects
 * columns that do not exist and a model that is not in the schema, so every query throws and
 * `analyzeRosterNeeds` returns the literal `["WR_depth","RB_depth","TE_upgrade"]` to every
 * manager in every league.
 */

const p = (sleeperId: string, position: string, points: number): Scored => ({
  sleeperId,
  name: sleeperId,
  position,
  team: null,
  points,
})

const STANDARD = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']

describe('bestLineup', () => {
  it('fills dedicated slots before flex', () => {
    /*
     * THE ORDERING BUG THIS PREVENTS. Walking slots in roster order lets FLEX take the best
     * running back first, leaving a real RB slot empty and understating every candidate measured
     * against that lineup. Sorting by how many positions can fill a slot puts dedicated ahead of
     * flex without a hardcoded list of which slots are flexes.
     */
    const roster = [
      p('qb', 'QB', 20),
      p('rb1', 'RB', 18),
      p('rb2', 'RB', 12),
      p('wr1', 'WR', 15),
      p('wr2', 'WR', 11),
      p('te', 'TE', 8),
      p('rb3', 'RB', 10),
    ]
    const { total, used } = bestLineup(roster, STANDARD)
    // Every dedicated slot filled, and the flex takes the best leftover (rb3, 10).
    expect(used.size).toBe(7)
    expect(total).toBe(94)
  })

  it('leaves a slot empty rather than filling it with an ineligible player', () => {
    // A roster with no tight end scores six slots, not seven — the TE slot stays unfilled
    // instead of being handed to a receiver.
    const roster = [p('qb', 'QB', 20), p('wr1', 'WR', 15)]
    const { total, used } = bestLineup(roster, ['QB', 'TE', 'WR'])
    expect(used.size).toBe(2)
    expect(total).toBe(35)
  })

  it('handles IDP slots off the league’s own list', () => {
    const roster = [p('lb1', 'LB', 14), p('lb2', 'LB', 9), p('db', 'CB', 7), p('dl', 'DE', 11)]
    const { total } = bestLineup(roster, ['LB', 'LB', 'DB', 'DL'])
    expect(total).toBe(41)
  })
})

describe('marginal gain — the reason this is not a "best available" list', () => {
  const roster = [
    p('qb', 'QB', 20),
    p('rb1', 'RB', 18),
    p('rb2', 'RB', 17),
    p('wr1', 'WR', 16),
    p('wr2', 'WR', 15),
    p('te', 'TE', 10),
    p('rb3', 'RB', 14),
  ]
  const base = bestLineup(roster, STANDARD).total

  it('values a big name at nothing when he would not crack the lineup', () => {
    /*
     * A 13-point running back behind three better ones adds zero. Ranking by raw projection puts
     * him near the top of the board; ranking by what he changes puts him off it.
     */
    const gain = bestLineup([...roster, p('fa', 'RB', 13)], STANDARD).total - base
    expect(gain).toBe(0)
  })

  it('values a modest player highly when he fills a genuine hole', () => {
    // The same 13 points at tight end, where the incumbent scores 10, is worth 3.
    const gain = bestLineup([...roster, p('fa', 'TE', 13)], STANDARD).total - base
    expect(gain).toBe(3)
  })

  it('counts a flex upgrade, not just a starter upgrade', () => {
    // Better than rb3 (the flex) but not than rb1/rb2 — worth the flex difference alone.
    const gain = bestLineup([...roster, p('fa', 'WR', 15.5)], STANDARD).total - base
    expect(gain).toBeCloseTo(1.5, 2)
  })

  it('identifies who the add pushes out of the lineup', () => {
    const before = bestLineup(roster, STANDARD)
    const after = bestLineup([...roster, p('fa', 'TE', 13)], STANDARD)
    const dropped = roster.filter((x) => before.used.has(x.sleeperId) && !after.used.has(x.sleeperId))
    expect(dropped.map((d) => d.sleeperId)).toEqual(['te'])
  })
})

/*
 * A Fleaflicker/MFL/Fantrax/Yahoo roster id is a short number in Sleeper's range. Read as a Sleeper
 * id, '6038' on a Fleaflicker roster was priced as Sleeper's player and named as the starter a free
 * agent "displaces".
 */
describe('loadWaiverBoard — foreign roster ids', () => {
  const prismaOn = (platform: string) =>
    ({
      league: {
        findUnique: async () => ({
          id: 'L1',
          settings: { scoring_settings: { rec: 1 }, roster_positions: ['TE'] },
          platform,
        }),
        findFirst: async () => null,
      },
      roster: { findMany: async () => [{ playerData: { players: ['6038'] } }] },
      playerGameStat: {
        aggregate: async (args: any) =>
          args?.where?.season ? { _max: { weekOrRound: 3 } } : { _max: { season: 2026 } },
        findMany: async () => [{ playerId: 'fa1' }],
      },
      sportsPlayer: {
        findMany: async () => [{ sleeperId: 'fa1', name: 'Free Agent', team: 'KC', position: 'TE', updatedAt: new Date() }],
      },
    }) as never

  it('does not price or name the Sleeper player who shares a Fleaflicker roster id', async () => {
    const board = await loadWaiverBoard({ prisma: prismaOn('fleaflicker'), leagueId: 'L1', userId: 'u-1' })
    expect(JSON.stringify(board)).not.toContain('Wrong Player')
    expect(board.candidates).toEqual([])
    // Imported but unread — not "no roster rows imported for your team yet".
    expect(board.state).toBe('ids_unreadable')
    expect(board.notes.join(' ')).toContain(FOREIGN_IDS_UNREADABLE)
  })

  it('CONTROL: the same id in a Sleeper league IS priced and named as displaced', async () => {
    const board = await loadWaiverBoard({ prisma: prismaOn('sleeper'), leagueId: 'L1', userId: 'u-1' })
    expect(board.state).toBe('ok')
    expect(board.candidates[0]?.displaces?.name).toBe('Wrong Player')
  })

  it('puts the AllFantasy engine beside the free agent and the starter he displaces, without moving the gain', async () => {
    const { lookupAfEngineProjections } = await import('@/lib/core-app/playerProjections')
    vi.mocked(lookupAfEngineProjections).mockResolvedValueOnce(new Map([
      ['fa1', { playerId: 'fa1', projectedPoints: 24, basis: null, confidence: null }],
      ['6038', { playerId: '6038', projectedPoints: 10, basis: null, confidence: null }],
    ]))
    const before = await loadWaiverBoard({ prisma: prismaOn('sleeper'), leagueId: 'L1', userId: 'u-1' })
    const board = await loadWaiverBoard({ prisma: prismaOn('sleeper'), leagueId: 'L1', userId: 'u-1' })
    // Provider line scores the same under this league as generic (rec x1), so AF carries over 1:1.
    expect(before.candidates[0]?.afProjectedPoints).toBe(24)
    expect(before.candidates[0]?.displaces?.afProjectedPoints).toBe(10)
    // Without AF rows the figures are absent, and the gain is identical either way.
    expect(board.candidates[0] && 'afProjectedPoints' in board.candidates[0]).toBe(false)
    expect(before.candidates[0]?.gain).toBe(board.candidates[0]?.gain)
  })

  /*
   * My Team's Lineup check sends the starters it knows will not play. Without that, a ruled-out
   * starter whose projection predates the designation stays in the best lineup at full value, and
   * the free agent who fills his slot is priced against a player who is not playing.
   */
  it('prices an add against the hole an unavailable starter leaves, and still names him', async () => {
    const normal = await loadWaiverBoard({ prisma: prismaOn('sleeper'), leagueId: 'L1', userId: 'u-1' })
    expect(normal.candidates[0]?.gain).toBe(7) // 12 against a 5-point starter

    const out = await loadWaiverBoard({ prisma: prismaOn('sleeper'), leagueId: 'L1', userId: 'u-1', unavailable: ['6038'] })
    expect(out.candidates[0]?.gain).toBe(12) // 12 against a zero
    expect(out.candidates[0]?.displaces?.name).toBe('Wrong Player')
  })

  /*
   * The Waivers screen passes no `unavailable` — only My Team's Lineup check did. So an IR back's stale
   * projection sat in "your lineup" (97.68 against a lineup projected 81.5, Elimination Station 2,
   * 2026-10-03) and sank every free agent's gain. The board now reads who is out itself.
   */
  it('zeroes a ruled-out roster player on its own, with no caller list — the Waivers screen passes none', async () => {
    const { loadUnavailableBySport } = await import('@/lib/core-app/unavailableStarters')
    vi.mocked(loadUnavailableBySport).mockResolvedValueOnce(new Map([['NFL', new Set(['6038'])]]))
    const board = await loadWaiverBoard({ prisma: prismaOn('sleeper'), leagueId: 'L1', userId: 'u-1' })
    expect(board.currentLineupPoints).toBe(0)
    expect(board.candidates[0]?.gain).toBe(12)
    expect(vi.mocked(loadUnavailableBySport)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sleeperIds: ['6038'], sports: ['NFL'], season: 2026, week: 4 }),
    )
  })

  it('a failed availability read changes nothing — the board as before', async () => {
    const { loadUnavailableBySport } = await import('@/lib/core-app/unavailableStarters')
    vi.mocked(loadUnavailableBySport).mockRejectedValueOnce(new Error('db down'))
    const board = await loadWaiverBoard({ prisma: prismaOn('sleeper'), leagueId: 'L1', userId: 'u-1' })
    expect(board.state).toBe('ok')
    expect(board.currentLineupPoints).toBe(5)
    expect(board.candidates[0]?.gain).toBe(7)
  })
})

/*
 * Kickoff locks (2026-10-03). Rico Dowdle scored 9.8 from Elimination Station 2's bench on Thursday;
 * on Saturday the board still seated him over a starter who had not played, so "your best lineup"
 * was a lineup nobody could field and every free agent was measured against it.
 */
describe('lockedBestLineup', () => {
  const SLOTS = ['RB', 'RB']
  const s1 = p('s1', 'RB', 4)
  const s2 = p('s2', 'RB', 15)
  const b1 = p('b1', 'RB', 10)

  it('without locks it is bestLineup, unchanged', () => {
    const locks = { pinned: new Map<number, string>(), frozenOut: new Set<string>() }
    expect(lockedBestLineup([s1, s2, b1], SLOTS, locks)).toEqual(bestLineup([s1, s2, b1], SLOTS))
  })
  it('a bench player whose game kicked off cannot come in', () => {
    const r = lockedBestLineup([s1, s2, b1], SLOTS, { pinned: new Map(), frozenOut: new Set(['b1']) })
    expect(r.total).toBe(19)
    expect(r.used.has('b1')).toBe(false)
  })
  it('a starter whose game kicked off keeps his slot, even against a better player', () => {
    const fa = p('fa', 'RB', 30)
    const r = lockedBestLineup([s1, s2, fa], SLOTS, { pinned: new Map([[0, 's1']]), frozenOut: new Set() })
    expect(r.used.has('s1')).toBe(true)
    expect(r.total).toBe(34) // s1's locked 4 + the 30 in the one open slot
  })
})

describe('loadWaiverBoard — kickoff locks', () => {
  const SAT = new Date('2026-10-03T16:00:00Z')
  const THU = new Date('2026-10-02T00:15:00Z') // PIT @ CLE, already played
  const SUN = new Date('2026-10-04T17:00:00Z')
  const games = [
    { homeTeam: 'CLE', awayTeam: 'PIT', startTime: THU, seasonType: 'regular', venue: null },
    { homeTeam: 'LV', awayTeam: 'KC', startTime: SUN, seasonType: 'regular', venue: null },
    { homeTeam: 'BUF', awayTeam: 'NE', startTime: SUN, seasonType: 'regular', venue: null },
    { homeTeam: 'CHI', awayTeam: 'NYJ', startTime: SUN, seasonType: 'regular', venue: null },
  ]
  const prisma = (starters: string[]) =>
    ({
      league: {
        findUnique: async () => ({ id: 'L1', settings: { scoring_settings: { rec: 1 }, roster_positions: ['RB', 'RB', 'BN'] }, platform: 'sleeper' }),
        findFirst: async () => null,
      },
      roster: { findMany: async () => [{ playerData: { players: ['s1', 's2', 'b1'], starters } }] },
      playerGameStat: {
        aggregate: async (args: any) => (args?.where?.season ? { _max: { weekOrRound: 3 } } : { _max: { season: 2026 } }),
        findMany: async () => [{ playerId: 'faSun' }, { playerId: 'faThu' }],
      },
      sportsPlayer: {
        findMany: async () => [
          { sleeperId: 'faSun', name: 'Sunday FA', team: 'NYJ', position: 'RB', updatedAt: new Date() },
          { sleeperId: 'faThu', name: 'Thursday FA', team: 'CLE', position: 'RB', updatedAt: new Date() },
        ],
      },
      sportsGame: { findMany: async () => games },
    }) as never

  const DOWDLE_WEEK = {
    s1: { name: 'Emmett Johnson', line: 4, position: 'RB', team: 'KC' },
    s2: { name: 'Jeremiyah Love', line: 15, position: 'RB', team: 'BUF' },
    b1: { name: 'Rico Dowdle', line: 10, position: 'RB', team: 'PIT' },
    faSun: { name: 'Sunday FA', line: 8, position: 'RB', team: 'NYJ' },
    faThu: { name: 'Thursday FA', line: 20, position: 'RB', team: 'CLE' },
  }

  const run = async (feed: typeof extraFeed, starters: string[], now: Date = SAT, fixturesWeek = 4) => {
    extraFeed = feed
    try {
      const { findMyRoster } = await import('@/lib/core-app/myRoster')
      vi.mocked(findMyRoster).mockResolvedValueOnce({ found: true, playerData: { players: ['s1', 's2', 'b1'], starters } } as never)
      const { resolveSportsWeek } = await import('@/lib/core-app/sportsWeek')
      vi.mocked(resolveSportsWeek).mockResolvedValueOnce({ season: 2026, week: fixturesWeek, seasonType: 'regular' } as never)
      return await loadWaiverBoard({ prisma: prisma(starters), leagueId: 'L1', userId: 'u-1', now })
    } finally {
      extraFeed = {}
    }
  }

  it('keeps a bench player who already played OUT of the best lineup, and measures adds against the real one', async () => {
    const board = await run(DOWDLE_WEEK, ['s1', 's2'])
    expect(board.currentLineupPoints).toBe(19) // Love 15 + Johnson 4 — not Love + Dowdle 25
    expect(board.candidates.map((c) => c.name)).toEqual(['Sunday FA'])
    expect(board.candidates[0]?.gain).toBe(4)
    expect(board.candidates[0]?.displaces?.name).toBe('Emmett Johnson')
    // The Thursday free agent would "gain" 16, but his game is over — he cannot play for you.
    // Only what happened: no starter is pinned here, so the note does not say "0 of your starters".
    expect(board.notes).toContain(
      'Games already kicked off are locked in: 1 bench player can no longer come in and 1 free agent whose game has started is not shown.',
    )
    expect(board.notes.join(' ')).not.toMatch(/\b0 /)
  })

  it('a starter who already played keeps his slot and is never "displaced"', async () => {
    const board = await run(
      { ...DOWDLE_WEEK, s1: { name: 'Thursday Starter', line: 4, position: 'RB', team: 'PIT' }, b1: { name: 'Bench Back', line: 3, position: 'RB', team: 'KC' } },
      ['s1', 's2'],
    )
    expect(board.currentLineupPoints).toBe(19)
    // The Sunday FA (8) would replace the 4-point starter — but that starter is locked in.
    expect(board.candidates).toEqual([])
    expect(board.notes).toContain(
      'Games already kicked off are locked in: 1 of your starters keeps his slot and 1 free agent whose game has started is not shown.',
    )
  })

  it('CONTROL: the same roster on Wednesday, before any kickoff, seats the 10-point back as before', async () => {
    const board = await run(DOWDLE_WEEK, ['s1', 's2'], new Date('2026-09-30T12:00:00Z'))
    expect(board.currentLineupPoints).toBe(25)
    expect(board.candidates.map((c) => c.name)).toEqual(['Thursday FA'])
  })

  it('applies no locks when the fixtures are for a different week than the projections', async () => {
    // The clock says week 5 while the projections are week 4: last week's kickoffs say nothing here.
    const board = await run(DOWDLE_WEEK, ['s1', 's2'], SAT, 5)
    expect(board.currentLineupPoints).toBe(25)
  })

  it('does not pin a starter whose slot it cannot know — starters shorter than the slots', async () => {
    const board = await run(
      { ...DOWDLE_WEEK, s1: { name: 'Thursday Starter', line: 4, position: 'RB', team: 'PIT' }, b1: { name: 'Bench Back', line: 3, position: 'RB', team: 'KC' } },
      ['s1'], // one starter stored against two slots
    )
    // Unpinned, so the old rule applies: the Sunday FA may take the 4-point back's seat.
    expect(board.candidates.map((c) => c.name)).toEqual(['Sunday FA'])
  })
})
