/**
 * Soccer weekly scoring: Rolling Insights box lines -> engine categories -> points, with the league's panel.
 *
 * There is no committed soccer fixture (contracts GAPS.md G-04), so the lines below copy the shape of the
 * rows production stores in `player_game_stats.normalized_stat_map` — read 2026-09-28, 4,159 rows:
 * `{ group: 'fielders' | 'goalkeepers', position, stats: { goals, assists, clean_sheets, … } }`.
 *
 * 🛑 A clean sheet needs 60 minutes (the vendor flags a 90th-minute substitute too), a keeper's clean
 * sheet is not a defender's, and a midfielder gets none — the feed carries no flag for him.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { normalizeSoccerGameStats, SOCCER_CLEAN_SHEET_MIN_MINUTES } from '@/lib/scoring-runtime/soccerStatNormalization'
import { aggregateWeeklyStats, getDailySportNormalizer, isDailyStatSport } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { bridgeSportUiScoringStore } from '@/lib/redraft/uiScoringStoreBridge'
import { scoreStatsWithCategories } from '@/lib/redraft/scoringEngine'
import { getScoringCategories } from '@/lib/sportConfig'
import { buildFullSoccerScoringConfig } from '@/lib/soccer-scoring/SoccerScoringPresets'
import { soccerAdapter } from '@/lib/redraft/sportAdapters/soccer'

const FIELDER_ZEROES = {
  goals: 0, assists: 0, player_id: 41, red_cards: 0, fouls_drawn: 0, yellow_cards: 0, shots_on_goal: 0,
  free_kicks_won: 0, minutes_played: 90, fouls_committed: 0, shots_attempted: 0, penalties_scored: 0, penalty_attempts: 0,
}
const fielder = (position: string, stats: Record<string, number>) => ({
  group: 'fielders', position, positionCategory: null, scored: false, status: null,
  stats: { ...FIELDER_ZEROES, ...stats },
})
const keeper = (stats: Record<string, number>) => ({
  group: 'goalkeepers', position: 'Goalkeeper', positionCategory: null, scored: false, status: null,
  stats: { ...FIELDER_ZEROES, clean_sheets: 0, saves: 0, goals_conceded: 0, penalties_faced: 0, penalties_saved: 0, ...stats },
})
const ENGINE_KEYS = new Set(getScoringCategories('SOCCER').map((c) => c.key))

describe('normalizeSoccerGameStats', () => {
  it('maps a striker’s line onto engine keys', () => {
    const { stats, unmappedKeys } = normalizeSoccerGameStats(
      fielder('Forward', { goals: 2, assists: 1, shots_attempted: 5, shots_on_goal: 3, yellow_cards: 1, penalty_attempts: 1, penalties_scored: 1, minutes_played: 84 }),
    )
    expect(unmappedKeys).toEqual([])
    expect(stats).toMatchObject({ goals: 2, assists: 1, shots: 5, shots_on_target: 3, yellow_card: 1, minutes_played: 84, appearance: 1, pen_miss: 0 })
    expect(stats).not.toHaveProperty('clean_sheet_def')
  })

  it('every key it emits is an engine category', () => {
    const lines = [
      fielder('Forward', { goals: 1 }),
      fielder('Defender', { clean_sheets: 1 }),
      keeper({ clean_sheets: 1, saves: 4, penalties_saved: 1 }),
    ]
    const emitted = new Set(lines.flatMap((l) => Object.keys(normalizeSoccerGameStats(l).stats)))
    expect([...emitted].filter((k) => !ENGINE_KEYS.has(k))).toEqual([])
  })

  it('a missed penalty is attempts minus scored — a scored penalty is already a goal', () => {
    const { stats } = normalizeSoccerGameStats(fielder('Forward', { goals: 1, penalty_attempts: 2, penalties_scored: 1 }))
    expect(stats.pen_miss).toBe(1)
    expect(stats.goals).toBe(1)
    expect(stats).not.toHaveProperty('penalties_scored')
  })

  describe('clean sheets', () => {
    it(`a defender who played ${SOCCER_CLEAN_SHEET_MIN_MINUTES}+ minutes keeps it`, () => {
      expect(normalizeSoccerGameStats(fielder('Defender', { clean_sheets: 1, minutes_played: 60 })).stats.clean_sheet_def).toBe(1)
    })

    it('a defender subbed on late does not, though the vendor flags him', () => {
      expect(normalizeSoccerGameStats(fielder('Defender', { clean_sheets: 1, minutes_played: 12 })).stats.clean_sheet_def).toBe(0)
    })

    it('a keeper’s clean sheet lands on the keeper key, never the defender one', () => {
      const { stats } = normalizeSoccerGameStats(keeper({ clean_sheets: 1 }))
      expect(stats.clean_sheet_gk).toBe(1)
      expect(stats).not.toHaveProperty('clean_sheet_def')
    })

    it('a midfielder gets none — the feed carries no flag for him', () => {
      const { stats } = normalizeSoccerGameStats(fielder('Midfielder', { minutes_played: 90 }))
      expect(stats).not.toHaveProperty('clean_sheet_def')
      expect(stats).not.toHaveProperty('clean_sheet_gk')
    })
  })

  it('keeper-only fields score only for a keeper', () => {
    const k = normalizeSoccerGameStats(keeper({ saves: 5, penalties_saved: 1, goals_conceded: 2 })).stats
    expect(k).toMatchObject({ saves: 5, pen_save: 1, gk_goals_against: 2 })
    const f = normalizeSoccerGameStats(fielder('Defender', { saves: 3 }))
    expect(f.stats).not.toHaveProperty('saves')
    expect(f.unmappedKeys).toEqual(['fielders.saves'])
  })

  it('an unused substitute (0 minutes) is not an appearance', () => {
    expect(normalizeSoccerGameStats(fielder('Forward', { minutes_played: 0 })).stats.appearance).toBe(0)
  })

  it('never emits an own goal — no line says whose it was', () => {
    const { stats } = normalizeSoccerGameStats(keeper({ goals_conceded: 3 }))
    expect(stats).not.toHaveProperty('own_goal')
  })

  it('a line without a group is refused, not guessed', () => {
    expect(normalizeSoccerGameStats({ stats: { goals: 1 } })).toEqual({ stats: {}, unmappedKeys: ['group:(missing)'] })
    expect(normalizeSoccerGameStats({ group: 'bench', stats: { goals: 1 } }).stats).toEqual({})
  })

  it('a renamed vendor field is reported, not dropped silently', () => {
    expect(normalizeSoccerGameStats(fielder('Forward', { expected_goals: 0.4 })).unmappedKeys).toEqual(['fielders.expected_goals'])
  })
})

describe('the weekly pipeline', () => {
  it('SOCCER is a daily-stat sport with this normalizer', () => {
    expect(isDailyStatSport('SOCCER')).toBe(true)
    expect(getDailySportNormalizer('soccer')).toBe(normalizeSoccerGameStats)
  })

  it('a double gameweek sums both games', () => {
    const week = aggregateWeeklyStats(
      [fielder('Forward', { goals: 1, minutes_played: 90 }), fielder('Forward', { goals: 2, minutes_played: 70 })],
      normalizeSoccerGameStats,
    )
    expect(week.stats).toMatchObject({ goals: 3, appearance: 2, minutes_played: 160 })
    expect(week.gamesCounted).toBe(2)
  })

  it('the adapter passes every new key through', () => {
    const parsed = soccerAdapter.parseRawStats({ shots_on_target: 2, shots: 4, minutes_played: 90, appearance: 1, gk_goals_against: 1, fouls_committed: 2, fouls_drawn: 3 })
    expect(parsed).toMatchObject({ shots_on_target: 2, shots: 4, minutes_played: 90, appearance: 1, gk_goals_against: 1, fouls_committed: 2, fouls_drawn: 3 })
  })
})

describe('scoring with the league’s panel', () => {
  const categories = getScoringCategories('SOCCER')

  it('an unsaved league scores the AF default its panel shows', () => {
    const overrides = bridgeSportUiScoringStore('SOCCER', {})!
    const af = buildFullSoccerScoringConfig('af_default')
    expect(overrides).toMatchObject({ goals: af.goal, shots_on_target: af.shot_on_target, shots: af.shot, minutes_played: af.minutes_played, gk_goals_against: af.gk_goals_against })
  })

  it('a full 90 for a scoring striker, on AF default', () => {
    const { stats } = normalizeSoccerGameStats(
      fielder('Forward', { goals: 1, assists: 1, shots_attempted: 4, shots_on_goal: 2, minutes_played: 90, yellow_cards: 1 }),
    )
    const pts = scoreStatsWithCategories(categories, stats, bridgeSportUiScoringStore('SOCCER', {})!)
    // goal 6 + assist 3 + 2 on target x0.5 + 4 shots x0.2 + 90 min x0.02 + yellow -1
    expect(pts).toBeCloseTo(6 + 3 + 1 + 0.8 + 1.8 - 1, 6)
  })

  it('a keeper’s clean sheet, saves and goals against, on AF default', () => {
    const cs = normalizeSoccerGameStats(keeper({ clean_sheets: 1, saves: 4, minutes_played: 90 })).stats
    const leaky = normalizeSoccerGameStats(keeper({ saves: 2, goals_conceded: 3, minutes_played: 90 })).stats
    const overrides = bridgeSportUiScoringStore('SOCCER', {})!
    // clean sheet 4 + 4 saves x0.5 + 90 min x0.02
    expect(scoreStatsWithCategories(categories, cs, overrides)).toBeCloseTo(4 + 2 + 1.8, 6)
    // 2 saves x0.5 + 3 against x-1 + 90 min x0.02
    expect(scoreStatsWithCategories(categories, leaky, overrides)).toBeCloseTo(1 - 3 + 1.8, 6)
  })
})
