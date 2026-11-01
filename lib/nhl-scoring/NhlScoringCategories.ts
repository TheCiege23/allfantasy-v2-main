/**
 * lib/nhl-scoring/NhlScoringCategories.ts
 * Complete NHL scoring category definitions for the commissioner panel.
 * Organised into 9 tabs across 4 groups:
 *   SKATERS:  Offense | Defense | Discipline
 *   GOALIES:  Goalie Core | Goalie Efficiency | Goalie Bonuses
 *   GLOBAL:   Bonuses | Misc
 *   PREMIUM:  Advanced (analytics — gated)
 */

export interface NhlScoringRow {
  key: string
  label: string
  helper?: string
  premium?: boolean
  defaultValue: number
  /**
   * The stats feed (Rolling Insights `live` box, contracts/rolling-insights/fixtures/live.NHL.json)
   * carries nothing this row could be counted from, so it never scores. The panel shows it locked
   * at 0 rather than inviting a commissioner to set a value the engine would ignore.
   */
  unavailable?: boolean
}

export interface NhlScoringCategory {
  id: string
  label: string
  /** 'skaters' | 'goalies' | 'global' | 'premium' */
  group: string
  rows: NhlScoringRow[]
}

// ============================================================
// SKATERS
// ============================================================

const OFFENSE: NhlScoringCategory = {
  id: 'offense',
  label: 'Offense',
  group: 'skaters',
  rows: [
    { key: 'goals',                  label: 'Goal',                    defaultValue: 3 },
    { key: 'assists',                label: 'Assist',                  defaultValue: 2 },
    { key: 'points',                 label: 'Point (combined)',        helper: 'Optional combined goal+assist stat', defaultValue: 0 },
    { key: 'power_play_goals',       label: 'Power Play Goal',         helper: 'Bonus on top of goal value', defaultValue: 0 },
    { key: 'power_play_assists',     label: 'Power Play Assist',       helper: 'Bonus on top of assist value', defaultValue: 0 },
    { key: 'power_play_points',      label: 'Power Play Point',        helper: 'Use instead of individual PP goal/assist', defaultValue: 0 },
    { key: 'short_handed_goals',     label: 'Short-Handed Goal',       helper: 'Bonus on top of goal value', defaultValue: 0 },
    { key: 'short_handed_assists',   label: 'Short-Handed Assist',     helper: 'Bonus on top of assist value', defaultValue: 0 },
    { key: 'short_handed_points',    label: 'Short-Handed Point',      helper: 'Use instead of individual SHG/SHA', defaultValue: 0 },
    { key: 'game_winning_goals',     label: 'Game-Winning Goal',       helper: 'Bonus on top of goal value', defaultValue: 0, unavailable: true },
    { key: 'overtime_goals',         label: 'Overtime Goal',           defaultValue: 0, unavailable: true },
    { key: 'shots_on_goal',          label: 'Shots on Goal',           defaultValue: 0.5 },
    { key: 'shooting_pct_bonus',     label: 'Shooting % Bonus',        helper: 'Per game: bonus per point of shooting percentage above 10% (min. 4 shots on goal)', defaultValue: 0 },
    { key: 'faceoff_wins',           label: 'Faceoff Wins',            defaultValue: 0 },
    { key: 'faceoff_losses',         label: 'Faceoff Losses',          defaultValue: 0 },
  ],
}

const DEFENSE: NhlScoringCategory = {
  id: 'defense',
  label: 'Defense',
  group: 'skaters',
  rows: [
    { key: 'blocked_shots',  label: 'Blocked Shots', defaultValue: 0.5 },
    { key: 'hits',           label: 'Hits',          defaultValue: 0.3 },
    { key: 'takeaways',      label: 'Takeaways',     defaultValue: 0 },
    { key: 'giveaways',      label: 'Giveaways',     defaultValue: 0 },
    { key: 'plus_minus',     label: 'Plus/Minus',    defaultValue: 1 },
  ],
}

const DISCIPLINE: NhlScoringCategory = {
  id: 'discipline',
  label: 'Discipline',
  group: 'skaters',
  rows: [
    { key: 'penalty_minutes',  label: 'Penalty Minutes',  helper: 'Per penalty minute (negative recommended)', defaultValue: -0.25 },
    { key: 'minor_penalty',    label: 'Minor Penalty',    helper: 'Per 2-minute minor', defaultValue: 0, unavailable: true },
    { key: 'major_penalty',    label: 'Major Penalty',    helper: 'Per 5-minute major', defaultValue: 0, unavailable: true },
    { key: 'misconduct',       label: 'Misconduct',       helper: 'Per 10-minute misconduct', defaultValue: 0, unavailable: true },
  ],
}

// ============================================================
// GOALIES
// ============================================================

const GOALIE_CORE: NhlScoringCategory = {
  id: 'goalie_core',
  label: 'Goalie Core',
  group: 'goalies',
  rows: [
    { key: 'goalie_wins',              label: 'Win',                  defaultValue: 5 },
    { key: 'goalie_losses',            label: 'Loss',                 defaultValue: 0 },
    { key: 'overtime_losses',          label: 'Overtime/Shootout Loss', defaultValue: 0 },
    { key: 'saves',                    label: 'Save',                 defaultValue: 0.2 },
    { key: 'goals_against',            label: 'Goal Against',         defaultValue: -1 },
    { key: 'shots_against',            label: 'Shots Against',        helper: 'Use instead of separate saves/GA', defaultValue: 0 },
    { key: 'empty_net_goals_against',  label: 'Empty Net Goal Against', defaultValue: 0, unavailable: true },
    { key: 'goalie_goals',             label: 'Goalie Goal',          defaultValue: 0, unavailable: true },
    { key: 'goalie_assists',           label: 'Goalie Assist',        defaultValue: 0, unavailable: true },
    { key: 'goalie_penalty_minutes',   label: 'Goalie Penalty Minutes', defaultValue: 0, unavailable: true },
  ],
}

const GOALIE_EFFICIENCY: NhlScoringCategory = {
  id: 'goalie_efficiency',
  label: 'Goalie Efficiency',
  group: 'goalies',
  rows: [
    { key: 'shutouts',              label: 'Shutout',                   defaultValue: 5 },
    { key: 'save_pct_bonus',        label: 'Save % Bonus',              helper: 'Per game: bonus per 0.010 save % above .900 (min. 20 shots faced)', defaultValue: 0 },
    { key: 'gaa_bonus',             label: 'GAA Bonus',                 helper: 'Per game with a GAA below 2.50 (min. 40 minutes in goal)', defaultValue: 0 },
    { key: 'goalie_minutes_played', label: 'Time on Ice (minutes)',     helper: 'Points per minute played', defaultValue: 0 },
  ],
}

const GOALIE_BONUSES: NhlScoringCategory = {
  id: 'goalie_bonuses',
  label: 'Goalie Bonuses',
  group: 'goalies',
  rows: [
    { key: 'forty_save_game',       label: '40+ Save Game',       defaultValue: 0 },
    { key: 'fifty_save_game',       label: '50+ Save Game',       defaultValue: 0 },
    { key: 'overtime_win',          label: 'Overtime Win',         defaultValue: 0, unavailable: true },
    { key: 'shootout_win',          label: 'Shootout Win',         defaultValue: 0, unavailable: true },
  ],
}

// ============================================================
// GLOBAL
// ============================================================

const BONUSES: NhlScoringCategory = {
  id: 'bonuses',
  label: 'Bonuses',
  group: 'global',
  rows: [
    { key: 'hat_trick_bonus',            label: 'Hat Trick',                 defaultValue: 0 },
    { key: 'gordie_howe_hat_trick_bonus',label: 'Gordie Howe Hat Trick',     helper: 'Goal + Assist + Fight in same game', defaultValue: 0, unavailable: true },
    { key: 'three_assist_game',          label: '3+ Assist Game',            defaultValue: 0 },
    { key: 'five_point_game',            label: '5+ Point Game',             defaultValue: 0 },
    { key: 'multi_goal_game',            label: 'Multi-Goal Game (2+)',       defaultValue: 0 },
    { key: 'multi_assist_game',          label: 'Multi-Assist Game (2+)',     defaultValue: 0 },
    { key: 'ten_shot_game',              label: '10+ Shot Game',              defaultValue: 0 },
    { key: 'five_hit_game',              label: '5+ Hit Game',                defaultValue: 0 },
    { key: 'five_block_game',            label: '5+ Block Game',              defaultValue: 0 },
    { key: 'forty_save_game',            label: '40+ Save Game',              defaultValue: 0 },
    { key: 'fifty_save_game',            label: '50+ Save Game',              defaultValue: 0 },
  ],
}

const MISC: NhlScoringCategory = {
  id: 'misc',
  label: 'Misc',
  group: 'global',
  rows: [
    { key: 'empty_net_goal',    label: 'Empty Net Goal',    helper: 'Skater scores into empty net', defaultValue: 0, unavailable: true },
    { key: 'shootout_goal',     label: 'Shootout Goal',     defaultValue: 0 },
    { key: 'shootout_miss',     label: 'Shootout Miss',     defaultValue: 0, unavailable: true },
    { key: 'overtime_goals',    label: 'Overtime Goal',     defaultValue: 0, unavailable: true },
  ],
}

// ============================================================
// PREMIUM (Advanced Analytics — gated)
// ============================================================

export const NHL_PREMIUM_SCORING: NhlScoringCategory = {
  id: 'advanced',
  label: 'Advanced',
  group: 'premium',
  rows: [
    { key: 'corsi_bonus',           label: 'Corsi Bonus',              premium: true, helper: 'Shot attempt differential bonus (CF%)', defaultValue: 0, unavailable: true },
    { key: 'fenwick_bonus',         label: 'Fenwick Bonus',            premium: true, helper: 'Unblocked shot attempt differential (FF%)', defaultValue: 0, unavailable: true },
    { key: 'xg_bonus',              label: 'Expected Goals (xG)',      premium: true, helper: 'Bonus per expected goal generated', defaultValue: 0, unavailable: true },
    { key: 'xa_bonus',              label: 'Expected Assists (xA)',    premium: true, helper: 'Bonus per expected primary assist', defaultValue: 0, unavailable: true },
    { key: 'high_danger_chances',   label: 'High Danger Chances',      premium: true, helper: 'Bonus per high-danger scoring chance', defaultValue: 0, unavailable: true },
    { key: 'zone_starts_bonus',     label: 'Zone Starts Bonus',        premium: true, helper: 'Offensive zone start percentage bonus', defaultValue: 0, unavailable: true },
    { key: 'goalie_gsaa',           label: 'Goalie GSAA',              premium: true, helper: 'Goals Saved Above Average bonus', defaultValue: 0, unavailable: true },
    { key: 'goalie_xga',            label: 'Goalie xGA',               premium: true, helper: 'Expected Goals Against — bonus for outperforming', defaultValue: 0, unavailable: true },
  ],
}

// ============================================================
// EXPORTED COLLECTION
// ============================================================

export const NHL_SCORING_CATEGORIES: NhlScoringCategory[] = [
  // Skaters
  OFFENSE,
  DEFENSE,
  DISCIPLINE,
  // Goalies
  GOALIE_CORE,
  GOALIE_EFFICIENCY,
  GOALIE_BONUSES,
  // Global
  BONUSES,
  MISC,
]

/** All categories including premium */
export const NHL_ALL_SCORING_CATEGORIES: NhlScoringCategory[] = [
  ...NHL_SCORING_CATEGORIES,
  NHL_PREMIUM_SCORING,
]

/** Build a flat defaults map for every NHL stat key defined in categories */
export function buildNhlScoringDefaults(): Record<string, number> {
  const defaults: Record<string, number> = {}
  for (const cat of NHL_ALL_SCORING_CATEGORIES) {
    for (const row of cat.rows) {
      if (!(row.key in defaults)) defaults[row.key] = row.defaultValue
    }
  }
  return defaults
}

/** Rows that can never score — shown locked at 0. See `NhlScoringRow.unavailable`. */
export const NHL_UNAVAILABLE_SCORING_KEYS: ReadonlySet<string> = new Set(
  NHL_ALL_SCORING_CATEGORIES.flatMap((cat) => cat.rows.filter((row) => row.unavailable).map((row) => row.key)),
)
