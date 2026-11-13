/**
 * Sport-Specific Settings Engine.
 * Controls valid roster slots, scoring settings, player pools, and draft options per sport.
 */

export {
  getRulesForSport,
  getValidRosterSlotNames,
  getValidPositions,
  getAllowedDraftTypesForSport,
  isDraftTypeAllowedForSport,
  isSportSupported,
  getSupportedSports,
} from './SportRulesEngine'
export type {
  SportKey,
  SportRules,
  RosterRules,
  RosterSlotRule,
  ScoringRules,
  PlayerPoolRules,
  DraftOptionRules,
} from './types'
