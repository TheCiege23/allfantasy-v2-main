import { describe, expect, it } from 'vitest'

import {
  buildNcaabDraftSeasonLine,
  buildNcaabLeagueScorer,
  ncaabSeasonLabel,
  pickNcaabDraftBox,
} from '@/lib/draft-room/ncaabDraftSeason'
import { getDraftStatColumnsForSport, getStatValueForDraftPlayer, type DraftStatPlayerSource } from '@/lib/draft-room/draftSportStatColumns'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { indexNcaabSeasonBoxes } from '@/lib/sport-teams/ncaabSeasonBoxes'

/**
 * College basketball had no stats, no projection and no ranking in the draft room (production,
 * 2026-11-25): every column a dash, the board and autopick alphabetical. These pin the line built
 * from our own box scores and that it reaches the columns a manager actually sees.
 */

const RATES = {
  points: 18.44, total_rebounds: 7.25, assists: 3.06, steals: 1.5, blocks: 0.75, minutes: 31.2,
  turnovers: 2, fouls: 2.5, three_points_made: 2.04, three_points_attempted: 5,
  field_goals_made: 6.5, field_goals_attempted: 13, free_throws_made: 3, free_throws_attempted: 4,
  two_points_made: 4.5, two_points_attempted: 8, defensive_rebounds: 5, offensive_rebounds: 2.25,
}
const league = { sport: 'NCAAB', settings: {} }

describe('indexNcaabSeasonBoxes', () => {
  const row = (id: string, season: number, games: number) => ({ id, season, games, rates: { points: 10 } })

  it('files each player under the newest season and the one before it', () => {
    const boxes = indexNcaabSeasonBoxes([row('1', 2026, 6), row('1', 2025, 30), row('2', 2025, 28), row('3', 2024, 12)], 2026)
    expect(boxes.season).toBe(2026)
    expect(boxes.byRiId.get('1')).toMatchObject({ current: { season: 2026, games: 6 }, previous: { season: 2025, games: 30 } })
    expect(boxes.byRiId.get('2')?.current).toBeUndefined()
    expect(boxes.byRiId.get('2')?.previous?.games).toBe(28)
    // Two seasons back is nobody's line.
    expect(boxes.byRiId.has('3')).toBe(false)
  })

  it('does not mistake last season for this one when the new season has no finished game yet', () => {
    // The store's newest season is 2026, but every row that passed the "finished game" filter is 2025.
    const boxes = indexNcaabSeasonBoxes([row('1', 2025, 30)], 2026)
    expect(boxes.byRiId.get('1')?.current).toBeUndefined()
    expect(boxes.byRiId.get('1')?.previous?.season).toBe(2025)
    // Control: without the store's season, the same rows WOULD read as the current season.
    expect(indexNcaabSeasonBoxes([row('1', 2025, 30)]).byRiId.get('1')?.current?.season).toBe(2025)
  })

  it('drops rows with no id, no games or no rates', () => {
    const boxes = indexNcaabSeasonBoxes([row(' ', 2026, 5), row('4', 2026, 0), { id: '5', season: 2026, games: 3, rates: null }], 2026)
    expect(boxes.byRiId.size).toBe(0)
  })
})

describe('pickNcaabDraftBox', () => {
  const current = { season: 2026, games: 4, rates: RATES }
  const previous = { season: 2025, games: 31, rates: RATES }

  it('shows this season once he has played in it, otherwise last season', () => {
    expect(pickNcaabDraftBox({ current, previous })).toBe(current)
    expect(pickNcaabDraftBox({ previous })).toBe(previous)
    expect(pickNcaabDraftBox({})).toBeNull()
    expect(pickNcaabDraftBox(undefined)).toBeNull()
  })
})

describe('buildNcaabDraftSeasonLine', () => {
  it('carries per-game rates, shooting from makes over attempts, games and the season label', () => {
    const line = buildNcaabDraftSeasonLine({ season: 2026, games: 6, rates: RATES }, 'F', null)
    expect(line.nbaDraftStats).toEqual({
      gamesPlayed: 6,
      pointsPerGame: 18.4,
      reboundsPerGame: 7.3,
      minutesPerGame: 31.2,
      assistsPerGame: 3.1,
      stealsPerGame: 1.5,
      blocksPerGame: 0.8,
      threePointersMadePerGame: 2,
      fieldGoalPercentage: 0.5,
      freeThrowPercentage: 0.75,
    })
    expect(line.statSeason).toBe('2026–27')
    // No league scoring to apply: the points column stays empty rather than showing a guess.
    expect(line.projectedPointsPerGame).toBeNull()
  })

  it('leaves a percentage empty with no attempts, never 0%', () => {
    const line = buildNcaabDraftSeasonLine({ season: 2026, games: 2, rates: { points: 4, free_throws_made: 0, free_throws_attempted: 0 } }, 'G', null)
    expect(line.nbaDraftStats.freeThrowPercentage).toBeNull()
    expect(line.nbaDraftStats.fieldGoalPercentage).toBeNull()
  })

  it('tags a line from before the newest season as last season’s, so the room can say so', () => {
    const lastSeason = { season: 2025, games: 31, rates: RATES }
    expect(buildNcaabDraftSeasonLine(lastSeason, 'F', null, 2026)).toMatchObject({ statSeason: '2025–26', statSeasonIsPrevious: true })
    expect(buildNcaabDraftSeasonLine({ ...lastSeason, season: 2026 }, 'F', null, 2026).statSeasonIsPrevious).toBe(false)
    // Reaches the entry the room renders.
    const line = buildNcaabDraftSeasonLine(lastSeason, 'F', null, 2026)
    const entry = normalizeDraftPlayer(
      { name: 'Returning Forward', position: 'F', team: 'DUKE', playerId: '1', nbaDraftStats: line.nbaDraftStats, statSeason: line.statSeason, statSeasonIsPrevious: line.statSeasonIsPrevious },
      'NCAAB',
    )
    expect(entry.display.stats).toMatchObject({ seasonLabel: '2025–26', seasonIsPrevious: true })
  })

  it('labels a season across the century boundary', () => {
    expect(ncaabSeasonLabel(2026)).toBe('2026–27')
    expect(ncaabSeasonLabel(2099)).toBe('2099–00')
  })
})

describe('buildNcaabLeagueScorer', () => {
  it('scores a per-game line exactly as the league scorer scores its normalized stats', () => {
    const scorer = buildNcaabLeagueScorer(league)
    expect(scorer).not.toBeNull()

    const doubleDouble = { ...RATES, points: 12, total_rebounds: 11 }
    const { stats } = getDailySportNormalizer('NCAAB')!(doubleDouble)
    const score = buildLeagueStatScorer({ sport: 'NCAAB', settings: {} } as Parameters<typeof buildLeagueStatScorer>[0])!
    const expected = Math.round(score({ ...stats }, 'F') * 100) / 100

    expect(expected).toBeGreaterThan(0)
    expect(scorer!(doubleDouble, 'F')).toBe(expected)
    // An average is never a double-double: no bonus key reaches the scorer.
    expect(stats.dbl_dbl).toBeUndefined()
    expect(stats.trpl_dbl).toBeUndefined()
  })

  it('ranks the more productive line higher, and returns null for an empty one', () => {
    const scorer = buildNcaabLeagueScorer(league)!
    expect(scorer({ ...RATES, points: 25 }, 'G')!).toBeGreaterThan(scorer(RATES, 'G')!)
    expect(scorer({}, 'G')).toBeNull()
  })

  it('has no scorer without a league', () => {
    expect(buildNcaabLeagueScorer(null)).toBeNull()
  })
})

describe('the line reaches the college basketball columns', () => {
  it('fills PPG / RPG / MPG / APG / SPG / BPG / 3PM / FG% / FT% / GP and the league points column', () => {
    const scorer = buildNcaabLeagueScorer(league)
    const line = buildNcaabDraftSeasonLine({ season: 2026, games: 6, rates: RATES }, 'F', scorer)
    expect(line.projectedPointsPerGame).toBeGreaterThan(0)

    const entry = normalizeDraftPlayer(
      { name: 'Test Forward', position: 'F', team: 'DUKE', playerId: '15170', nbaDraftStats: line.nbaDraftStats, statSeason: line.statSeason, afProjectionPerGame: line.projectedPointsPerGame },
      'NCAAB',
    )
    const columns = getDraftStatColumnsForSport('NCAAB')
    const values = Object.fromEntries(columns.map((c) => [c.key, getStatValueForDraftPlayer(entry as unknown as DraftStatPlayerSource, c)]))
    expect(values).toMatchObject({ pts: 18.4, reb: 7.3, mpg: 31.2, ast: 3.1, stl: 1.5, blk: 0.8, fg3m: 2, fg_pct: 0.5, ft_pct: 0.75, gp: 6 })
    expect(values.ncaab_proj).toBe(line.projectedPointsPerGame)
    expect(columns.find((c) => c.key === 'ncaab_proj')?.label).toBe('Proj/G')
    expect(entry.display.stats.seasonLabel).toBe('2026–27')
    // No column is left without a value for a player who has a line.
    expect(Object.values(values).every((v) => typeof v === 'number')).toBe(true)
  })

  it('control: the same stats on an NBA-less sport key do not leak into another sport', () => {
    const line = buildNcaabDraftSeasonLine({ season: 2026, games: 6, rates: RATES }, 'F', null)
    const entry = normalizeDraftPlayer({ name: 'Test Skater', position: 'C', team: 'BOS', playerId: '1', nbaDraftStats: line.nbaDraftStats }, 'NHL')
    expect((entry.display.stats as Record<string, unknown>).pointsPerGame).toBeUndefined()
  })
})
