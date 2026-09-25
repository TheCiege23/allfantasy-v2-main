import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A NON-NFL COMMISSIONER'S SCORING EDITS NEVER CHANGED A SCORE. The NHL / NBA / NCAAB / soccer
 * panels save their own key namespace; the scorer read only the engine's, bridging NFL alone.
 * These pin the bridge: its keys are real on both sides, the scorer applies it, the canonical store
 * still wins, and NFL / MLB / NCAAF behave exactly as before.
 */

const db = vi.hoisted(() => ({ league: { findFirst: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { calculateScoreFromSportConfig } from '@/lib/redraft/scoringEngine'
import { UI_SCORING_STORES, bridgeSportUiScoringStore } from '@/lib/redraft/uiScoringStoreBridge'
import { getScoringCategories } from '@/lib/sportConfig'
import { buildFullNhlScoringConfig } from '@/lib/nhl-scoring/NhlScoringPresets'
import { buildFullScoringConfig as buildFullNbaScoringConfig } from '@/lib/nba-scoring/NbaScoringPresets'
import { buildFullNcaabScoringConfig } from '@/lib/ncaab-scoring/NcaabScoringPresets'
import { buildFullSoccerScoringConfig } from '@/lib/soccer-scoring/SoccerScoringPresets'

const UI_DEFAULTS: Record<string, Record<string, number>> = {
  NHL: buildFullNhlScoringConfig('af_default' as never),
  NBA: buildFullNbaScoringConfig('af_default' as never),
  NCAAB: buildFullNcaabScoringConfig('af_default' as never),
  SOCCER: buildFullSoccerScoringConfig('af_default' as never),
}

function league(sport: string, settings: Record<string, unknown>) {
  db.league.findFirst.mockResolvedValue({ sport, settings })
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

  it('NCAAF is not bridged yet (its create path seeds full PPR regardless of the manager’s choice)', () => {
    expect(bridgeSportUiScoringStore('NCAAF', { ncaaf_scoring_config: { rules: { reception: 1 } } })).toBeNull()
  })
})
