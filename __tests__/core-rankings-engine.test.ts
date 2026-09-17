import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import type { CareerLedgerRow } from '@/lib/rank/careerLedger'
import {
  berthCredited,
  mergeLedgerSources,
  normalizeLeagueType,
  normalizeScoring,
  normalizeSpecialty,
} from '@/lib/rank/careerLedger'
import { careerXp } from '@/lib/rank/careerXp'
import {
  DEFAULT_FILTERS,
  DEFAULT_MIN_SAMPLE,
  buildScoringCohorts,
  describeFilters,
  easternDateKey,
  fantasyWeekStartKey,
  filterOptions,
  filterParams,
  matchesFilters,
  movementSince,
  parseBoard,
  parseRankingFilters,
  parseSort,
  rankBoard,
  scoreRows,
  seasonTrend,
  shiftDateKey,
  sortBoardRows,
  SCORING_COHORT_MIN,
  type CommunityEntry,
} from '@/lib/core-app/rankingsEngine'

let seq = 0
function row(over: Partial<CareerLedgerRow> = {}): CareerLedgerRow {
  seq += 1
  const wins = over.wins ?? 7
  const losses = over.losses ?? 7
  const ties = over.ties ?? 0
  return {
    userId: 'u1',
    key: `sleeper:L${seq}:${over.season ?? 2024}`,
    source: 'legacy',
    platform: 'sleeper',
    sport: 'NFL',
    season: 2024,
    leagueName: `League ${seq}`,
    refId: `ref${seq}`,
    leagueSize: 12,
    leagueSizeKnown: true,
    playoffTeams: 6,
    leagueType: 'redraft',
    specialty: 'standard',
    scoring: 'ppr',
    superflex: false,
    tePremium: false,
    wins,
    losses,
    ties,
    pointsFor: 1400,
    gamesPlayed: wins + losses + ties,
    madePlayoffs: false,
    wonChampionship: false,
    completed: true,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function entry(userId: string, handle: string, rows: CareerLedgerRow[], cohorts = buildScoringCohorts(rows)): CommunityEntry {
  return { userId, handle, avatarUrl: null, level: 1, tierGroup: 1, score: scoreRows(rows, cohorts) }
}

describe('ledger mapping', () => {
  it('gates a playoff berth on games played, whatever the source says', () => {
    expect(berthCredited(true, false, 0)).toBe(false)
    expect(berthCredited(false, true, 0)).toBe(false)
    expect(berthCredited(true, false, 3)).toBe(true)
    expect(berthCredited(false, true, 14)).toBe(true)
    expect(berthCredited(false, false, 14)).toBe(false)
  })

  it('never reads keeper from a default and lets isDynasty win', () => {
    expect(normalizeLeagueType('redraft', true)).toBe('dynasty')
    expect(normalizeLeagueType('Keeper')).toBe('keeper')
    expect(normalizeLeagueType('Dynasty')).toBe('dynasty')
    expect(normalizeLeagueType('devy', false)).toBe('dynasty')
    expect(normalizeLeagueType(null)).toBe('unknown')
    expect(normalizeLeagueType('survivor')).toBe('unknown')
  })

  it('maps the scoring and specialty spellings production holds', () => {
    expect(normalizeScoring('PPR')).toBe('ppr')
    expect(normalizeScoring('Half PPR')).toBe('half')
    expect(normalizeScoring('half')).toBe('half')
    expect(normalizeScoring('Standard')).toBe('standard')
    expect(normalizeScoring('devy')).toBe('other')
    expect(normalizeScoring(null)).toBe('unknown')
    expect(normalizeSpecialty('bestball')).toBe('bestball')
    expect(normalizeSpecialty('draft_only')).toBe('draft_only')
    expect(normalizeSpecialty('standard')).toBe('standard')
    expect(normalizeSpecialty(null)).toBe('standard')
  })

  it('keeps the first source on a shared key, per user', () => {
    const imported = row({ key: 'sleeper:X:2024', source: 'import', wins: 10 })
    const legacy = row({ key: 'sleeper:X:2024', source: 'legacy', wins: 2 })
    const otherUser = row({ key: 'sleeper:X:2024', source: 'legacy', userId: 'u2' })
    const merged = mergeLedgerSources([imported], [legacy, otherUser])
    expect(merged).toHaveLength(2)
    expect(merged.find((r) => r.userId === 'u1')?.wins).toBe(10)
  })
})

describe('careerXp', () => {
  it('reproduces the writer arithmetic term by term', () => {
    const rows = [
      { season: 2023, wins: 10, losses: 4, madePlayoffs: true, wonChampionship: true, leagueSize: 14 },
      { season: 2023, wins: 5, losses: 9, madePlayoffs: false, wonChampionship: false, leagueSize: 10 },
      { season: 2024, wins: 8, losses: 6, madePlayoffs: true, wonChampionship: false, leagueSize: 12 },
    ]
    const xp = careerXp(rows)
    // 23 wins × 10 + 2 berths × 30 + 1 title × 200 + 2 years × 10 + (4×2 + 0 + 2×2)
    expect(xp.total).toBe(230 + 60 + 200 + 20 + 12)
    expect(xp.distinctSeasons).toBe(2)
    expect(xp.leagueSeasons).toBe(3)
    expect(xp.leagueSizeBonus).toBe(12)
  })
})

describe('filters', () => {
  it('drops anything off the whitelists', () => {
    const f = parseRankingFilters({
      platform: 'Sleeper',
      sport: 'nfl',
      type: 'dynasty',
      format: 'superflex',
      season: '2024',
      min: '10',
    })
    expect(f).toEqual({ platform: 'sleeper', sport: 'NFL', type: 'dynasty', format: 'superflex', season: 2024, minSample: 10 })
    const bad = parseRankingFilters({ platform: '<script>', type: 'weird', format: 'x', season: '1850', min: '7' })
    expect(bad).toEqual(DEFAULT_FILTERS)
  })

  it('round-trips through query params and leaves defaults out', () => {
    expect(filterParams(DEFAULT_FILTERS)).toEqual([])
    const f = parseRankingFilters({ platform: 'espn', min: '5' })
    expect(filterParams(f)).toEqual([
      ['platform', 'espn'],
      ['min', '5'],
    ])
    expect(parseRankingFilters(Object.fromEntries(filterParams(f)))).toEqual(f)
    expect(describeFilters(f)).toBe('ESPN')
    expect(describeFilters(DEFAULT_FILTERS)).toBe('All leagues')
  })

  it('matches type against league type or specialty, and format against flags', () => {
    const dynastyBestBall = row({ leagueType: 'dynasty', specialty: 'bestball', superflex: true, scoring: 'half' })
    expect(matchesFilters(dynastyBestBall, { ...DEFAULT_FILTERS, type: 'dynasty' })).toBe(true)
    expect(matchesFilters(dynastyBestBall, { ...DEFAULT_FILTERS, type: 'bestball' })).toBe(true)
    expect(matchesFilters(dynastyBestBall, { ...DEFAULT_FILTERS, type: 'redraft' })).toBe(false)
    expect(matchesFilters(dynastyBestBall, { ...DEFAULT_FILTERS, format: 'superflex' })).toBe(true)
    expect(matchesFilters(dynastyBestBall, { ...DEFAULT_FILTERS, format: 'half' })).toBe(true)
    expect(matchesFilters(dynastyBestBall, { ...DEFAULT_FILTERS, format: 'ppr' })).toBe(false)
    expect(matchesFilters(dynastyBestBall, { ...DEFAULT_FILTERS, format: 'te_premium' })).toBe(false)
  })

  it('only offers options that exist in the rows', () => {
    const opts = filterOptions([row({ platform: 'espn', season: 2022 }), row({ platform: 'espn' }), row()])
    expect(opts.platforms.map((p) => [p.value, p.count])).toEqual([
      ['espn', 2],
      ['sleeper', 1],
    ])
    expect(opts.seasons.map((s) => s.value)).toEqual([2024, 2022])
    expect(opts.types.map((t) => t.value)).toEqual(['redraft'])
  })
})

describe('scoreRows — the normalised score', () => {
  it('puts a perfectly average career at the middle of the scale', () => {
    // .500 record, one title per 12 league-seasons in 12-team leagues, 6 of 12 make it, half of the time.
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ wonChampionship: i === 0, madePlayoffs: i < 6, pointsFor: 1400 }),
    )
    const s = scoreRows(rows, buildScoringCohorts(rows))
    expect(s.score).toBeGreaterThan(45)
    expect(s.score).toBeLessThan(55)
    expect(s.totals.expectedTitles).toBeCloseTo(1, 5)
    expect(s.totals.expectedPlayoffs).toBeCloseTo(6, 5)
    expect(s.totals.scoringIndex).toBeCloseTo(100, 5)
  })

  it('credits a title in a bigger field more than one in a smaller field', () => {
    const cohorts = new Map()
    const big = scoreRows([row({ leagueSize: 14, wonChampionship: true, madePlayoffs: true })], cohorts)
    const small = scoreRows([row({ leagueSize: 8, wonChampionship: true, madePlayoffs: true })], cohorts)
    const titles = (s: typeof big) => s.components.find((c) => c.key === 'titles')?.credit ?? 0
    expect(titles(big)).toBeGreaterThan(titles(small))
  })

  it('judges berths against each league’s own cut', () => {
    const cohorts = new Map()
    const hardCut = scoreRows([row({ playoffTeams: 4, madePlayoffs: true })], cohorts)
    const easyCut = scoreRows([row({ playoffTeams: 8, madePlayoffs: true })], cohorts)
    expect(hardCut.totals.playoffRatio as number).toBeGreaterThan(easyCut.totals.playoffRatio as number)
  })

  it('counts win rate per game, so schedule length does not matter', () => {
    const cohorts = new Map()
    const short = scoreRows([row({ wins: 9, losses: 4 }), row({ wins: 9, losses: 4 })], cohorts)
    const long = scoreRows([row({ wins: 18, losses: 8 })], cohorts)
    expect(short.totals.winRate).toBeCloseTo(long.totals.winRate as number, 10)
  })

  it('shrinks a tiny sample toward .500', () => {
    const cohorts = new Map()
    const lucky = scoreRows([row({ wins: 3, losses: 0 })], cohorts)
    const proven = scoreRows(Array.from({ length: 10 }, () => row({ wins: 10, losses: 4 })), cohorts)
    expect(lucky.totals.winRate).toBe(1)
    expect(lucky.totals.adjWinRate as number).toBeLessThan(proven.totals.adjWinRate as number)
  })

  it('removes scoring-format inflation through the cohort index', () => {
    const ppr = Array.from({ length: SCORING_COHORT_MIN }, () => row({ scoring: 'ppr', pointsFor: 1600 }))
    const std = Array.from({ length: SCORING_COHORT_MIN }, () => row({ scoring: 'standard', pointsFor: 1100 }))
    const pprStar = row({ scoring: 'ppr', pointsFor: 1760, userId: 'star' })
    const stdStar = row({ scoring: 'standard', pointsFor: 1210, userId: 'star2' })
    const cohorts = buildScoringCohorts([...ppr, ...std, pprStar, stdStar])
    const a = scoreRows([pprStar], cohorts).totals.scoringIndex as number
    const b = scoreRows([stdStar], cohorts).totals.scoringIndex as number
    // Both are ~10% above their own format's average; raw points differ by 550.
    expect(Math.abs(a - b)).toBeLessThan(0.5)
  })

  it('leaves out a cohort that is too small to average', () => {
    const rows = Array.from({ length: SCORING_COHORT_MIN - 1 }, () => row())
    const s = scoreRows(rows, buildScoringCohorts(rows))
    expect(s.totals.scoringIndex).toBeNull()
    expect(s.components.find((c) => c.key === 'scoring')?.available).toBe(false)
    // The remaining weights renormalise to 1.
    const applied = s.components.reduce((sum, c) => sum + c.appliedWeight, 0)
    expect(applied).toBeCloseTo(1, 10)
  })

  it('never judges titles or berths on a season still in progress', () => {
    const s = scoreRows([row({ completed: false, madePlayoffs: true, wins: 2, losses: 0 })], new Map())
    expect(s.sample.completedSeasons).toBe(0)
    expect(s.totals.titleRatio).toBeNull()
    expect(s.totals.playoffRatio).toBeNull()
    expect(s.totals.winRate).toBe(1)
  })

  it('ignores draft-only and unplayed rows for results but still counts them as league-seasons', () => {
    const s = scoreRows(
      [row({ specialty: 'draft_only', wins: 0, losses: 0, gamesPlayed: 0 }), row({ wins: 0, losses: 0, gamesPlayed: 0, completed: false })],
      new Map(),
    )
    expect(s.score).toBeNull()
    expect(s.sample.leagueSeasons).toBe(2)
    expect(s.sample.resultSeasons).toBe(0)
  })

  it('computes prestige from ledger rows with years and league-seasons the right way round', () => {
    // 8 distinct years, 20 league-seasons: tenure 8/20, leagues capped at 15.
    const rows = Array.from({ length: 20 }, (_, i) => row({ season: 2017 + (i % 8) }))
    const s = scoreRows(rows, new Map())
    expect(s.sample.seasons).toBe(8)
    expect(s.sample.resultSeasons).toBe(20)
    // 0 titles, .5 win rate (0.2×0.5=10), tenure 8/20 (0.2×0.4=8), leagues 15/15 (15), 0 playoffs.
    expect(s.prestige).toBeCloseTo(33, 5)
  })
})

describe('boards', () => {
  const strong = Array.from({ length: 6 }, () => row({ userId: 'a', wins: 11, losses: 3, wonChampionship: true, madePlayoffs: true }))
  const weak = Array.from({ length: 6 }, () => row({ userId: 'b', wins: 4, losses: 10 }))
  const thin = [row({ userId: 'c', wins: 14, losses: 0, wonChampionship: true, madePlayoffs: true })]
  const all = [...strong, ...weak, ...thin]
  const cohorts = buildScoringCohorts(all)
  const entries = [entry('a', 'alpha', strong, cohorts), entry('b', 'bravo', weak, cohorts), entry('c', 'charlie', thin, cohorts)]

  it('keeps a manager under the sample floor off the board and says how many', () => {
    const board = rankBoard(entries, 'overall', DEFAULT_MIN_SAMPLE)
    expect(board.rows.map((r) => r.handle)).toEqual(['alpha', 'bravo'])
    expect(board.belowSample).toBe(1)
    const loose = rankBoard(entries, 'overall', 1)
    expect(loose.rows).toHaveLength(3)
  })

  it('shares a rank on a tie and orders the tie by handle', () => {
    const twin = entry('d', 'aaron', strong, cohorts)
    const board = rankBoard([...entries, twin], 'overall', DEFAULT_MIN_SAMPLE)
    expect(board.rows.slice(0, 2).map((r) => [r.handle, r.rank])).toEqual([
      ['aaron', 1],
      ['alpha', 1],
    ])
    expect(board.rows[2].rank).toBe(3)
  })

  it('renders an unavailable board empty rather than inventing rows', () => {
    expect(rankBoard(entries, 'drafters', 1).rows).toEqual([])
    expect(rankBoard(entries, 'active', 1).rows).toEqual([])
  })

  it('accepts the pre-normalisation board name', () => {
    expect(parseBoard('top')).toBe('overall')
    expect(parseBoard('nonsense')).toBe('overall')
    expect(parseBoard('titles')).toBe('titles')
  })

  it('re-orders for display without renumbering, and sorts missing values last both ways', () => {
    const board = rankBoard(entries, 'overall', 1)
    const withMove = board.rows.map((r, i) => ({ ...r, movement: i === 0 ? null : i }))
    const asc = sortBoardRows(withMove, 'move', 'asc')
    const desc = sortBoardRows(withMove, 'move', 'desc')
    expect(asc[asc.length - 1].movement).toBeNull()
    expect(desc[desc.length - 1].movement).toBeNull()
    const byName = sortBoardRows(withMove, 'manager', 'desc')
    expect(byName.map((r) => r.handle)).toEqual(['charlie', 'bravo', 'alpha'])
    expect(byName.find((r) => r.handle === 'alpha')?.rank).toBe(board.rows.find((r) => r.handle === 'alpha')?.rank)
  })

  it('defaults sort direction by column', () => {
    expect(parseSort(null, null)).toEqual({ sort: 'rank', dir: 'asc' })
    expect(parseSort('winRate', null)).toEqual({ sort: 'winRate', dir: 'desc' })
    expect(parseSort('winRate', 'asc')).toEqual({ sort: 'winRate', dir: 'asc' })
    expect(parseSort('drop table', 'sideways')).toEqual({ sort: 'rank', dir: 'asc' })
  })
})

describe('movement and trends', () => {
  it('reports places climbed, and unknown when either side is missing', () => {
    const snap = { date: '2026-09-09', population: 3, rows: [{ u: 'a', r: 3, s: 40 }] }
    expect(movementSince('a', 1, snap)).toBe(2)
    expect(movementSince('a', 4, snap)).toBe(-1)
    expect(movementSince('z', 1, snap)).toBeNull()
    expect(movementSince('a', null, snap)).toBeNull()
    expect(movementSince('a', 1, null)).toBeNull()
  })

  it('builds a season line and a cumulative career line', () => {
    const rows = [row({ season: 2022, wins: 4, losses: 10 }), row({ season: 2023, wins: 12, losses: 2, wonChampionship: true, madePlayoffs: true })]
    const trend = seasonTrend(rows, new Map())
    expect(trend.map((t) => t.season)).toEqual([2022, 2023])
    expect((trend[1].seasonScore as number) > (trend[0].seasonScore as number)).toBe(true)
    // Career through 2023 sits between the two single seasons.
    expect(trend[1].careerScore as number).toBeLessThan(trend[1].seasonScore as number)
    expect(trend[1].careerScore as number).toBeGreaterThan(trend[0].seasonScore as number)
    expect(trend[0].record).toBe('4-10')
  })
})

describe('calendar', () => {
  it('uses the Eastern date, not the UTC one', () => {
    // 02:30 UTC on the 15th is still the 14th in New York.
    expect(easternDateKey(new Date('2026-09-15T02:30:00Z'))).toBe('2026-09-14')
    expect(easternDateKey(new Date('2026-09-15T12:00:00Z'))).toBe('2026-09-15')
  })

  it('opens the fantasy week on Tuesday', () => {
    expect(fantasyWeekStartKey('2026-09-15')).toBe('2026-09-15') // Tuesday
    expect(fantasyWeekStartKey('2026-09-14')).toBe('2026-09-08') // Monday night is last week
    expect(fantasyWeekStartKey('2026-09-20')).toBe('2026-09-15') // Sunday
  })

  it('shifts across month ends', () => {
    expect(shiftDateKey('2026-09-02', -7)).toBe('2026-08-26')
    expect(shiftDateKey('2026-12-30', 3)).toBe('2027-01-02')
  })
})
