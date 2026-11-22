/**
 * NHL head-to-head categories and rotisserie, on the category engine MLB and NBA already use.
 *
 * Standard hockey categories: skaters G, A, +/-, PIM, PPP, SOG, HIT, BLK; goalies W, GAA, SV%, SO.
 * Every category reads keys the NHL normalizer actually writes, checked here on the committed
 * Rolling Insights fixture through the stored shape the weekly scorer reads.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: vi.fn() }))

import {
  accumulateTeamTotals,
  computeCategoryValue,
  getCategoryPresetDefinitions,
  isCategoryPresetId,
  rankRotisserieTeams,
  resolveCategoryMatchup,
} from '@/lib/category-scoring'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import {
  buildScoringFromPresetId,
  isNativeCategoryScoringPreset,
  listScoringPresetOptions,
} from '@/lib/league-creation-preset/scoring-presets'
import { normalizeNhlGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { getScoringCategories } from '@/lib/sportConfig'
import { normalizeRiGameBox, normalizedStatMapFor } from '@/lib/sports-data/rollingInsightsGameLogs'

const CATS = getCategoryPresetDefinitions('nhl_standard')!

function fixtureLines() {
  const path = join(process.cwd(), 'contracts/rolling-insights/fixtures/live.NHL.json')
  const games = (JSON.parse(readFileSync(path, 'utf8')) as { data: { NHL: unknown[] } }).data.NHL
  return games.flatMap((game) => {
    const box = normalizeRiGameBox(game)!
    return box.lines.map((line) => ({ group: line.group, raw: line.raw, stats: normalizeNhlGameStats(normalizedStatMapFor(line, box)).stats }))
  })
}

const sum = (rows: Array<Record<string, unknown>>, key: string) => rows.reduce((s, r) => s + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0)
const toi = (v: unknown) => {
  const m = /^(\d+):(\d\d)$/.exec(String(v ?? ''))
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0
}

describe('the NHL standard category preset', () => {
  it('is the twelve standard categories, in order', () => {
    expect(isCategoryPresetId('nhl_standard')).toBe(true)
    expect(CATS.map((c) => c.label)).toEqual(['G', 'A', '+/-', 'PIM', 'PPP', 'SOG', 'HIT', 'BLK', 'W', 'GAA', 'SV%', 'SO'])
  })

  it('only GAA is lower-is-better', () => {
    expect(CATS.filter((c) => c.direction === 'lower').map((c) => c.label)).toEqual(['GAA'])
  })

  it('reads only keys the NHL engine defines', () => {
    const engineKeys = new Set(getScoringCategories('NHL').map((c) => c.key))
    for (const c of CATS) {
      const comp = c.computation
      const keys = comp.kind === 'sum' ? [comp.statKey] : [comp.numeratorStatKey, comp.denominatorStatKey, ...(comp.additionalNumeratorStatKeys ?? [])]
      for (const key of keys) expect(engineKeys.has(key), `${c.label} reads ${key}`).toBe(true)
    }
  })
})

describe('category values from the committed fixture', () => {
  const lines = fixtureLines()
  const team = accumulateTeamTotals(lines.map((l) => l.stats))
  const skaters = lines.filter((l) => l.group === 'skaters').map((l) => l.raw)
  const goalies = lines.filter((l) => l.group === 'goalies').map((l) => l.raw)
  const value = (label: string) => computeCategoryValue(team, CATS.find((c) => c.label === label)!)

  it('counting categories equal the vendor totals', () => {
    expect(value('G')).toBe(sum(skaters, 'goals'))
    expect(value('A')).toBe(sum(skaters, 'assists'))
    expect(value('+/-')).toBe(sum(skaters, 'plus_minus'))
    expect(value('PIM')).toBe(sum(skaters, 'penalty_minutes') + sum(goalies, 'penalty_minutes'))
    expect(value('PPP')).toBe(sum(skaters, 'power_play_goals') + sum(skaters, 'power_play_assists'))
    expect(value('SOG')).toBe(sum(skaters, 'shots_on_goal'))
    expect(value('HIT')).toBe(sum(skaters, 'hits'))
    expect(value('BLK')).toBe(sum(skaters, 'blocks'))
    expect(value('W')).toBe(sum(goalies, 'win'))
    expect(value('SO')).toBe(sum(goalies, 'shutouts'))
    expect(value('G')).toBeGreaterThan(0)
    expect(value('W')).toBeGreaterThan(0)
  })

  it('SV% is total saves over total shots against', () => {
    expect(value('SV%')).toBeCloseTo(sum(goalies, 'saves') / sum(goalies, 'shots_against'), 9)
  })

  it('GAA is goals against per sixty goalie minutes', () => {
    const minutes = goalies.reduce((s, g) => s + toi(g.time_on_ice), 0)
    expect(minutes).toBeGreaterThan(600)
    expect(value('GAA')).toBeCloseTo((sum(goalies, 'goals_allowed') * 60) / minutes, 9)
  })

  it('a team that started no goalie is unqualified for the rate categories, not perfect', () => {
    const noGoalie = accumulateTeamTotals(lines.filter((l) => l.group === 'skaters').map((l) => l.stats))
    expect(computeCategoryValue(noGoalie, CATS.find((c) => c.label === 'GAA')!)).toBeNull()
    expect(computeCategoryValue(noGoalie, CATS.find((c) => c.label === 'SV%')!)).toBeNull()
  })
})

describe('a weekly matchup and a roto table', () => {
  const a = { g: 10, a: 15, plusminus: 4, pim: 12, ppp: 5, sog: 90, hits: 40, blks: 30, g_win: 3, g_ga: 8, g_toi: 240, g_sv: 110, g_sa: 118, g_so: 1 }
  const b = { g: 8, a: 15, plusminus: 6, pim: 20, ppp: 3, sog: 80, hits: 55, blks: 20, g_win: 2, g_ga: 6, g_toi: 120, g_sv: 50, g_sa: 56, g_so: 0 }

  it('resolves each category independently', () => {
    const r = resolveCategoryMatchup(a, b, CATS)
    const by = Object.fromEntries(r.categories.map((c) => [c.label, c.winner]))
    // a: GAA 2.00 vs 3.00 (lower wins), SV% .932 vs .893.
    expect(by).toEqual({ G: 'a', A: 'tie', '+/-': 'b', PIM: 'b', PPP: 'a', SOG: 'a', HIT: 'b', BLK: 'a', W: 'a', GAA: 'a', 'SV%': 'a', SO: 'a' })
    expect([r.aWins, r.bWins, r.ties]).toEqual([8, 3, 1])
  })

  it('ranks a rotisserie table across all twelve categories', () => {
    const table = rankRotisserieTeams([{ id: 'A', stats: a }, { id: 'B', stats: b }], CATS)
    expect(table.get('A')!.total + table.get('B')!.total).toBe(12 * 3)
    expect(table.get('A')!.total).toBeGreaterThan(table.get('B')!.total)
  })
})

describe('an NHL commissioner can create a category league', () => {
  const ctx = { sport: 'NHL' as const, leagueType: 'redraft' as const, idpSelected: false }

  it('offers H2H each-category, H2H most-categories and rotisserie', () => {
    const ids = listScoringPresetOptions(ctx).map((o) => o.id)
    expect(ids).toEqual(expect.arrayContaining(['nhl_points', 'nhl_cats_each', 'nhl_cats_most', 'nhl_cats_roto']))
    for (const concept of ['redraft', 'dynasty', 'keeper'] as const) {
      expect(LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedScoringPresetsByConceptSport[concept].NHL).toEqual(
        expect.arrayContaining(['nhl_cats_each', 'nhl_cats_most', 'nhl_cats_roto']),
      )
    }
  })

  it('stores the settings the category engine reads', () => {
    expect(buildScoringFromPresetId('nhl_cats_roto', ctx).scoringSettings).toMatchObject({
      scoringMode: 'roto', categoryPresetId: 'nhl_standard', categoryRecordMode: 'roto',
    })
    expect(buildScoringFromPresetId('nhl_cats_each', ctx).scoringSettings).toMatchObject({
      scoringMode: 'h2h_category', categoryPresetId: 'nhl_standard', categoryRecordMode: 'each',
    })
    expect(isNativeCategoryScoringPreset('NHL', 'nhl_cats_most')).toBe(true)
    expect(isNativeCategoryScoringPreset('NHL', 'nhl_points')).toBe(false)
    expect(isNativeCategoryScoringPreset('MLB', 'mlb_5x5_each')).toBe(true)
  })

  it('is not offered outside redraft, dynasty and keeper', () => {
    expect(listScoringPresetOptions({ ...ctx, leagueType: 'guillotine' as never }).map((o) => o.id)).not.toContain('nhl_cats_each')
  })

  it('grounds OS and Chimmy in the stored NHL categories', () => {
    const context = nativeCategoryScoringContext(
      { scoring_mode: 'h2h_category', category_preset_id: 'nhl_standard', category_record_mode: 'most' },
      'NHL',
    )
    expect(context?.categories.map((c) => c.label)).toEqual(CATS.map((c) => c.label))
    expect(nativeCategoryScoringContext({ scoring_mode: 'h2h_category', category_preset_id: 'nhl_standard', category_record_mode: 'most' }, 'NBA')).toBeNull()
  })
})
