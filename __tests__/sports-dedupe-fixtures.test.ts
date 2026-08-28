import { describe, expect, it } from 'vitest'
import { dedupeFixtures, sameTeam } from '@/lib/sports/dedupeFixtures'

/**
 * Built from the ACTUAL production rows for one night of NFL preseason, read
 * out of `SportsGame`. Four providers, four spellings, four disagreeing scores.
 */
const KICKOFF_1 = new Date('2026-08-28T03:00:00.000Z')
const KICKOFF_2 = new Date('2026-08-28T04:00:00.000Z')

const PIT_BUF = [
  { sport: 'NFL', source: 'espn', awayTeam: 'Pittsburgh Steelers', homeTeam: 'Buffalo Bills', awayScore: 27, homeScore: 28, status: 'final', startTime: KICKOFF_1, fetchedAt: new Date('2026-08-28T07:00:05.508Z') },
  { sport: 'NFL', source: 'thesportsdb', awayTeam: 'Pittsburgh Steelers', homeTeam: 'Buffalo Bills', awayScore: 27, homeScore: 28, status: 'final', startTime: KICKOFF_1, fetchedAt: new Date('2026-08-28T07:00:05.434Z') },
  { sport: 'NFL', source: 'rolling_insights', awayTeam: 'Pittsburgh Steelers', homeTeam: 'Buffalo Bills', awayScore: null, homeScore: null, status: 'final', startTime: KICKOFF_1, fetchedAt: new Date('2026-08-28T07:00:05.400Z') },
  { sport: 'NFL', source: 'espn_live', awayTeam: 'PIT', homeTeam: 'BUF', awayScore: 14, homeScore: 10, status: 'in_progress', startTime: KICKOFF_1, fetchedAt: new Date('2026-08-28T04:17:23.756Z') },
]

describe('sameTeam', () => {
  /* Truncated single-word cities: Pittsburgh -> PIT, Cleveland -> CLE. */
  it.each([
    ['PIT', 'Pittsburgh Steelers'],
    ['BUF', 'Buffalo Bills'],
    ['CLE', 'Cleveland Browns'],
  ])('matches the truncated abbreviation %s', (abbrev, full) => {
    expect(sameTeam(abbrev, full)).toBe(true)
  })

  /* Initialised multi-word cities: New England -> NE, Las Vegas -> LV. */
  it.each([
    ['NE', 'New England Patriots'],
    ['SF', 'San Francisco 49ers'],
    ['LV', 'Las Vegas Raiders'],
    ['LAR', 'Los Angeles Rams'],
    ['LAC', 'Los Angeles Chargers'],
  ])('matches the initialised abbreviation %s', (abbrev, full) => {
    expect(sameTeam(abbrev, full)).toBe(true)
  })

  /*
   * ⚠ THE TWO LOS ANGELES TEAMS MUST NOT COLLAPSE INTO EACH OTHER. They share a
   * city and a kickoff slot, so a sloppy prefix rule would merge a real fixture.
   */
  it('keeps distinct teams distinct', () => {
    expect(sameTeam('LAR', 'Los Angeles Chargers')).toBe(false)
    expect(sameTeam('Los Angeles Rams', 'Los Angeles Chargers')).toBe(false)
    expect(sameTeam('NE', 'New Orleans Saints')).toBe(false)
    expect(sameTeam('Buffalo Bills', 'Pittsburgh Steelers')).toBe(false)
  })

  it('is safe on missing values', () => {
    expect(sameTeam(null, 'PIT')).toBe(false)
    expect(sameTeam('', '')).toBe(false)
  })
})

describe('dedupeFixtures', () => {
  it('collapses four provider rows into one fixture', () => {
    expect(dedupeFixtures(PIT_BUF)).toHaveLength(1)
  })

  /*
   * ⚠ FRESHNESS DECIDES, AND IT IS NOT A TIE-BREAK. The stale row was not just
   * older, it was WRONG: espn_live froze at 14-10 in_progress when the poller
   * stopped, three hours before every other source agreed on 27-28 final.
   */
  it('believes the most recently fetched row, not the one with a score', () => {
    const [game] = dedupeFixtures(PIT_BUF)
    expect(game.awayScore).toBe(27)
    expect(game.homeScore).toBe(28)
    expect(game.status).toBe('final')
    expect(game.source).toBe('espn')
  })

  /* Equal freshness: a row with numbers beats a row of nulls. */
  it('prefers a scored row when two are equally fresh', () => {
    const t = new Date('2026-08-28T07:00:00.000Z')
    const out = dedupeFixtures([
      { sport: 'NFL', source: 'a', awayTeam: 'Pittsburgh Steelers', homeTeam: 'Buffalo Bills', awayScore: null, homeScore: null, startTime: KICKOFF_1, fetchedAt: t },
      { sport: 'NFL', source: 'b', awayTeam: 'PIT', homeTeam: 'BUF', awayScore: 27, homeScore: 28, startTime: KICKOFF_1, fetchedAt: t },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('b')
  })

  /*
   * ⚠ KICKOFF ALONE IS NOT A FIXTURE. Two different games started at 04:00Z
   * that night, so grouping on sport+startTime would merge unrelated teams.
   */
  it('keeps different games that share a kickoff time', () => {
    const out = dedupeFixtures([
      { sport: 'NFL', source: 'espn', awayTeam: 'New England Patriots', homeTeam: 'Cleveland Browns', awayScore: 13, homeScore: 37, startTime: KICKOFF_2, fetchedAt: new Date('2026-08-28T07:00:00Z') },
      { sport: 'NFL', source: 'espn_live', awayTeam: 'NE', homeTeam: 'CLE', awayScore: 0, homeScore: 7, startTime: KICKOFF_2, fetchedAt: new Date('2026-08-28T04:17:00Z') },
      { sport: 'NFL', source: 'espn', awayTeam: 'San Francisco 49ers', homeTeam: 'Las Vegas Raiders', awayScore: 18, homeScore: 12, startTime: KICKOFF_2, fetchedAt: new Date('2026-08-28T07:00:00Z') },
      { sport: 'NFL', source: 'espn_live', awayTeam: 'SF', homeTeam: 'LV', awayScore: 0, homeScore: 3, startTime: KICKOFF_2, fetchedAt: new Date('2026-08-28T04:17:00Z') },
    ])

    expect(out).toHaveLength(2)
    expect(out.map((g) => g.awayScore).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([13, 18])
  })

  /* Different sports never merge, even at the same instant. */
  it('never merges across sports', () => {
    const out = dedupeFixtures([
      { sport: 'NFL', awayTeam: 'PIT', homeTeam: 'BUF', startTime: KICKOFF_1, fetchedAt: KICKOFF_1 },
      { sport: 'NCAAF', awayTeam: 'PIT', homeTeam: 'BUF', startTime: KICKOFF_1, fetchedAt: KICKOFF_1 },
    ])
    expect(out).toHaveLength(2)
  })

  it('preserves the caller ordering', () => {
    const out = dedupeFixtures([
      { sport: 'NFL', awayTeam: 'PIT', homeTeam: 'BUF', startTime: KICKOFF_1, fetchedAt: KICKOFF_1 },
      { sport: 'NFL', awayTeam: 'NE', homeTeam: 'CLE', startTime: KICKOFF_2, fetchedAt: KICKOFF_1 },
    ])
    expect(out.map((g) => g.awayTeam)).toEqual(['PIT', 'NE'])
  })

  it('handles an empty list', () => {
    expect(dedupeFixtures([])).toEqual([])
  })
})
