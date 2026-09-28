import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A NON-NFL COMMISSIONER'S SCORING EDITS NEVER CHANGED A SCORE. The NHL / NBA / NCAAB / soccer
 * panels save their own key namespace; the scorer read only the engine's, bridging NFL alone.
 * These pin the bridge: its keys are real on both sides, the scorer applies it, the canonical store
 * still wins, NFL and MLB behave exactly as before, and NCAAF reception follows the manager's pick
 * until a commissioner saves the panel.
 */

const db = vi.hoisted(() => ({ league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { calculateScoreFromSportConfig } from '@/lib/redraft/scoringEngine'
import { UI_SCORING_STORES, bridgeSportUiScoringStore } from '@/lib/redraft/uiScoringStoreBridge'
import { getScoringCategories } from '@/lib/sportConfig'
import { buildFullNhlScoringConfig } from '@/lib/nhl-scoring/NhlScoringPresets'
import { buildFullScoringConfig as buildFullNbaScoringConfig } from '@/lib/nba-scoring/NbaScoringPresets'
import { buildFullNcaabScoringConfig } from '@/lib/ncaab-scoring/NcaabScoringPresets'
import { buildFullSoccerScoringConfig } from '@/lib/soccer-scoring/SoccerScoringPresets'
import { buildFullNcaafScoringConfig } from '@/lib/ncaaf-scoring/NcaafScoringPresets'
import { applyDefaultNcaafScoringOnCreate, getLeagueNcaafScoringConfig } from '@/lib/ncaaf-scoring/NcaafScoringConfigService'

const UI_DEFAULTS: Record<string, Record<string, number>> = {
  NHL: buildFullNhlScoringConfig('af_default' as never),
  NBA: buildFullNbaScoringConfig('af_default' as never),
  NCAAB: buildFullNcaabScoringConfig('af_default' as never),
  SOCCER: buildFullSoccerScoringConfig('af_default' as never),
  NCAAF: buildFullNcaafScoringConfig('af_default'),
}

function league(sport: string, settings: Record<string, unknown>) {
  db.league.findFirst.mockResolvedValue({ sport, settings })
  db.league.findUnique.mockResolvedValue({ sport, settings })
}
const score = (stats: Record<string, number>, position?: string) =>
  calculateScoreFromSportConfig('L1', 'p1', 1, stats, position)

beforeEach(() => vi.clearAllMocks())

describe('the key maps are real on both sides', () => {
  for (const [sport, store] of Object.entries(UI_SCORING_STORES)) {
    it(`${sport}: every panel key exists in the panel's own config, every engine key is an engine category`, () => {
      const uiKeys = new Set(Object.keys(UI_DEFAULTS[sport]!))
      const engineKeys = new Set(getScoringCategories(sport).map((c) => c.key))
      const badUi = Object.keys(store.keyMap).filter((k) => !uiKeys.has(k))
      const badEngine = Object.values(store.keyMap).filter((k) => !engineKeys.has(k))
      expect({ badUi, badEngine }).toEqual({ badUi: [], badEngine: [] })
    })
  }

  it('soccer never maps penalty_scored — the engine’s goals already count a penalty goal', () => {
    expect(UI_SCORING_STORES.SOCCER!.keyMap).not.toHaveProperty('penalty_scored')
  })
})

describe('the scorer applies each sport’s panel store', () => {
  it('NHL: a goalie win scores what the panel says (3), not the engine default (5)', async () => {
    league('NHL', { nhl_scoring_config: { rules: UI_DEFAULTS.NHL } })
    expect(await score({ g_win: 1 })).toBe(3)
  })

  it('NBA: points and threes at the panel’s values', async () => {
    league('NBA', { nba_scoring_config: { rules: UI_DEFAULTS.NBA } })
    // 20 pts x 0.5 + 2 threes x 0.5
    expect(await score({ pts: 20, threes: 2 })).toBe(11)
  })

  it('NCAAB: a steal at the panel’s 2', async () => {
    league('NCAAB', { ncaab_scoring_config: { rules: UI_DEFAULTS.NCAAB } })
    expect(await score({ stl: 1 })).toBe(2)
  })

  it('SOCCER: a goalkeeper save and a penalty save at the panel’s values', async () => {
    // Edited values: soccer's af_default happens to equal the engine default for these two, and a
    // case the old scorer also passes would prove nothing.
    league('SOCCER', { soccer_scoring_config: { rules: { ...UI_DEFAULTS.SOCCER, gk_save: 1, gk_penalty_save: 8 } } })
    expect(await score({ saves: 4, pen_save: 1 })).toBe(4 * 1 + 8)
  })

  it('a commissioner edit moves the score', async () => {
    league('NHL', { nhl_scoring_config: { rules: { ...UI_DEFAULTS.NHL, goalie_wins: 7 } } })
    expect(await score({ g_win: 1 })).toBe(7)
  })

  it('the canonical sportConfig.categoryPoints still wins over the panel store', async () => {
    league('NHL', {
      sportConfig: { categoryPoints: { g_win: 9 } },
      nhl_scoring_config: { rules: UI_DEFAULTS.NHL },
    })
    expect(await score({ g_win: 1 })).toBe(9)
  })

  it('a league with no stored panel config keeps the engine defaults', async () => {
    league('NHL', {})
    const engineDefault = getScoringCategories('NHL').find((c) => c.key === 'g_win')!.defaultPoints
    expect(await score({ g_win: 1 })).toBe(engineDefault)
  })
})

describe('sports without a bridged store behave exactly as before', () => {
  it('NFL still reads its own panel store', async () => {
    league('NFL', { nfl_scoring_config: { rules: { passing_td: 6 } } })
    expect(await score({ pass_td: 1 })).toBe(6)
  })

  it('MLB is not bridged (the panel’s hit-by-type scoring has no engine categories)', () => {
    expect(bridgeSportUiScoringStore('MLB', { mlb_scoring_config: { rules: { runs: 5 } } })).toBeNull()
  })

})

/**
 * 🛑 NCAAF WAS SEEDED FULL PPR WHATEVER THE MANAGER PICKED — the pick lived only in
 * `sportConfig.scoringPreset`. So a store no person has saved leaves reception to the pick, and a
 * store a commissioner saved scores exactly what they saved.
 */
describe('NCAAF', () => {
  const seededFullPpr = { rules: { ...UI_DEFAULTS.NCAAF, reception: 1 }, lastUpdatedBy: null }

  it('a store the system seeded full-PPR on a half-PPR league scores a catch at 0.5', async () => {
    league('NCAAF', { sportConfig: { scoringPreset: 'HALF_PPR' }, ncaaf_scoring_config: seededFullPpr })
    expect(await score({ rec: 2 })).toBe(1)
  })

  it('a store the system seeded on a standard league scores a catch at 0', async () => {
    league('NCAAF', { sportConfig: { scoringPreset: 'STANDARD' }, ncaaf_scoring_config: seededFullPpr })
    expect(await score({ rec: 2 })).toBe(0)
  })

  it('a commissioner’s saved values score — reception and passing TD alike', async () => {
    league('NCAAF', {
      sportConfig: { scoringPreset: 'PPR' },
      ncaaf_scoring_config: { rules: { ...UI_DEFAULTS.NCAAF, reception: 0, passing_td: 6 }, lastUpdatedBy: 'user-1' },
    })
    expect(await score({ rec: 3 })).toBe(0)
    expect(await score({ pass_td: 2 })).toBe(12)
  })

  it('a saved two-point value applies to the engine’s single two-point category', async () => {
    league('NCAAF', {
      ncaaf_scoring_config: {
        rules: { ...UI_DEFAULTS.NCAAF, passing_2pt: 3, rushing_2pt: 3, receiving_2pt: 3 },
        lastUpdatedBy: 'user-1',
      },
    })
    expect(await score({ two_pt: 1 })).toBe(3)
  })

  it('create seeds the store with the manager’s reception pick, not full PPR', async () => {
    db.league.findUnique.mockResolvedValue({ settings: {} })
    await applyDefaultNcaafScoringOnCreate('L1', 0.5)
    const written = db.league.update.mock.calls[0]![0].data.settings.ncaaf_scoring_config
    expect(written.rules.reception).toBe(0.5)
    expect(written.lastUpdatedBy).toBeNull()
  })

  it('the settings page shows the reception that scores', async () => {
    league('NCAAF', { sportConfig: { scoringPreset: 'HALF_PPR' }, ncaaf_scoring_config: seededFullPpr })
    expect((await getLeagueNcaafScoringConfig('L1')).rules.reception).toBe(0.5)

    league('NCAAF', {
      sportConfig: { scoringPreset: 'HALF_PPR' },
      ncaaf_scoring_config: { rules: { ...UI_DEFAULTS.NCAAF, reception: 1 }, lastUpdatedBy: 'user-1' },
    })
    expect((await getLeagueNcaafScoringConfig('L1')).rules.reception).toBe(1)
  })
})
