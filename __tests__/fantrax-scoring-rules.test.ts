import { describe, expect, it } from 'vitest'

import { fantraxScoringMode, fantraxScoringRules } from '@/lib/league-import/fantrax/fantraxScoring'
import type { FantraxLeagueInfo } from '@/lib/league-import/fantrax/fantraxApi'
import { FantraxLeagueMapper } from '@/lib/league-import/adapters/fantrax/FantraxLeagueMapper'
import { FantraxScoringMapper } from '@/lib/league-import/adapters/fantrax/FantraxScoringMapper'
import type { FantraxImportPayload } from '@/lib/league-import/adapters/fantrax/types'
import nbaFixture from './fixtures/fantrax-nba-points-scoring.json'
import { NBA_CONFIG } from '@/lib/sportConfig/configs/nba'

/**
 * Captured live from a real league 2026-08-27. The shape matters more than the
 * numbers: `scoringCategorySettings[].configs[]` is the authoritative list, and
 * the sibling `scoringCategories` object is a trap (see below).
 */
function info(configs: unknown[]): FantraxLeagueInfo {
  return {
    leagueName: 'Cream Bowl',
    seasonYear: 2026,
    draftType: null,
    ppr: null,
    startDate: null,
    endDate: null,
    teamInfo: {},
    playerInfo: {},
    rosterInfo: {},
    scoringSystem: { scoringCategorySettings: [{ configs }] } as unknown as Record<string, unknown>,
  } as FantraxLeagueInfo
}

const DEFAULT = { shortName: 'Default', code: 'DEFAULT' }
const cat = (code: string, name: string, shortName: string) => ({ code, name, shortName })

const REAL_CONFIGS = [
  { position: DEFAULT, points: 0.04, scoringCategory: cat('INDIVIDUAL_PASSING_YARDS', 'Passing Yards', 'YDS') },
  { position: DEFAULT, points: 0.1, scoringCategory: cat('INDIVIDUAL_RECEIVING_YARDS', 'Receiving Yards', 'YDS') },
  { position: DEFAULT, points: 0.1, scoringCategory: cat('INDIVIDUAL_RUSHING_YARDS', 'Rushing Yards', 'YDS') },
  { position: DEFAULT, points: 6, scoringCategory: cat('INDIVIDUAL_PASSING_TOUCHDOWNS', 'Passing TDs', 'TD') },
  { position: DEFAULT, points: 1, scoringCategory: cat('INDIVIDUAL_RECEPTIONS', 'Receptions', 'REC') },
  { position: { shortName: 'TE', code: 'TE' }, points: 1.5, scoringCategory: cat('INDIVIDUAL_RECEPTIONS', 'Receptions', 'REC') },
]

describe('captured Fantrax NBA points league', () => {
  const captured = nbaFixture as unknown as FantraxLeagueInfo
  const expected = [
    { stat_key: 'ast', points_value: 1.5 },
    { stat_key: 'blk', points_value: 2 },
    { stat_key: 'pts', points_value: 1 },
    { stat_key: 'reb', points_value: 1.25 },
    { stat_key: 'stl', points_value: 2 },
    { stat_key: 'to', points_value: -1 },
  ]

  it('keeps all six source weights, including the negative turnover rule', () => {
    expect(fantraxScoringMode(captured)).toBe('h2h_points')
    expect(fantraxScoringRules(captured, 'nba')).toEqual({ rules: expected, gaps: [] })
    expect(expected.every((rule) => NBA_CONFIG.scoringCategories.some((category) => category.key === rule.stat_key)))
      .toBe(true)
    const source = {
      settings: { scoringType: fantraxScoringMode(captured),
        scoringRules: expected.map((rule) => ({ statKey: rule.stat_key, points: rule.points_value })) },
    } as unknown as FantraxImportPayload
    expect(FantraxScoringMapper.map(source)).toMatchObject({
      scoring_format: 'h2h_points', rules: expected,
    })
  })

  it('does not apply NBA categories to a football import', () => {
    const football = fantraxScoringRules(captured, 'nfl')
    expect(football.rules).toEqual([])
    expect(football.gaps).toHaveLength(6)
  })
})

describe('Fantrax scoring-system type', () => {
  it.each([
    ['POINTS_BASED', 'points'],
    ['HEAD_TO_HEAD_POINTS_BASED', 'h2h_points'],
    ['ROTISSERIE', 'roto'],
    ['HEAD_TO_HEAD_ROTI_SINGLE_WIN', 'h2h_category'],
    ['HEAD_TO_HEAD_ROTI_MULTI_WIN', 'h2h_category'],
    ['BRACKET', null],
  ] as const)('preserves %s as %s', (type, expected) => {
    expect(fantraxScoringMode({ ...info([]), scoringSystem: { type } })).toBe(expected)
  })

  it('refuses to infer points mode when the source omits its type', () => {
    expect(fantraxScoringMode(info(REAL_CONFIGS))).toBeNull()
  })

  it('carries a live NBA mode through league and scoring normalization', () => {
    const source = {
      league: { name: 'NBA league', sport: 'NBA', season: 2026, size: 10, isDevy: false, isFinished: false },
      settings: { scoringType: 'h2h_points', scoringRules: [], rosterPositions: [], raw: {} },
      schedule: [],
    } as unknown as FantraxImportPayload
    expect(FantraxLeagueMapper.map(source)?.scoring).toBe('h2h_points')
    expect(FantraxScoringMapper.map(source)?.scoring_format).toBe('h2h_points')
  })
})

function valueOf(rules: { stat_key: string; points_value: number }[], key: string) {
  return rules.find((r) => r.stat_key === key)?.points_value
}

describe('the short-name collision that would silently mis-score every quarterback', () => {
  /**
   * ⚠ THE WHOLE REASON THIS MODULE EXISTS. `scoringCategories` is keyed by short
   * name and three different categories answer to `YDS`, so it reports a single
   * `YDS: 0.1`. Passing yards are actually 0.04. Scoring them at 0.1 is 2.5x —
   * about 240 points a season on a 4,000-yard quarterback — and nothing about
   * the output would look wrong.
   */
  it('keeps passing, receiving and rushing yards apart', () => {
    const { rules } = fantraxScoringRules(info(REAL_CONFIGS))
    expect(valueOf(rules, 'pass_yd')).toBe(0.04)
    expect(valueOf(rules, 'rec_yd')).toBe(0.1)
    expect(valueOf(rules, 'rush_yd')).toBe(0.1)
  })

  it('never lets the passing-yard value equal the rushing one by accident', () => {
    const { rules } = fantraxScoringRules(info(REAL_CONFIGS))
    expect(valueOf(rules, 'pass_yd')).not.toBe(valueOf(rules, 'rush_yd'))
  })
})

describe('TE premium', () => {
  /**
   * ⚠ FANTRAX STATES THE TOTAL, `bonus_rec_te` IS ADDED ON TOP OF `rec`.
   * Writing 1.5 there scores tight ends 2.5 a catch.
   */
  it('stores the premium as the difference, not the total', () => {
    const { rules } = fantraxScoringRules(info(REAL_CONFIGS))
    expect(valueOf(rules, 'rec')).toBe(1)
    expect(valueOf(rules, 'bonus_rec_te')).toBe(0.5)
  })

  it('emits no bonus at all when tight ends are scored like everyone else', () => {
    const flat = REAL_CONFIGS.map((c) =>
      c.position.shortName === 'TE' ? { ...c, points: 1 } : c,
    )
    const { rules } = fantraxScoringRules(info(flat))
    expect(rules.find((r) => r.stat_key === 'bonus_rec_te')).toBeUndefined()
  })
})

describe('categories Fantrax keeps in one bucket and this codebase keeps in three', () => {
  /**
   * ⚠ PICKING ONE KEY WOULD SILENTLY ZERO THE OTHERS. A two-point conversion is
   * worth the same however it was scored, so the value fans out.
   */
  it('fans two-point conversions out to pass, rush and rec', () => {
    const { rules } = fantraxScoringRules(
      info([{ position: DEFAULT, points: 2, scoringCategory: cat('INDIVIDUAL_TWO_POINT_CONVERSIONS_SCORES', '2PT', '2RR') }]),
    )
    expect(rules).toEqual([
      { stat_key: 'pass_2pt', points_value: 2 },
      { stat_key: 'rush_2pt', points_value: 2 },
      { stat_key: 'rec_2pt', points_value: 2 },
    ])
  })

  it('fans return touchdowns out to kick and punt returns', () => {
    const { rules } = fantraxScoringRules(
      info([{ position: DEFAULT, points: 6, scoringCategory: cat('INDIVIDUAL_RETURN_TOUCHDOWNS', 'Return TDs', 'RtT') }]),
    )
    expect(rules.map((r) => r.stat_key)).toEqual(['kr_td', 'pr_td'])
  })
})

describe('what it refuses to guess', () => {
  /**
   * ⚠ A CATEGORY DROPPED IN SILENCE IS A WRONG SCORE. Naming it lets coverage
   * say the scoring system is incomplete instead of presenting it as whole.
   */
  it('names an unknown category instead of dropping it', () => {
    const { rules, gaps } = fantraxScoringRules(
      info([{ position: DEFAULT, points: 4, scoringCategory: cat('INDIVIDUAL_SOMETHING_NEW', 'Blocked Kicks', 'BK') }]),
    )
    expect(rules).toEqual([])
    expect(gaps.join(' ')).toMatch(/Blocked Kicks/)
  })

  it('names a per-position rule it has no home for', () => {
    const { gaps } = fantraxScoringRules(
      info([{ position: { shortName: 'QB', code: 'QB' }, points: 0.05, scoringCategory: cat('INDIVIDUAL_PASSING_YARDS', 'Passing Yards', 'YDS') }]),
    )
    expect(gaps.join(' ')).toMatch(/QB/)
  })

  it('returns nothing rather than throwing when the league has no scoring system', () => {
    const bare = { ...info([]), scoringSystem: null } as FantraxLeagueInfo
    expect(fantraxScoringRules(bare)).toEqual({ rules: [], gaps: [] })
  })
})
