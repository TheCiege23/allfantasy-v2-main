/**
 * Category value (trade grade audit follow-up, 2026-10-09): what a player is worth in a category league,
 * per game — z-scores against the rosterable pool, percentages weighted by volume, turnovers against.
 */
import { describe, expect, it } from 'vitest'
import { categoryList, categoryPerGameValues, groupedCategoryValues, type CategoryPlayer } from '@/lib/decision-os/trade/sportCategoryValue'
import { getCategoryPresetDefinitions } from '@/lib/category-scoring'
import type { CategoryDefinition } from '@/lib/category-scoring/types'

const PTS: CategoryDefinition = { id: 'pts', label: 'PTS', direction: 'higher', computation: { kind: 'sum', statKey: 'points_scored' } }
const TO: CategoryDefinition = { id: 'to', label: 'TO', direction: 'lower', computation: { kind: 'sum', statKey: 'turnover' } }
const FT: CategoryDefinition = { id: 'ft', label: 'FT%', direction: 'higher', computation: { kind: 'ratio', numeratorStatKey: 'free_throws_made', denominatorStatKey: 'free_throws_attempted' } }

const player = (id: string, stats: Record<string, number>, eligible = true): CategoryPlayer => ({ id, stats, eligible })

describe('categoryPerGameValues', () => {
  it('scores a counting category in standard deviations from the pool, read in the matchup engine’s keys', () => {
    // The projection's short keys (`pts`) are read for the category's long key (`points_scored`).
    const v = categoryPerGameValues([player('a', { pts: 30 }), player('b', { pts: 20 }), player('c', { pts: 10 })], [PTS], 3)
    expect(v.get('b')!.total).toBeCloseTo(0, 6)
    expect(v.get('a')!.total).toBeCloseTo(-v.get('c')!.total, 6)
    expect(v.get('a')!.total).toBeGreaterThan(1)
  })

  it('counts turnovers against the player', () => {
    const v = categoryPerGameValues([player('careful', { to: 1 }), player('mid', { to: 2 }), player('loose', { to: 3 })], [TO], 3)
    expect(v.get('careful')!.total).toBeGreaterThan(0)
    expect(v.get('loose')!.total).toBeLessThan(0)
  })

  it('weights a percentage by volume — a 90% shooter on one attempt barely moves FT%', () => {
    const v = categoryPerGameValues([
      player('volume90', { ftm: 9, fta: 10 }),
      player('token90', { ftm: 0.9, fta: 1 }),
      player('volume50', { ftm: 5, fta: 10 }),
      player('avg', { ftm: 3.75, fta: 5 }),
    ], [FT], 4)
    expect(v.get('volume90')!.total).toBeGreaterThan(v.get('token90')!.total)
    expect(v.get('volume50')!.total).toBeLessThan(v.get('token90')!.total)
    expect(v.get('volume50')!.total).toBeLessThan(0)
  })

  it('measures the scale over the rosterable pool, so deep-bench lines do not set it', () => {
    const starters = [player('s1', { pts: 30 }), player('s2', { pts: 25 }), player('s3', { pts: 20 })]
    const bench = Array.from({ length: 30 }, (_, i) => player(`b${i}`, { pts: 2 }))
    const narrow = categoryPerGameValues([...starters, ...bench], [PTS], 3)
    const wide = categoryPerGameValues([...starters, ...bench], [PTS], 33)
    // Against the three rosterable players s2 is average; against the whole board he looks like a star.
    expect(narrow.get('s2')!.total).toBeCloseTo(0, 6)
    expect(wide.get('s2')!.total).toBeGreaterThan(1)
  })

  it('values an ineligible (thin) projection without letting it set the scale', () => {
    const v = categoryPerGameValues([player('a', { pts: 30 }), player('b', { pts: 20 }), player('c', { pts: 10 }), player('fluke', { pts: 90 }, false)], [PTS], 3)
    expect(v.get('b')!.total).toBeCloseTo(0, 6)
    expect(v.get('fluke')!.total).toBeGreaterThan(v.get('a')!.total)
  })

  it('scores a category nobody differs in as zero, not NaN', () => {
    const v = categoryPerGameValues([player('a', { pts: 10 }), player('b', { pts: 10 })], [PTS], 2)
    expect(v.get('a')!.total).toBe(0)
  })

  it('values the real 9-cat preset end to end on a projected line', () => {
    const nine = getCategoryPresetDefinitions('nba_9cat')!
    const line = (pts: number, fgm: number, fga: number) => ({ pts, reb: 8, ast: 5, stl: 1, blk: 1, to: 2, threes: 2, fgm, fga, ftm: 4, fta: 5 })
    const v = categoryPerGameValues([player('eff', line(25, 10, 18)), player('ineff', line(25, 9, 24)), player('mid', line(20, 8, 17))], nine, 3)
    // Same points; the efficient scorer wins FG% on volume, so he is worth more.
    expect(v.get('eff')!.total).toBeGreaterThan(v.get('ineff')!.total)
    expect(Object.keys(v.get('eff')!.byCategory)).toHaveLength(9)
  })
})

describe('categoryList', () => {
  it('names the categories a grade was valued on', () => {
    expect(categoryList(getCategoryPresetDefinitions('nba_9cat')!)).toBe('PTS, REB, AST, STL, BLK, TO, FG%, FT% and 3PM')
    expect(categoryList([PTS])).toBe('PTS')
  })
})

describe('groupedCategoryValues', () => {
  const HR: CategoryDefinition = { id: 'hr', label: 'HR', direction: 'higher', computation: { kind: 'sum', statKey: 'hr' } }
  const K: CategoryDefinition = { id: 'k', label: 'K', direction: 'higher', computation: { kind: 'sum', statKey: 'so' } }
  const hitters = [player('a', { hr: 0.4 }), player('b', { hr: 0.2 }), player('c', { hr: 0.1 })]
  const pitchers = [player('p', { so: 1.4 }), player('q', { so: 0.8 })]

  it('values each group only against its own pool and on its own categories', () => {
    const v = groupedCategoryValues([
      { players: hitters, categories: [HR], poolSize: 3 },
      { players: pitchers, categories: [K], poolSize: 2 },
    ])
    // The hitters' scale is the hitters' alone: the same as valuing them with no pitchers anywhere.
    expect(v.get('b')!.total).toBeCloseTo(categoryPerGameValues(hitters, [HR], 3).get('b')!.total, 9)
    expect(Object.keys(v.get('a')!.byCategory)).toEqual(['hr'])
    expect(Object.keys(v.get('p')!.byCategory)).toEqual(['k'])
  })

  it('sums a two-way player across both groups', () => {
    const twoWay = player('two', { hr: 0.3, so: 1.1 })
    const v = groupedCategoryValues([
      { players: [...hitters, twoWay], categories: [HR], poolSize: 4 },
      { players: [...pitchers, twoWay], categories: [K], poolSize: 3 },
    ])
    const two = v.get('two')!
    expect(two.total).toBeCloseTo(two.byCategory.hr! + two.byCategory.k!, 9)
  })
})
