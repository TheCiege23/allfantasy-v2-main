/**
 * Canonical lineup preference trait keys (stored in `UserLineupPreferenceTrait.traitId`).
 */
export const LINEUP_PREFERENCE_TRAIT_IDS = [
  'prefers_safe_floor',
  'prefers_high_ceiling',
  'prefers_veterans',
  'prefers_rookies',
  'prefers_star_power',
  'prefers_matchup_chasing',
  'prefers_consistency',
  'prefers_team_loyalty',
  'prefers_same_position_emergency',
] as const

export type LineupPreferenceTraitId = (typeof LINEUP_PREFERENCE_TRAIT_IDS)[number]

