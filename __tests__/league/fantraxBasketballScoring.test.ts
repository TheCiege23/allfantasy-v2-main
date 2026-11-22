// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFantraxBasketballScoring, scoreFantraxBasketballGame } from '@/lib/league/collegePro/fantraxBasketballScoring'

const settingsWith = (player: Record<string, string>) => ({
  fantrax_settings: { scoringSystem: { type: 'HEAD_TO_HEAD_POINTS_BASED', scoringCategories: { PLAYER: Object.fromEntries(Object.entries(player).map(([k, v]) => [k, { Default: v }])) } } },
})

/** Road To Glory NCAA Basketball's categories, as stored in production 2026-11-22. */
const NCAAB = settingsWith({
  W: 'points1', '2D': 'points2', '3D': 'points4', '4D': 'points6', EJ: 'points-3', PF: 'points-1', ST: 'points2', TF: 'points-2',
  TO: 'points-1', AST: 'points1', BLK: 'points2', 'FT-': 'points-1', FTM: 'points1', MIN: 'points0.1', PTS: 'points1', REB: 'points1',
  '3PTM': 'points0.5', GWBB: 'points10',
})

/** Road To Glory NBA's categories, as stored in production 2026-11-22 (no long-form list on this league). */
const NBA = settingsWith({
  L: 'points-1', W: 'points1', '2D': 'points2', '3D': 'points5', '4D': 'points10', EJ: 'points-3', FF: 'points-3', PF: 'points-1',
  ST: 'points1', TF: 'points-2', TO: 'points-1', AST: 'points1', BLK: 'points1', 'FT-': 'points-1', FTM: 'points1', PFD: 'points1',
  PTS: 'points1', REB: 'points1', '2PT-': 'points-1', '2PTM': 'points2', '3PT-': 'points-1', '3PTM': 'points3', GWBB: 'points10',
})

/** A real NCAAB Rolling Insights line from 2026-11-22 (`normalized_stat_map.stats`). */
const SINGLETON = {
  fouls: 0, blocks: 0, points: 26, steals: 0, assists: 2, minutes: 36, turnovers: 0, total_rebounds: 1, two_points_made: 1,
  field_goals_made: 7, free_throws_made: 6, three_points_made: 6, defensive_rebounds: 1, offensive_rebounds: 0,
  two_points_attempted: 2, field_goals_attempted: 16, free_throws_attempted: 7, three_points_attempted: 14,
}

describe('Fantrax basketball scoring', () => {
  it("scores a college line with the league's free throws, minutes and threes, which the shared scorer drops", () => {
    const scoring = readFantraxBasketballScoring(NCAAB)!
    // 26 pts + 1 reb + 2 ast + 6 FTM − 1 FT missed + 3.6 min + 3 (six threes at 0.5); no double-double.
    expect(scoreFantraxBasketballGame(SINGLETON, scoring)).toBeCloseTo(40.6, 5)
  })

  it('names what the league scores that a box line cannot show', () => {
    expect(readFantraxBasketballScoring(NCAAB)!.unscored).toEqual(['wins', 'ejections', 'technical fouls', 'buzzer-beaters'])
    expect(readFantraxBasketballScoring(NBA)!.unscored).toEqual(['losses', 'wins', 'ejections', 'flagrant fouls', 'technical fouls', 'fouls drawn', 'buzzer-beaters'])
  })

  it('counts a triple-double as a double-double too, per game', () => {
    const scoring = readFantraxBasketballScoring(NCAAB)!
    const line = { points: 20, total_rebounds: 11, assists: 10 }
    // 20 + 11 + 10 = 41, + 2 (double-double) + 4 (triple-double).
    expect(scoreFantraxBasketballGame(line, scoring)).toBe(47)
  })

  it("scores the NBA league's made and missed shots on top of points, as Fantrax does", () => {
    const scoring = readFantraxBasketballScoring(NBA)!
    const line = { points: 13, total_rebounds: 3, assists: 0, steals: 1, blocks: 1, turnovers: 3, fouls: 2,
      free_throws_made: 3, free_throws_attempted: 4, two_points_made: 2, two_points_attempted: 7, three_points_made: 2, three_points_attempted: 3 }
    // 13 + 3 + 0 + 1 + 1 − 3 − 2 + 3 − 1 + 4 − 5 + 6 − 1 = 19
    expect(scoreFantraxBasketballGame(line, scoring)).toBe(19)
  })

  it('returns null for a league without Fantrax points scoring, so callers keep the defaults', () => {
    expect(readFantraxBasketballScoring(null)).toBeNull()
    expect(readFantraxBasketballScoring({ fantrax_settings: { scoringSystem: { type: 'ROTISSERIE', scoringCategories: { PLAYER: { PTS: { Default: 'points1' } } } } } })).toBeNull()
  })
})
