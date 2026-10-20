/**
 * NHL head-to-head categories and NBA rotisserie (Phase 5: the scoring types Sleeper / ESPN offer).
 *
 * Both reuse the existing category machinery — `resolveCategoryMatchup`, `rankRotisserieTeams`, the
 * redraft engine's roto branch — so these tests pin the parts that are new: the NHL category set and
 * the stat keys it reads, ratio categories from SUMMED components, ties and lower-is-better in roto,
 * which stored settings the native context accepts, and the create-league presets (defaults unchanged).
 */
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  accumulateTeamTotals,
  getCategoryPresetDefinitions,
  isCategoryPresetId,
  rankRotisserieTeams,
  resolveCategoryMatchup,
  NHL_TEN_CAT,
  type TeamStatTotals,
} from '@/lib/category-scoring'
import { isRotisserieLeagueSettings, nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import { normalizeRiGameBox } from '@/lib/sports-data/rollingInsightsGameLogs'
import { normalizeNhlGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import {
  buildScoringFromPresetId,
  getDefaultScoringPresetId,
  listScoringPresetOptions,
} from '@/lib/league-creation-preset/scoring-presets'
import { getAllowedScoringPresetsFromCatalog, getFallbackLeagueCreateOptionsCatalog } from '@/lib/league-creation/options-catalog'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { translations } from '@/lib/i18n/translations'

const NHL = getCategoryPresetDefinitions('nhl_10cat')!
const NBA9 = getCategoryPresetDefinitions('nba_9cat')!
const byLabel = (list: ReturnType<typeof resolveCategoryMatchup>, label: string) => list.categories.find((c) => c.label === label)!

describe('NHL 10-category preset', () => {
  it('is a registered preset with the standard set, GA and TO-style lower-is-better where it belongs', () => {
    expect(isCategoryPresetId('nhl_10cat')).toBe(true)
    expect(NHL).toBe(NHL_TEN_CAT)
    expect(NHL.map((c) => c.label)).toEqual(['G', 'A', '+/-', 'PIM', 'PPP', 'SOG', 'HIT', 'W', 'GA', 'SV%'])
    expect(NHL.filter((c) => c.direction === 'lower').map((c) => c.label)).toEqual(['GA'])
  })

  /*
   * Every key a category reads must be one the ingest actually stores. Run the committed /live NHL
   * capture through the ingest's own box parser and the weekly normalizer — exactly what lands in
   * `playerWeeklyScore.stats` — and require every category key to appear on some line.
   */
  it('reads only keys the committed Rolling Insights NHL capture produces', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'contracts/rolling-insights/fixtures/live.NHL.json'), 'utf8'))
    const games: unknown[] = Array.isArray(raw) ? raw : (raw.data?.NHL ?? raw.data ?? Object.values(raw)[0])
    const lines = games.flatMap((g) => normalizeRiGameBox(g)?.lines ?? [])
    expect(lines.length).toBeGreaterThan(0)
    const emitted = new Set<string>()
    for (const line of lines) {
      // What rollingInsightsGameLogs.normalizedMapFor stores: the line's finite numeric fields.
      const stats: Record<string, number> = {}
      for (const [k, v] of Object.entries(line.raw)) {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null
        if (n != null) stats[k] = n
      }
      for (const k of Object.keys(normalizeNhlGameStats({ stats }).stats)) emitted.add(k)
    }
    const keys = NHL.flatMap((c) => (c.computation.kind === 'sum' ? [c.computation.statKey] : [c.computation.numeratorStatKey, c.computation.denominatorStatKey]))
    expect(keys.filter((k) => !emitted.has(k))).toEqual([])
  })

  it('SV% is summed saves / summed shots against, never an average of goalie rates', () => {
    // Team A: two goalies, .938 and .667 → average .802, but 40 / 47 = .851 on totals.
    const a = accumulateTeamTotals([{ g_sv: 30, g_sa: 32, g_ga: 2 }, { g_sv: 10, g_sa: 15, g_ga: 5 }])
    // Team B: one goalie, 41 / 49 = .837 — beats A's average, loses to A's true total.
    const b = accumulateTeamTotals([{ g_sv: 41, g_sa: 49, g_ga: 8 }])
    const sv = byLabel(resolveCategoryMatchup(a, b, NHL), 'SV%')
    expect(sv.aValue).toBeCloseTo(40 / 47, 9)
    expect(sv.winner).toBe('a')
  })

  it('GA is lower-is-better, and a team whose goalies faced no shots has no SV% and cannot win it', () => {
    const shotAt = { g_sv: 20, g_sa: 23, g_ga: 3, g_win: 1 }
    const noGoalie = { g: 2, a: 3 }
    const r = resolveCategoryMatchup(shotAt, noGoalie, NHL)
    expect(byLabel(r, 'SV%')).toMatchObject({ bValue: null, winner: 'a' })
    // Benching every goalie wins GA (0 < 3) — the trade-off of a counting goalie category, and why W and SV% sit beside it.
    expect(byLabel(r, 'GA').winner).toBe('b')
    // Neither team qualified for SV%: a tie, not a win for either.
    expect(byLabel(resolveCategoryMatchup(noGoalie, noGoalie, NHL), 'SV%').winner).toBe('tie')
  })

  it('a full matchup decides all ten categories', () => {
    const home: TeamStatTotals = { g: 10, a: 14, plusminus: 3, pim: 8, ppp: 4, sog: 90, hits: 40, g_win: 2, g_ga: 6, g_sv: 80, g_sa: 86 }
    const away: TeamStatTotals = { g: 8, a: 14, plusminus: 5, pim: 12, ppp: 2, sog: 95, hits: 30, g_win: 3, g_ga: 9, g_sv: 70, g_sa: 79 }
    const r = resolveCategoryMatchup(home, away, NHL)
    expect(r.aWins + r.bWins + r.ties).toBe(10)
    expect({ a: r.aWins, b: r.bWins, t: r.ties }).toEqual({ a: 5, b: 4, t: 1 })
  })
})

describe('NBA rotisserie on the 9-cat set', () => {
  // Native weekly stats use the short keys (pts, fgm, fga, to …); the resolver maps the category keys to them.
  const team = (lines: TeamStatTotals[]) => accumulateTeamTotals(lines)
  const base = { reb: 10, ast: 10, stl: 5, blk: 5, threes: 5, ftm: 8, fta: 10 }

  it('ties split the occupied rank points by averaging; TO ranks fewest first', () => {
    const teams = [
      { id: 'A', stats: team([{ ...base, pts: 100, to: 20, fgm: 40, fga: 80 }]) },
      { id: 'B', stats: team([{ ...base, pts: 100, to: 10, fgm: 40, fga: 80 }]) },
      { id: 'C', stats: team([{ ...base, pts: 90, to: 15, fgm: 40, fga: 80 }]) },
      { id: 'D', stats: team([{ ...base, pts: 80, to: 30, fgm: 40, fga: 80 }]) },
    ]
    const ranked = rankRotisserieTeams(teams, NBA9)
    // PTS: A and B tie for first in a 4-team league → (4 + 3) / 2 each.
    expect(ranked.get('A')!.categories.nba_pts.points).toBe(3.5)
    expect(ranked.get('B')!.categories.nba_pts.points).toBe(3.5)
    expect(ranked.get('C')!.categories.nba_pts.points).toBe(2)
    expect(ranked.get('D')!.categories.nba_pts.points).toBe(1)
    // TO: fewest is best — B (10) earns 4, D (30) earns 1.
    expect(ranked.get('B')!.categories.nba_to.points).toBe(4)
    expect(ranked.get('D')!.categories.nba_to.points).toBe(1)
    // A four-way tie (REB) shares (4+3+2+1)/4 = 2.5.
    expect(ranked.get('C')!.categories.nba_reb.points).toBe(2.5)
    // Totals are the sum of category points: every team's 9 categories, 90 points in all.
    const total = [...ranked.values()].reduce((s, r) => s + r.total, 0)
    expect(total).toBe(9 * (4 + 3 + 2 + 1))
  })

  it('FG% comes from summed makes / attempts, not the average of player percentages', () => {
    // X: a 10/10 shooter and a 10/40 shooter → average 62.5%, totals 20/50 = 40%.
    const X = team([{ ...base, pts: 50, to: 5, fgm: 10, fga: 10 }, { ...base, pts: 50, to: 5, fgm: 10, fga: 40 }])
    // Y: one 45% shooter on volume — loses to X's average, beats X's true total.
    const Y = team([{ ...base, pts: 100, to: 10, fgm: 45, fga: 100 }])
    const ranked = rankRotisserieTeams([{ id: 'X', stats: X }, { id: 'Y', stats: Y }], NBA9)
    expect(ranked.get('X')!.categories.nba_fg_pct.value).toBeCloseTo(0.4, 9)
    expect(ranked.get('Y')!.categories.nba_fg_pct.points).toBe(2)
    expect(ranked.get('X')!.categories.nba_fg_pct.points).toBe(1)
  })
})

describe('native category context (stored rules only)', () => {
  const ctx = (sport: string, settings: Record<string, unknown>) => nativeCategoryScoringContext(settings, sport)

  it('reads NHL head-to-head categories, and nothing else for NHL', () => {
    const h2h = ctx('NHL', { scoring_mode: 'h2h_category', category_preset_id: 'nhl_10cat', category_record_mode: 'most' })
    expect(h2h?.categories.map((c) => c.label)).toEqual(NHL.map((c) => c.label))
    expect(ctx('NHL', { scoring_mode: 'roto', category_preset_id: 'nhl_10cat', category_record_mode: 'roto' })).toBeNull()
    expect(ctx('NHL', { scoring_mode: 'h2h_category', category_preset_id: 'nba_9cat', category_record_mode: 'most' })).toBeNull()
    // Another sport cannot borrow the NHL set.
    expect(ctx('NBA', { scoring_mode: 'h2h_category', category_preset_id: 'nhl_10cat', category_record_mode: 'most' })).toBeNull()
  })

  it('reads NBA 9-cat rotisserie; NBA head-to-head unchanged; other NBA roto sets refused', () => {
    expect(ctx('NBA', { scoring_mode: 'roto', category_preset_id: 'nba_9cat', category_record_mode: 'roto' })).toMatchObject({ mode: 'roto', recordMode: 'roto', presetId: 'nba_9cat' })
    expect(ctx('NBA', { scoring_mode: 'roto', category_preset_id: 'nba_8cat_standard', category_record_mode: 'roto' })).toBeNull()
    expect(ctx('NBA', { scoring_mode: 'roto', category_preset_id: 'nba_9cat', category_record_mode: 'most' })).toBeNull()
    expect(ctx('NBA', { scoring_mode: 'h2h_category', category_preset_id: 'nba_9cat', category_record_mode: 'each' })).toMatchObject({ mode: 'h2h_category' })
    expect(ctx('NBA', { scoring_mode: 'points' })).toBeNull()
  })

  it('isRotisserieLeagueSettings reads the stored mode only', () => {
    expect(isRotisserieLeagueSettings({ scoring_mode: 'roto' })).toBe(true)
    expect(isRotisserieLeagueSettings({ scoring_mode: 'h2h_category' })).toBe(false)
    expect(isRotisserieLeagueSettings(null)).toBe(false)
    expect(isRotisserieLeagueSettings({ scoringType: 'roto' })).toBe(false)
  })
})

describe('create-league presets', () => {
  const opts = (sport: 'NBA' | 'NHL', leagueType: string) =>
    listScoringPresetOptions({ sport, leagueType: leagueType as never, idpSelected: false }).map((o) => o.id)

  it.each(['redraft', 'dynasty', 'keeper'])('offers NBA roto and NHL categories for %s, in the wizard and the server catalog', (leagueType) => {
    expect(opts('NBA', leagueType)).toContain('nba_9cat_roto')
    expect(opts('NHL', leagueType)).toEqual(expect.arrayContaining(['nhl_cat_each', 'nhl_cat_most']))
    const catalog = getFallbackLeagueCreateOptionsCatalog()
    expect(getAllowedScoringPresetsFromCatalog(catalog, leagueType, 'NBA')).toContain('nba_9cat_roto')
    expect(getAllowedScoringPresetsFromCatalog(catalog, leagueType, 'NHL')).toEqual(expect.arrayContaining(['nhl_cat_each', 'nhl_cat_most']))
  })

  it('keeps them out of best ball, and the defaults stay points', () => {
    expect(opts('NBA', 'best_ball')).not.toContain('nba_9cat_roto')
    expect(opts('NHL', 'best_ball')).toEqual(['nhl_points'])
    expect(getDefaultScoringPresetId({ sport: 'NBA', leagueType: 'redraft', idpSelected: false })).toBe('nba_points')
    expect(getDefaultScoringPresetId({ sport: 'NHL', leagueType: 'redraft', idpSelected: false })).toBe('nhl_points')
  })

  it('build the stored settings the scoring engine and the native context read', () => {
    const ctx = { leagueType: 'redraft' as const, idpSelected: false }
    expect(buildScoringFromPresetId('nba_9cat_roto', { ...ctx, sport: 'NBA' }).scoringSettings).toMatchObject({ scoringMode: 'roto', categoryPresetId: 'nba_9cat', categoryRecordMode: 'roto' })
    expect(buildScoringFromPresetId('nhl_cat_each', { ...ctx, sport: 'NHL' }).scoringSettings).toMatchObject({ scoringMode: 'h2h_category', categoryPresetId: 'nhl_10cat', categoryRecordMode: 'each' })
    expect(buildScoringFromPresetId('nhl_cat_most', { ...ctx, sport: 'NHL' }).scoringSettings).toMatchObject({ scoringMode: 'h2h_category', categoryPresetId: 'nhl_10cat', categoryRecordMode: 'most' })
  })

  it('league foundation defaults carry the chosen category format; a points preset stays points', () => {
    const d = (sport: string, scoringPreset: string) =>
      getLeagueDefaults({ sport, format: 'redraft', draftType: 'snake', scoringPreset, managerCount: 10 }).scoringSettings as Record<string, unknown>
    expect(d('NHL', 'nhl_cat_most')).toMatchObject({ scoringMode: 'h2h_category', categoryPresetId: 'nhl_10cat', categoryRecordMode: 'most' })
    expect(d('NBA', 'nba_9cat_roto')).toMatchObject({ scoringMode: 'roto', categoryPresetId: 'nba_9cat', categoryRecordMode: 'roto' })
    expect(d('NHL', 'nhl_points').scoringMode).toBe('points')
    expect(d('NHL', 'nhl_points').categoryPresetId).toBeUndefined()
    expect(d('NBA', 'nba_points').scoringMode).toBe('points')
  })

  it('names every new preset in English and Spanish', () => {
    for (const id of ['nba_9cat_roto', 'nhl_cat_each', 'nhl_cat_most']) {
      const key = `createLeague.scoringPreset.${id}`
      expect(translations.en[key], key).toBeTruthy()
      expect(translations.es[key], key).toBeTruthy()
      expect(translations.es[key]).not.toBe(translations.en[key])
    }
    expect(translations.es['scorePanel.pctNote.nhl']).toBeTruthy()
  })
})
