import { describe, expect, it } from 'vitest'
import {
  bidStatus, buildWildcardPool, championshipGame, computeDivision, conferencePoints, decideGame,
  defaultFormatSettings, divisionFirstRound, divisionsCalendar, gameKey, playBracket, rankDivision,
  regionFor, regionGames, regionPairOrder, seedDivision, seedingBlockers, validateFormatSettings,
  type BracketEntrant, type DivisionTeamInput,
} from '@/lib/tournament/divisions/engine'
import { sampleDivisionsField } from '@/lib/tournament/divisions/sampleData'

/** 120 teams, strictly ordered: team i has (120-i)/12 wins-ish and descending points, so rank === i+1. */
function field(n = 120): DivisionTeamInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${String(i + 1).padStart(3, '0')}`, name: `Team ${i + 1}`, conferenceId: `c${i % 10}`,
    wins: 9 - Math.floor(i / 14), losses: Math.floor(i / 14), points: 2000 - i * 5, bestWeek: 150,
  }))
}

describe('rankDivision — record, then points, then best week', () => {
  it('ranks by wins before points', () => {
    const r = rankDivision([
      { id: 'a', name: 'A', conferenceId: 'x', wins: 5, losses: 4, points: 1200 },
      { id: 'b', name: 'B', conferenceId: 'x', wins: 6, losses: 3, points: 900 },
    ])
    expect(r.map(t => t.id)).toEqual(['b', 'a'])
    expect(r.every(t => t.tiebreak === null)).toBe(true)
  })

  it('breaks a record tie on points and says so on both rows', () => {
    const r = rankDivision([
      { id: 'a', name: 'A', conferenceId: 'x', wins: 5, losses: 4, points: 900 },
      { id: 'b', name: 'B', conferenceId: 'x', wins: 5, losses: 4, points: 950 },
      { id: 'c', name: 'C', conferenceId: 'x', wins: 3, losses: 6, points: 1500 },
    ])
    expect(r.map(t => [t.id, t.rank, t.tiebreak])).toEqual([['b', 1, 'points'], ['a', 2, 'points'], ['c', 3, null]])
  })

  it('falls to best single week, then commissioner review — never random', () => {
    const base = { conferenceId: 'x', wins: 5, losses: 4, points: 1000 }
    const r = rankDivision([
      { id: 'z', name: 'Z', ...base, bestWeek: 140 },
      { id: 'y', name: 'Y', ...base, bestWeek: 160 },
    ])
    expect(r.map(t => [t.id, t.tiebreak])).toEqual([['y', 'best_week'], ['z', 'best_week']])
    const unresolved = rankDivision([
      { id: 'q', name: 'Q', ...base, bestWeek: null },
      { id: 'p', name: 'P', ...base, bestWeek: 150 },
    ])
    expect(unresolved.map(t => t.tiebreak)).toEqual(['review', 'review'])
    // deterministic order regardless of input order
    expect(rankDivision([...unresolved].reverse()).map(t => t.id)).toEqual(unresolved.map(t => t.id))
  })

  it('counts a tie as half a win', () => {
    const r = rankDivision([
      { id: 'a', name: 'A', conferenceId: 'x', wins: 5, losses: 4, ties: 0, points: 1000 },
      { id: 'b', name: 'B', conferenceId: 'x', wins: 5, losses: 3, ties: 1, points: 900 },
    ])
    expect(r[0]!.id).toBe('b')
  })

  it('refuses a duplicate team', () => {
    const t = field(2)
    expect(() => rankDivision([t[0]!, t[0]!])).toThrow(/Duplicate/)
  })
})

describe('wildcard pool — bubble 53–64 plus the 12 top scorers of 65–120, on points', () => {
  const ranked = rankDivision(field())

  it('holds exactly 24 teams: the bubble and 12 top scorers', () => {
    const pool = buildWildcardPool(ranked, 52, 12)
    expect(pool.entries).toHaveLength(24)
    expect(pool.entries.filter(e => e.via === 'bubble').map(e => e.divisionRank).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => 53 + i))
    const scorers = pool.entries.filter(e => e.via === 'top_scorer')
    expect(scorers).toHaveLength(12)
    expect(scorers.every(e => e.divisionRank >= 65)).toBe(true)
  })

  it('lets a bad record in on points', () => {
    const teams = field()
    // rank 100 has the worst record band but the best points in the whole division
    const hot = teams[99]!
    hot.points = 5000
    const r = rankDivision(teams)
    const pool = buildWildcardPool(r, 52, 12)
    const entry = pool.entries.find(e => e.id === hot.id)!
    expect(entry.via).toBe('top_scorer')
    expect(entry.poolRank).toBe(1)
    expect(entry.in).toBe(true)
    expect(bidStatus(r.find(t => t.id === hot.id)!, 52, pool)).toBe('wildcard')
  })

  it('reports the line to beat and the gap to it, matching the screen', () => {
    const pool = buildWildcardPool(ranked, 52, 12)
    const sorted = [...pool.entries].sort((a, b) => a.poolRank - b.poolRank)
    const twelfth = sorted[11]!, thirteenth = sorted[12]!
    expect(pool.lineToBeat).toBe(twelfth.points)
    expect(twelfth.in).toBe(true)
    expect(thirteenth.in).toBe(false)
    expect(twelfth.toLine).toBeCloseTo(twelfth.points - thirteenth.points, 5)
    expect(thirteenth.toLine).toBeCloseTo(thirteenth.points - twelfth.points, 5)
    expect(sorted.filter(e => e.in)).toHaveLength(12)
  })

  it('breaks a points tie in the pool on record', () => {
    const teams = field()
    // two teams in the pool with the same points: rank 60 (5 wins) and rank 80 (4 wins)
    teams[59]!.points = 3000; teams[79]!.points = 3000
    const r = rankDivision(teams)
    const pool = buildWildcardPool(r, 52, 12)
    const a = pool.entries.find(e => e.id === teams[59]!.id)!, b = pool.entries.find(e => e.id === teams[79]!.id)!
    expect(a.poolTiebreak).toBe('record')
    expect(b.poolTiebreak).toBe('record')
    expect(a.poolRank).toBeLessThan(b.poolRank)
  })

  it('statuses: auto, wildcard, bubble out, out', () => {
    const pool = buildWildcardPool(ranked, 52, 12)
    const s = (rank: number) => bidStatus(ranked[rank - 1]!, 52, pool)
    expect(s(1)).toBe('auto')
    expect(s(52)).toBe('auto')
    expect(['wildcard', 'bubble_out']).toContain(s(53))
    expect(s(120)).toBe('out')
  })
})

describe('seeding — four per line, snake across regions', () => {
  it('odd lines go N,E,S,W and even lines W,S,E,N', () => {
    expect([0, 1, 2, 3].map(p => regionFor(1, p))).toEqual(['North', 'East', 'South', 'West'])
    expect([0, 1, 2, 3].map(p => regionFor(2, p))).toEqual(['West', 'South', 'East', 'North'])
    expect([0, 1, 2, 3].map(p => regionFor(13, p))).toEqual(['North', 'East', 'South', 'West'])
    expect([0, 1, 2, 3].map(p => regionFor(16, p))).toEqual(['West', 'South', 'East', 'North'])
    expect(() => regionFor(1, 4)).toThrow()
  })

  it('auto bids take seeds 1–13, wildcards 14–16, 16 per region', () => {
    const ranked = rankDivision(field())
    const pool = buildWildcardPool(ranked, 52, 12)
    const seeded = seedDivision(ranked, pool, 52)
    expect(seeded).toHaveLength(64)
    expect(seeded.filter(t => t.bid === 'auto').every(t => t.seedLine <= 13)).toBe(true)
    expect(seeded.filter(t => t.bid === 'wildcard').map(t => t.seedLine).sort()).toEqual([14, 14, 14, 14, 15, 15, 15, 15, 16, 16, 16, 16])
    for (const region of ['North', 'East', 'South', 'West']) {
      const lines = seeded.filter(t => t.region === region).map(t => t.seedLine).sort((a, b) => a - b)
      expect(lines).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    }
    // division rank 1 is the North 1 seed; rank 5 (best on line 2) is the West 2 seed
    expect(seeded[0]).toMatchObject({ rank: 1, region: 'North', seedLine: 1, overallSeed: 1 })
    expect(seeded[4]).toMatchObject({ rank: 5, region: 'West', seedLine: 2 })
    expect(seeded[7]).toMatchObject({ rank: 8, region: 'North', seedLine: 2 })
  })

  it('wildcards are seeded in pool (points) order, not division rank order', () => {
    const teams = field()
    teams[119]!.points = 9999 // last place by record, best points
    const r = computeDivision(teams, { autoBids: 52, wildcardSpots: 12 })
    const first = r.seeded!.find(t => t.bid === 'wildcard')!
    expect(first.id).toBe(teams[119]!.id)
    expect(first.seedLine).toBe(14)
    expect(first.region).toBe('West') // line 14 is even: W first
  })

  it('works for 24 + 8 = 32 (8 per region)', () => {
    const r = computeDivision(field(80), { autoBids: 24, wildcardSpots: 8 })
    expect(r.seeded).toHaveLength(32)
    expect(r.bracket![0]).toHaveLength(16)
    expect(r.bracket).toHaveLength(5)
  })

  it('works for 112 + 16 = 128 (32 per region)', () => {
    const r = computeDivision(field(140), { autoBids: 112, wildcardSpots: 16 })
    expect(r.seeded).toHaveLength(128)
    expect(r.bracket).toHaveLength(7)
  })

  it('returns no seeds while the division is too small', () => {
    const r = computeDivision(field(40), { autoBids: 52, wildcardSpots: 12 })
    expect(r.seeded).toBeNull()
    expect(r.bracket).toBeNull()
  })
})

describe('brackets', () => {
  it('pairs a 16-team region 1-16, 8-9, 5-12, 4-13, 6-11, 3-14, 7-10, 2-15', () => {
    expect(regionPairOrder(16)).toEqual([1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15])
    expect(regionPairOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
    expect(regionPairOrder(32)).toHaveLength(32)
    expect(new Set(regionPairOrder(32)).size).toBe(32)
  })

  const e = (id: string, seedLine: number, wins = 5, bestWeek: number | null = 150): BracketEntrant =>
    ({ id, name: id, conferenceId: 'c', seedLine, overallSeed: seedLine, region: 'North', wins, losses: 9 - wins, ties: 0, bestWeek })

  it('higher score wins; a tie goes to the higher seed, then record, then best week, then review', () => {
    expect(decideGame(e('a', 3), e('b', 14), 100, 120)).toEqual({ winner: expect.objectContaining({ id: 'b' }), decidedBy: 'score' })
    expect(decideGame(e('a', 3), e('b', 14), 110, 110)).toEqual({ winner: expect.objectContaining({ id: 'a' }), decidedBy: 'seed' })
    expect(decideGame(e('a', 1, 5), e('b', 1, 7), 110, 110)).toEqual({ winner: expect.objectContaining({ id: 'b' }), decidedBy: 'record' })
    expect(decideGame(e('a', 1, 5, 170), e('b', 1, 5, 160), 110, 110)).toEqual({ winner: expect.objectContaining({ id: 'a' }), decidedBy: 'best_week' })
    expect(decideGame(e('a', 1, 5, null), e('b', 1, 5, 160), 110, 110)).toEqual({ winner: null, decidedBy: 'review' })
  })

  it('propagates winners round by round and stops at an unplayed game', () => {
    const pairs: Array<[BracketEntrant, BracketEntrant]> = [[e('a', 1), e('h', 8)], [e('d', 4), e('e', 5)], [e('b', 2), e('g', 7)], [e('c', 3), e('f', 6)]]
    const rounds = playBracket(pairs, { [gameKey(1, 0)]: { a: 100, b: 90 }, [gameKey(1, 1)]: { a: 80, b: 95 }, [gameKey(1, 2)]: { a: 70, b: 71 } })
    expect(rounds).toHaveLength(3)
    expect(rounds[1]![0]!.a?.id).toBe('a')
    expect(rounds[1]![0]!.b?.id).toBe('e')
    expect(rounds[1]![1]!.a?.id).toBe('g')
    expect(rounds[1]![1]!.b).toBeNull() // game 1:3 unplayed
    expect(rounds[2]![0]!.a).toBeNull()
  })

  it('a commissioner override settles a review game and nothing else', () => {
    const pairs: Array<[BracketEntrant, BracketEntrant]> = [[e('a', 1, 5, null), e('b', 1, 5, null)]]
    const unresolved = playBracket(pairs, { '1:0': { a: 99, b: 99 } })
    expect(unresolved[0]![0]!.winner).toBeNull()
    const settled = playBracket(pairs, { '1:0': { a: 99, b: 99 } }, { '1:0': 'b' })
    expect(settled[0]![0]!.winner?.id).toBe('b')
    const ignored = playBracket(pairs, { '1:0': { a: 99, b: 50 } }, { '1:0': 'b' })
    expect(ignored[0]![0]!.winner?.id).toBe('a')
  })

  it('a division bracket runs regions, then N v W and E v S in the final four', () => {
    const r = computeDivision(field(), { autoBids: 52, wildcardSpots: 12 })
    const first = divisionFirstRound(r.seeded!)
    expect(first).toHaveLength(32)
    expect(first[0]![0]).toMatchObject({ region: 'North', seedLine: 1 })
    expect(first[0]![1]).toMatchObject({ region: 'North', seedLine: 16 })
    expect(first[8]![0]).toMatchObject({ region: 'West', seedLine: 1 })
    // chalk: higher seed always wins by 10
    const scores: Record<string, { a: number; b: number }> = {}
    let rounds = playBracket(first, scores)
    for (let round = 1; round <= rounds.length; round++) {
      rounds[round - 1]!.forEach((g, i) => { if (g.a && g.b) scores[gameKey(round, i)] = g.a.overallSeed < g.b.overallSeed ? { a: 110, b: 100 } : { a: 100, b: 110 } })
      rounds = playBracket(first, scores)
    }
    expect(rounds.map(g => g.length)).toEqual([32, 16, 8, 4, 2, 1])
    const finalFour = rounds[4]!
    expect([finalFour[0]!.a?.region, finalFour[0]!.b?.region]).toEqual(['North', 'West'])
    expect([finalFour[1]!.a?.region, finalFour[1]!.b?.region]).toEqual(['East', 'South'])
    expect(rounds[5]![0]!.winner?.overallSeed).toBe(1)
    const north = regionGames(rounds, 'North')
    expect(north.map(g => g.length)).toEqual([8, 4, 2, 1])
    expect(north[3]![0]!.winner?.seedLine).toBe(1)
  })

  it('championship: division champions meet; tie to the higher seed', () => {
    const g = championshipGame(e('a', 2), e('b', 1), { a: 120, b: 120 })
    expect(g.winner?.id).toBe('b')
    expect(g.decidedBy).toBe('seed')
    expect(championshipGame(e('a', 2), null).winner).toBeNull()
  })
})

describe('calendar — championship is season length − 1', () => {
  it('NFL 64: regular weeks 1–10, R64 wk 11 … division final wk 16, championship wk 17', () => {
    const c = divisionsCalendar(defaultFormatSettings('NFL'))
    expect(c.lastWeek).toBe(17)
    expect(c.bracketStartWeek).toBe(11)
    expect(c.regularSeason).toEqual({ start: 1, end: 10 })
    expect(c.seedingLocksAfter).toBe(10)
    expect(c.weeks.map(w => [w.week, w.label])).toEqual([
      [11, 'Round of 64'], [12, 'Round of 32'], [13, 'Sweet 16'], [14, 'Region finals'],
      [15, 'Division final four'], [16, 'Division final'], [17, 'Championship'],
    ])
  })

  it('a 32-team bracket starts a week later', () => {
    const c = divisionsCalendar({ autoBids: 24, wildcardSpots: 8, seasonLength: 18 })
    expect(c.bracketStartWeek).toBe(12)
    expect(c.weeks[0]).toMatchObject({ week: 12, label: 'Round of 32' })
  })
})

describe('commissioner settings validation', () => {
  it('the default is valid: 240 entrants, 20 leagues, 56 miss out per division', () => {
    const r = validateFormatSettings(defaultFormatSettings('NFL'))
    expect(r.errors).toEqual([])
    expect(r).toMatchObject({ bracketSize: 64, totalTeams: 240, leagues: 20, missOut: 56 })
  })

  it('warns when automatic bids plus wildcards is not 32, 64 or 128', () => {
    const r = validateFormatSettings({ ...defaultFormatSettings('NFL'), autoBids: 56, wildcardSpots: 12 })
    expect(r.errors.join(' ')).toMatch(/32, 64 or 128.*68/)
  })

  it('requires whole seed lines and enough teams', () => {
    expect(validateFormatSettings({ ...defaultFormatSettings('NFL'), autoBids: 50, wildcardSpots: 14 }).errors.join(' ')).toMatch(/multiple of 4/)
    expect(validateFormatSettings({ ...defaultFormatSettings('NFL'), conferencesPerDivision: 4, teamsPerConference: 14 }).errors.join(' ')).toMatch(/too few/)
    expect(validateFormatSettings({ ...defaultFormatSettings('NFL'), conferencesPerDivision: 6, teamsPerConference: 12 }).warnings.join(' ')).toMatch(/fewer than 12 top scorers/)
  })

  it('rejects out-of-range options', () => {
    expect(validateFormatSettings({ ...defaultFormatSettings('NFL'), conferencesPerDivision: 12 }).errors.length).toBeGreaterThan(0)
    expect(validateFormatSettings({ ...defaultFormatSettings('NFL'), teamsPerConference: 7 }).errors.length).toBeGreaterThan(0)
  })
})

describe('conference points and blockers', () => {
  it('sums season points per conference and counts teams in the bracket', () => {
    const teams = field(20)
    const totals = conferencePoints(teams, [{ id: 't001' }, { id: 't011' }])
    const c0 = totals.find(t => t.conferenceId === 'c0')!
    expect(c0).toEqual({ conferenceId: 'c0', points: 2000 + 1950, teams: 2, inBracket: 2 })
  })

  it('blocks seeding while any score is provisional', () => {
    const teams = field(4)
    expect(seedingBlockers(teams)).toEqual([])
    teams[2]!.provisional = true
    expect(seedingBlockers(teams)[0]).toMatch(/1 team has missing or provisional scores/)
  })
})

describe('sample field', () => {
  it('is repeatable and seeds a full 64 per division', () => {
    const a = sampleDivisionsField(), b = sampleDivisionsField()
    expect(a.teams).toEqual(b.teams)
    expect(a.teams).toHaveLength(240)
    for (const d of [0, 1]) {
      const r = computeDivision(a.teams.filter(t => t.divisionIndex === d), { autoBids: 52, wildcardSpots: 12 })
      expect(r.seeded).toHaveLength(64)
      expect(r.pool.entries).toHaveLength(24)
    }
  })
})
