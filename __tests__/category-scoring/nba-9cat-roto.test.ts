/**
 * NBA rotisserie on the 9-cat set (Phase 5: the scoring types Sleeper / ESPN offer).
 *
 * It reuses the existing category machinery — `rankRotisserieTeams` and the redraft engine's roto
 * branch, which MLB and NHL roto already run on — so these tests pin the parts that are new: ties and
 * lower-is-better in roto, ratio categories from SUMMED components, which stored settings the native
 * context accepts, and the create-league preset (defaults unchanged).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  accumulateTeamTotals,
  getCategoryPresetDefinitions,
  rankRotisserieTeams,
  type TeamStatTotals,
} from '@/lib/category-scoring'
import { isRotisserieLeagueSettings, nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import {
  buildScoringFromPresetId,
  getDefaultScoringPresetId,
  listScoringPresetOptions,
} from '@/lib/league-creation-preset/scoring-presets'
import { getAllowedScoringPresetsFromCatalog, getFallbackLeagueCreateOptionsCatalog } from '@/lib/league-creation/options-catalog'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { translations } from '@/lib/i18n/translations'

const NBA9 = getCategoryPresetDefinitions('nba_9cat')!

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

  it('reads NBA 9-cat rotisserie; NBA head-to-head unchanged; other NBA roto sets refused', () => {
    expect(ctx('NBA', { scoring_mode: 'roto', category_preset_id: 'nba_9cat', category_record_mode: 'roto' })).toMatchObject({ mode: 'roto', recordMode: 'roto', presetId: 'nba_9cat' })
    expect(ctx('NBA', { scoring_mode: 'roto', category_preset_id: 'nba_8cat_standard', category_record_mode: 'roto' })).toBeNull()
    expect(ctx('NBA', { scoring_mode: 'roto', category_preset_id: 'nba_9cat', category_record_mode: 'most' })).toBeNull()
    expect(ctx('NBA', { scoring_mode: 'h2h_category', category_preset_id: 'nba_9cat', category_record_mode: 'each' })).toMatchObject({ mode: 'h2h_category' })
    expect(ctx('NBA', { scoring_mode: 'points' })).toBeNull()
  })

  it('NHL and MLB rotisserie are untouched', () => {
    expect(ctx('NHL', { scoring_mode: 'roto', category_preset_id: 'nhl_standard', category_record_mode: 'roto' })).toMatchObject({ mode: 'roto' })
    expect(ctx('MLB', { scoring_mode: 'roto', category_preset_id: 'mlb_5x5', category_record_mode: 'roto' })).toMatchObject({ mode: 'roto' })
  })

  it('isRotisserieLeagueSettings reads the stored mode only', () => {
    expect(isRotisserieLeagueSettings({ scoring_mode: 'roto' })).toBe(true)
    expect(isRotisserieLeagueSettings({ scoring_mode: 'h2h_category' })).toBe(false)
    expect(isRotisserieLeagueSettings(null)).toBe(false)
    expect(isRotisserieLeagueSettings({ scoringType: 'roto' })).toBe(false)
  })
})

describe('create-league preset', () => {
  const opts = (leagueType: string) =>
    listScoringPresetOptions({ sport: 'NBA', leagueType: leagueType as never, idpSelected: false }).map((o) => o.id)

  it.each(['redraft', 'dynasty', 'keeper'])('offers NBA roto for %s, in the wizard and the server catalog', (leagueType) => {
    expect(opts(leagueType)).toContain('nba_9cat_roto')
    expect(getAllowedScoringPresetsFromCatalog(getFallbackLeagueCreateOptionsCatalog(), leagueType, 'NBA')).toContain('nba_9cat_roto')
  })

  it('keeps it out of best ball, and the default stays points', () => {
    expect(opts('best_ball')).not.toContain('nba_9cat_roto')
    expect(getDefaultScoringPresetId({ sport: 'NBA', leagueType: 'redraft', idpSelected: false })).toBe('nba_points')
  })

  it('builds the stored settings the scoring engine and the native context read', () => {
    expect(buildScoringFromPresetId('nba_9cat_roto', { sport: 'NBA', leagueType: 'redraft', idpSelected: false }).scoringSettings).toMatchObject({ scoringMode: 'roto', categoryPresetId: 'nba_9cat', categoryRecordMode: 'roto' })
  })

  it('league foundation defaults carry the chosen format; a points preset stays points', () => {
    const d = (scoringPreset: string) =>
      getLeagueDefaults({ sport: 'NBA', format: 'redraft', draftType: 'snake', scoringPreset, managerCount: 10 }).scoringSettings as Record<string, unknown>
    expect(d('nba_9cat_roto')).toMatchObject({ scoringMode: 'roto', categoryPresetId: 'nba_9cat', categoryRecordMode: 'roto' })
    expect(d('nba_points').scoringMode).toBe('points')
  })

  it('names the preset and the NHL panel note in English and Spanish', () => {
    for (const key of ['createLeague.scoringPreset.nba_9cat_roto', 'scorePanel.pctNote.nhl']) {
      expect(translations.en[key], key).toBeTruthy()
      expect(translations.es[key], key).toBeTruthy()
      expect(translations.es[key]).not.toBe(translations.en[key])
    }
  })
})
