import type { SportConfigFull } from '../types'

/** Keys aligned with `soccerAdapter`. */
export const SOCCER_CONFIG: SportConfigFull = {
  sport: 'SOCCER',
  displayName: 'Soccer',
  slug: 'soccer',
  defaultScoringSystem: 'points',
  lineupFrequency: 'per_match',
  hasBye: false,

  scoringCategories: [
    { key: 'goals', label: 'Goals', defaultPoints: 6, isToggleable: false, group: 'attack', sport: 'SOCCER' },
    { key: 'assists', label: 'Assists', defaultPoints: 3, isToggleable: false, group: 'attack', sport: 'SOCCER' },
    { key: 'clean_sheet_def', label: 'Clean Sheet (DEF)', defaultPoints: 4, isToggleable: true, group: 'defense', sport: 'SOCCER' },
    { key: 'clean_sheet_gk', label: 'Clean Sheet (GK)', defaultPoints: 4, isToggleable: true, group: 'goalie', sport: 'SOCCER' },
    { key: 'saves', label: 'Saves', defaultPoints: 0.5, isToggleable: true, group: 'goalie', sport: 'SOCCER' },
    { key: 'yellow_card', label: 'Yellow Card', defaultPoints: -1, isToggleable: true, group: 'discipline', sport: 'SOCCER' },
    { key: 'red_card', label: 'Red Card', defaultPoints: -3, isToggleable: true, group: 'discipline', sport: 'SOCCER' },
    { key: 'own_goal', label: 'Own Goal', defaultPoints: -2, isToggleable: true, group: 'negative', sport: 'SOCCER' },
    { key: 'pen_miss', label: 'Penalty Miss', defaultPoints: -2, isToggleable: true, group: 'negative', sport: 'SOCCER' },
    { key: 'pen_save', label: 'Penalty Save (GK)', defaultPoints: 5, isToggleable: true, group: 'goalie', sport: 'SOCCER' },
    // What the scoring panel offers and the box score carries (soccerStatNormalization.ts). Zero by
    // default so a league on engine defaults scores exactly as before; the panel sets them.
    { key: 'shots_on_target', label: 'Shots on Target', defaultPoints: 0, isToggleable: true, group: 'attack', sport: 'SOCCER' },
    { key: 'shots', label: 'Shots', defaultPoints: 0, isToggleable: true, group: 'attack', sport: 'SOCCER' },
    { key: 'minutes_played', label: 'Minutes Played', defaultPoints: 0, isToggleable: true, group: 'general', sport: 'SOCCER' },
    { key: 'appearance', label: 'Appearance', defaultPoints: 0, isToggleable: true, group: 'general', sport: 'SOCCER' },
    { key: 'gk_goals_against', label: 'Goals Against (GK)', defaultPoints: 0, isToggleable: true, group: 'goalie', sport: 'SOCCER' },
    { key: 'fouls_committed', label: 'Fouls Committed', defaultPoints: 0, isToggleable: true, group: 'discipline', sport: 'SOCCER' },
    { key: 'fouls_drawn', label: 'Fouls Drawn', defaultPoints: 0, isToggleable: true, group: 'general', sport: 'SOCCER' },
  ],

  scoringPresets: [{ name: 'FPL-style', categories: [] }],

  defaultRosterSlots: [
    { key: 'GK', label: 'Goalkeeper', eligiblePositions: ['GK'], defaultCount: 1, minCount: 1, maxCount: 2, isOptional: false },
    { key: 'DEF', label: 'Defenders', eligiblePositions: ['DEF', 'D'], defaultCount: 4, minCount: 3, maxCount: 5, isOptional: false },
    { key: 'MID', label: 'Midfielders', eligiblePositions: ['MID', 'M'], defaultCount: 4, minCount: 3, maxCount: 5, isOptional: false },
    { key: 'FWD', label: 'Forwards', eligiblePositions: ['FWD', 'F'], defaultCount: 2, minCount: 1, maxCount: 3, isOptional: false },
  ],

  defaultBenchSlots: 4,
  defaultIRSlots: 0,
  defaultTaxiSlots: 0,
  defaultDevySlots: 0,

  positionEligibility: {
    GK: ['GK'],
    DEF: ['DEF'],
    D: ['DEF'],
    MID: ['MID'],
    M: ['MID'],
    FWD: ['FWD'],
    F: ['FWD'],
  },

  defaultSeasonWeeks: 38,
  defaultPlayoffStartWeek: 35,
  defaultPlayoffTeams: 4,
  defaultMatchupPeriodDays: 7,
  lineupLockType: 'per_event',

  supportsRedraft: true,
  supportsDynasty: true,
  supportsKeeper: true,
  supportsDevy: false,
  supportsC2C: false,
  supportsIDP: false,
  supportsSuperflex: false,
  supportsTEPremium: false,
  supportsPPR: false,
  supportsCategories: false,
  supportsDailyLineups: true,

  commissionerSettings: [
    { key: 'doubleGameweekMode', label: 'Highlight double gameweeks', type: 'toggle', defaultValue: true, section: 'schedule' },
    { key: 'benchSlots', label: 'Bench Slots', type: 'number', defaultValue: 4, min: 2, max: 8, section: 'roster' },
  ],

  aiMetadata: {
    scoringStyle: 'points',
    keyPositions: ['FWD', 'MID', 'GK'],
    lineupNotes: 'Gameweek-based; double gameweeks and blanks drive strategy.',
  },
}
