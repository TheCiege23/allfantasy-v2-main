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
 * ⚠ NCAAF RECEPTION: until 2026-09-24 the create path seeded `ncaaf_scoring_config` as full PPR
 * whatever the manager picked (the pick lived only in `sportConfig.scoringPreset`). So for a store
 * no person has saved (`lastUpdatedBy` empty — the panel route always sets it, the seeder never
 * does) `rec` is left out and the league's picked preset governs reception. That fixes every
 * league seeded before the fix with no data backfill; once a commissioner saves the panel, the
 * value they saw and saved is the one that scores.
 *
 * ⚠ MLB: the panel scores hits BY TYPE and sets total bases to 0. Until the engine had per-type hit
 * categories a bridge would have scored every non-HR hit as nothing, so MLB was left out; it has
 * them now (`single`/`double`/`triple`, lib/sportConfig/configs/mlb.ts). MLB is also the one sport
 * whose panel store is NOT seeded at league creation — an untouched league's panel DISPLAYS the
 * AllFantasy default preset, so `defaultRules` makes that the store it scores, too. Otherwise the
 * page would show singles at 1 and innings at 3 while the engine scored total bases at 0.5 and
 * innings at 1.
 *   Panel rows no per-game box can supply are dropped, never invented: plate appearances, at-bats,
 *   sacrifice flies/bunts, grounded into double plays, cycle / grand slam / game-winning-RBI bonuses,
 *   save opportunities, complete games, shutouts, no-hitters, perfect games, pickoffs.
 *
 * ⚠ DELIBERATELY ABSENT:
 *   - Soccer `penalty_scored`: the engine's `goals` already counts a penalty goal.
 *   - Soccer rows the box score cannot supply (lib/scoring-runtime/soccerStatNormalization.ts): a
 *     fielder's `goal_conceded` (only keepers carry goals conceded), key passes, tackles, interceptions,
 *     clearances, dribbles, crosses, aerials, offsides, sub on/off, ratings, man of the match, the
 *     hat-trick bonus. And `clean_sheet` scores DEFENDERS only — the feed gives midfielders no
 *     clean-sheet flag, so the panel's "DEF/MID" label over-promises for MID.
 */
import { buildFullMlbScoringConfig } from '@/lib/mlb-scoring/MlbScoringPresets'
import { buildFullSoccerScoringConfig } from '@/lib/soccer-scoring/SoccerScoringPresets'

type Store = {
  settingsKey: string
  keyMap: Readonly<Record<string, string>>
  /** Leave `rec` to `sportConfig.scoringPreset` until a person saves this store (NCAAF). */
  receptionFromPresetUntilSaved?: boolean
  /** The rules an UNSAVED store scores — what the panel displays for a league nobody customized. */
  defaultRules?: () => Record<string, unknown>
}

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
      field_goals_attempted: 'fga',
      free_throws_attempted: 'fta',
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
    // The panel shows the AF default for a league nobody saved (getLeagueSoccerScoringConfig), so that
    // is what an unsaved league scores — not the engine's own defaults.
    defaultRules: () => buildFullSoccerScoringConfig('af_default'),
    keyMap: {
      shot_on_target: 'shots_on_target',
      shot: 'shots',
      minutes_played: 'minutes_played',
      appearance: 'appearance',
      gk_goals_against: 'gk_goals_against',
      foul_committed: 'fouls_committed',
      foul_drawn: 'fouls_drawn',
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
  NCAAF: {
    settingsKey: 'ncaaf_scoring_config',
    receptionFromPresetUntilSaved: true,
    // The engine has one two-point category; when the panel's three differ, the last present
    // (receiving) wins — the same collapse the NFL bridge makes.
    keyMap: {
      passing_yards: 'pass_yds',
      passing_td: 'pass_td',
      interception_thrown: 'pass_int',
      passing_2pt: 'two_pt',
      rushing_yards: 'rush_yds',
      rushing_td: 'rush_td',
      rushing_2pt: 'two_pt',
      reception: 'rec',
      receiving_yards: 'rec_yds',
      receiving_td: 'rec_td',
      receiving_2pt: 'two_pt',
      idp_solo_tackle: 'idp_solo',
      idp_tackle: 'idp_tackle',
      idp_sack: 'idp_sack',
      idp_pass_defended: 'idp_pd',
      idp_tackle_for_loss: 'idp_tfl',
      idp_td: 'idp_td',
      idp_interception: 'idp_int',
      idp_int_return_yards: 'idp_int_return_yards',
      fg_made: 'fg_made',
      pat_made: 'xp_made',
      fg_missed: 'fg_miss',
      pat_missed: 'xp_miss',
      fumble_lost: 'fum_lost',
      dst_td: 'def_td',
      dst_interception: 'def_int',
      dst_fumble_recovery: 'def_fr',
      dst_sack: 'def_sack',
    },
  },
  MLB: {
    settingsKey: 'mlb_scoring_config',
    defaultRules: () => buildFullMlbScoringConfig('af_default'),
    // Batting and pitching share vendor field names; the engine keeps them apart (`bat_so` vs `so`,
    // `p_*` for what a pitcher allowed) — see lib/scoring-runtime/mlbStatNormalization.ts.
    keyMap: {
      runs: 'r',
      singles: 'single',
      doubles: 'double',
      triples: 'triple',
      home_runs: 'hr',
      total_bases: 'tb',
      rbis: 'rbi',
      walks: 'bb',
      intentional_walks: 'ibb',
      hit_by_pitch: 'hbp',
      strikeouts: 'bat_so',
      stolen_bases: 'sb',
      caught_stealing: 'cs',
      innings_pitched: 'ip',
      outs_recorded: 'outs',
      pitch_strikeouts: 'so',
      wins: 'w',
      losses: 'l',
      saves: 'sv',
      holds: 'hld',
      blown_saves: 'bs',
      quality_starts: 'qs',
      earned_runs: 'er',
      runs_allowed: 'p_r',
      hits_allowed: 'p_h',
      walks_allowed: 'p_bb',
      hit_batters: 'p_hbp',
      home_runs_allowed: 'p_hr',
      wild_pitches: 'wp',
      balks: 'bk',
    },
  },
}

/** Points per reception the league's `sportConfig.scoringPreset` implies, or null (custom/unset). */
export function receptionPointsForSportConfigPreset(settings: unknown): number | null {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const sc = s.sportConfig && typeof s.sportConfig === 'object' ? (s.sportConfig as Record<string, unknown>) : {}
  const preset = sc.scoringPreset
  return preset === 'PPR' ? 1 : preset === 'HALF_PPR' ? 0.5 : preset === 'STANDARD' ? 0 : null
}

/** Whether a person ever saved this panel store (the seeder writes `lastUpdatedBy: null`). */
export function storeSavedByPerson(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const by = (raw as Record<string, unknown>).lastUpdatedBy
  return typeof by === 'string' && by.trim().length > 0
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
  const stored = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).rules : null
  const rules = stored && typeof stored === 'object' ? stored : store.defaultRules?.() ?? null
  if (!rules || typeof rules !== 'object') return {}
  const out = bridgeUiRulesForSport(sport, rules as Record<string, unknown>)
  if (store.receptionFromPresetUntilSaved && !storeSavedByPerson(raw)) delete out.rec
  return out
}
