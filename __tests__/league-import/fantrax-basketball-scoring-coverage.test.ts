import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fantraxScoringRules } from '@/lib/league-import/fantrax/fantraxScoring'
import { normalizeNbaGameStats, normalizeNcaabGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { getSportConfig } from '@/lib/sportConfig'

/*
 * 2026-11-26: Road To Glory's NBA league scores 23 categories and its NCAA basketball league 18; only six of
 * each were carried. Every category the stats box carries now maps; the ones it does not carry stay named gaps.
 * Scoring settings below are those two leagues' real ones (tests/fixtures/fantrax/road-to-glory-*).
 */
const fx = JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/fantrax/road-to-glory-basketball-scoring-2026.json'), 'utf8'))
const NOT_IN_THE_BOX = ['Ejections', 'Technical Fouls', 'Flagrant Fouls', 'Personal Fouls Drawn', 'Game Winning Buzzer Beaters', 'Wins', 'Losses']

describe('Road To Glory basketball scoring', () => {
  it.each([['rtgNba'], ['rtgNcaab']])('%s: every category the box carries maps; only the absent ones are gaps', (name) => {
    const { rules, gaps } = fantraxScoringRules(fx[name] as never)
    const keys = new Set(rules.map((r) => r.stat_key))
    for (const k of ['pts', 'reb', 'ast', 'stl', 'blk', 'to', 'ftm', 'ft_miss', 'threes', 'dbl_dbl', 'trpl_dbl', 'quad_dbl', 'pf']) expect(keys, k).toContain(k)
    for (const gap of gaps) expect(NOT_IN_THE_BOX.some((code) => gap.includes(code)), gap).toBe(true)
    expect(gaps.length).toBeGreaterThan(0) // ejections etc. are named, never silently dropped
  })

  it('the NBA league also maps twos, misses and the values it set', () => {
    const { rules } = fantraxScoringRules(fx.rtgNba as never)
    const by = Object.fromEntries(rules.map((r) => [r.stat_key, r.points_value]))
    expect(by).toMatchObject({ threes: 3, fg2m: 2, fg3_miss: -1, fg2_miss: -1, quad_dbl: 10, trpl_dbl: 5, dbl_dbl: 2, ft_miss: -1 })
  })

  it('the NCAA basketball league maps minutes', () => {
    const { rules } = fantraxScoringRules(fx.rtgNcaab as never)
    expect(rules.find((r) => r.stat_key === 'min')?.points_value).toBe(0.1)
  })
})

const box = (over: Record<string, unknown>) => ({
  points: 22, total_rebounds: 11, assists: 10, steals: 1, blocks: 0, turnovers: 3, three_points_made: 4, three_points_attempted: 9,
  two_points_made: 5, two_points_attempted: 12, free_throws_made: 0, free_throws_attempted: 3, field_goals_made: 9, field_goals_attempted: 21,
  fouls: 4, minutes: '35:21', ...over,
})

describe('basketball box extras', () => {
  it('NBA: minutes from mm:ss, fouls, twos, misses, and the triple-double', () => {
    const { stats, unmappedKeys } = normalizeNbaGameStats({ stats: box({}) })
    expect(stats).toMatchObject({ min: 35.35, pf: 4, fg2m: 5, fg2_miss: 7, fg3_miss: 5, ft_miss: 3, dbl_dbl: 1, trpl_dbl: 1 })
    expect(stats.quad_dbl).toBeUndefined()
    expect(unmappedKeys).not.toContain('fouls')
    expect(unmappedKeys).not.toContain('minutes')
  })

  it('NCAAB: minutes as a plain number, free throws made, and the doubles bonuses', () => {
    const { stats } = normalizeNcaabGameStats({ stats: box({ minutes: '20', steals: 10 }) })
    expect(stats).toMatchObject({ min: 20, ftm: 0, ft_miss: 3, dbl_dbl: 1, trpl_dbl: 1, quad_dbl: 1 })
  })

  it('a miss count needs both halves', () => {
    const { stats } = normalizeNbaGameStats({ stats: { points: 8, three_points_made: 2 } })
    expect(stats.fg3_miss).toBeUndefined()
  })

  it('every new key is a config category that scores 0 unless a league sets it', () => {
    for (const sport of ['NBA', 'NCAAB'] as const) {
      const cats = new Map(getSportConfig(sport).scoringCategories.map((c) => [c.key, c.defaultPoints]))
      for (const k of ['min', 'pf', 'fg2m', 'fg2_miss', 'fg3_miss', 'ft_miss', 'quad_dbl']) expect(cats.get(k), `${sport} ${k}`).toBe(0)
    }
  })
})
