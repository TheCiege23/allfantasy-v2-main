/**
 * The per-sport scoring panels' stores, translated into the engine's category keys.
 *
 * 🛑 A NON-NFL COMMISSIONER'S SCORING EDITS NEVER CHANGED A SCORE. The NHL / NBA / NCAAB / soccer
 * panels save `League.settings.<sport>_scoring_config.rules` in the panel's key namespace
 * (`goalie_wins`, `points_scored`, `gk_save`); the scorer (`calculateScoreFromSportConfig`) reads
 * `settings.sportConfig.categoryPoints` in the engine's (`g_win`, `pts`, `saves`) and, when that is
 * empty, bridged only the NFL panel. Nothing ever copied the other sports across, so every one of
 * those leagues scored the engine's built-in defaults while its settings page showed something
 * else — `af_default` NHL shows a goalie win at 3, the engine scored it 5.
 *
 * Read at scoring time, exactly like the NFL bridge, with the same precedence: a non-empty
 * `sportConfig.categoryPoints` wins outright; then the sport's panel store; then engine defaults.
 *
 * Maps are explicit and 1:1, checked against both key sets in tests. UI rows with no engine
 * category (faceoffs, FGA, minutes played…) are dropped, never invented. Units already agree —
 * both sides are points per unit — so there is no conversion.
 *
 * ⚠ DELIBERATELY ABSENT:
 *   - NCAAF: its create path seeds `ncaaf_scoring_config` as full PPR whatever reception scoring
 *     the manager chose, so bridging it would turn Half-PPR and Standard leagues into PPR. That
 *     seeding has to be fixed (and existing leagues backfilled) first.
 *   - MLB: the panel scores hits by type and sets total bases to 0; the engine has no per-type hit
 *     categories, so a bridge would score every non-HR hit as nothing.
 *   - Soccer `penalty_scored`: the engine's `goals` already counts a penalty goal.
 */

type Store = { settingsKey: string; keyMap: Readonly<Record<string, string>> }

export const UI_SCORING_STORES: Readonly<Record<string, Store>> = {
  NHL: {
    settingsKey: 'nhl_scoring_config',
    keyMap: {
      goals: 'g',
      assists: 'a',
      plus_minus: 'plusminus',
      shots_on_goal: 'sog',
      power_play_points: 'ppp',
      short_handed_points: 'shp',
      blocked_shots: 'blks',
      hits: 'hits',
      penalty_minutes: 'pim',
      goalie_wins: 'g_win',
      saves: 'g_sv',
      shutouts: 'g_so',
      goals_against: 'g_ga',
    },
  },
  NBA: {
    settingsKey: 'nba_scoring_config',
    keyMap: {
      points_scored: 'pts',
      rebound: 'reb',
      assist: 'ast',
      steal: 'stl',
      block: 'blk',
      turnover: 'to',
      three_point_made: 'threes',
      field_goals_made: 'fgm',
      free_throws_made: 'ftm',
      double_double: 'dbl_dbl',
      triple_double: 'trpl_dbl',
    },
  },
  NCAAB: {
    settingsKey: 'ncaab_scoring_config',
    keyMap: {
      points_scored: 'pts',
      rebound: 'reb',
      assist: 'ast',
      steal: 'stl',
      block: 'blk',
      turnover: 'to',
      three_point_made: 'threes',
    },
  },
  SOCCER: {
    settingsKey: 'soccer_scoring_config',
    keyMap: {
      goal: 'goals',
      assist: 'assists',
      clean_sheet: 'clean_sheet_def',
      gk_clean_sheet: 'clean_sheet_gk',
      gk_save: 'saves',
      yellow_card: 'yellow_card',
      red_card: 'red_card',
      own_goal: 'own_goal',
      penalty_missed: 'pen_miss',
      gk_penalty_save: 'pen_save',
    },
  },
}

/** Panel rules -> engine category points, for one sport. Non-numeric values are dropped. */
export function bridgeUiRulesForSport(sport: string, rules: Record<string, unknown>): Record<string, number> {
  const store = UI_SCORING_STORES[sport]
  if (!store) return {}
  const out: Record<string, number> = {}
  for (const [uiKey, engineKey] of Object.entries(store.keyMap)) {
    const value = Number(rules[uiKey])
    if (rules[uiKey] != null && Number.isFinite(value)) out[engineKey] = value
  }
  return out
}

/**
 * The engine overrides a league's panel store implies, or null when this sport has no bridged
 * store (the caller keeps its existing fallback). An absent store yields `{}` — engine defaults.
 */
export function bridgeSportUiScoringStore(sport: string, settings: unknown): Record<string, number> | null {
  const store = UI_SCORING_STORES[sport]
  if (!store) return null
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const raw = s[store.settingsKey]
  const rules = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).rules : null
  if (!rules || typeof rules !== 'object') return {}
  return bridgeUiRulesForSport(sport, rules as Record<string, unknown>)
}
