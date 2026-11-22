/**
 * Documented rules for User Lineup Preference Learning (tie-breakers only).
 */

export const LINEUP_PREFERENCE_UPDATE_RULES = {
  title: 'Update rules',
  bullets: [
    'Reinforcement strength scales down when the accepted Chimmy edge was large (objective-first).',
    'Close-call accepts strengthen implied traits; rejects penalize Chimmy-implied traits and reinforce user-aligned traits.',
    'Bench promotions bump position trust metadata and archetype traits (veteran/rookie/star/streamer).',
    'Auto-sub allow/deny events adjust allows_auto_sub; injury contingency events adjust injury_contingency_trust.',
    'Each update caps confidence in [0, 1], increments sample size, appends a short example (max 8 kept).',
  ],
} as const

export const LINEUP_PREFERENCE_DECAY_RULES = {
  title: 'Decay rules',
  bullets: [
    'Confidence decays exponentially by days since last reinforcement (approximately 1.5% per idle day).',
    'Traits with no reinforcement still decay from their last activity timestamp.',
    'Decay never removes a trait row; it only softens confidence until the next reinforcement.',
  ],
  /** Applied in engine: confidence *= DECAY_BASE_PER_DAY ^ daysIdle */
  DECAY_BASE_PER_DAY: 0.985,
} as const

export const LINEUP_PREFERENCE_TIEBREAKER_RULES = {
  title: 'Tie-breaker rules',
  bullets: [
    'Learned preferences never override a strong objective projection edge in the lineup optimizer.',
    'Preference weight scales with average trait confidence but is capped (default max ~0.45).',
    'Replacement / close-call paths use preference dimensions only when candidate scores are within a narrow band.',
    'Position-trust metadata nudges same-position comparisons slightly when all else is equal.',
  ],
  maxPreferenceWeight: 0.45,
  closeCallBand: 3,
} as const

export const LINEUP_PREFERENCE_EXAMPLE_USE = {
  title: 'Example use in lineup decisions',
  bullets: [
    'Weekly Start Score + mode objective runs first; preference profile supplies small deltas on ties.',
    'Safe-floor vs ceiling traits shift close calls between similarly projected WRs.',
    'Team loyalty nudges starters when projections are within the tie band and Vegas/matchup data is flat.',
    'Same-position emergency preference reinforces auto-sub picks that match user history when two bench options tie.',
  ],
} as const
