import type { SportConfigFull } from '../types'

/** College football — mirrors NFL-style scoring with shorter season. */
export const NCAAF_CONFIG: SportConfigFull = {
  sport: 'NCAAF',
  displayName: 'NCAA Football',
  slug: 'ncaaf',
  defaultScoringSystem: 'points',
  lineupFrequency: 'weekly',
  hasBye: false,

  scoringCategories: [
    { key: 'pass_yds', label: 'Pass Yds', defaultPoints: 0.04, isToggleable: false, group: 'passing', sport: 'NCAAF', unit: 'per_yard' },
    { key: 'pass_td', label: 'Pass TD', defaultPoints: 4, isToggleable: false, group: 'passing', sport: 'NCAAF' },
    { key: 'pass_int', label: 'Interception', defaultPoints: -2, isToggleable: true, group: 'passing', sport: 'NCAAF' },
    { key: 'rush_yds', label: 'Rush Yds', defaultPoints: 0.1, isToggleable: false, group: 'rushing', sport: 'NCAAF', unit: 'per_yard' },
    { key: 'rush_td', label: 'Rush TD', defaultPoints: 6, isToggleable: false, group: 'rushing', sport: 'NCAAF' },
    { key: 'rec', label: 'Reception', defaultPoints: 1, isToggleable: true, group: 'receiving', sport: 'NCAAF' },
    { key: 'rec_yds', label: 'Rec Yds', defaultPoints: 0.1, isToggleable: false, group: 'receiving', sport: 'NCAAF', unit: 'per_yard' },
    { key: 'rec_td', label: 'Rec TD', defaultPoints: 6, isToggleable: false, group: 'receiving', sport: 'NCAAF' },
    { key: 'idp_solo', label: 'Solo Tackle', defaultPoints: 1, isToggleable: true, group: 'idp', sport: 'NCAAF', requiresToggle: 'IDP' },
    { key: 'idp_tackle', label: 'Total Tackles', defaultPoints: 0, isToggleable: true, group: 'idp', sport: 'NCAAF', requiresToggle: 'IDP' },
    { key: 'idp_sack', label: 'Sack', defaultPoints: 3, isToggleable: true, group: 'idp', sport: 'NCAAF', requiresToggle: 'IDP' },
    { key: 'idp_pd', label: 'Pass Defended', defaultPoints: 1, isToggleable: true, group: 'idp', sport: 'NCAAF', requiresToggle: 'IDP' },
    { key: 'idp_tfl', label: 'Tackle For Loss', defaultPoints: 1, isToggleable: true, group: 'idp', sport: 'NCAAF', requiresToggle: 'IDP' },
    { key: 'idp_td', label: 'Defensive TD', defaultPoints: 6, isToggleable: true, group: 'idp', sport: 'NCAAF', requiresToggle: 'IDP' },
    { key: 'idp_int', label: 'Interception', defaultPoints: 4, isToggleable: true, group: 'idp', sport: 'NCAAF', requiresToggle: 'IDP' },
    { key: 'idp_int_return_yards', label: 'Interception Return Yards', defaultPoints: 0, isToggleable: true, group: 'idp', sport: 'NCAAF', requiresToggle: 'IDP' },
    // Opt-in athlete return categories: importing a league supplies its actual weights.
    { key: 'kr_td', label: 'Kick Return TD', defaultPoints: 0, isToggleable: true, group: 'special', sport: 'NCAAF' },
    { key: 'pr_td', label: 'Punt Return TD', defaultPoints: 0, isToggleable: true, group: 'special', sport: 'NCAAF' },
    { key: 'fumble_td', label: 'Offensive Fumble Recovery TD', defaultPoints: 0, isToggleable: true, group: 'special', sport: 'NCAAF' },
    { key: 'te_premium', label: 'TE Reception Bonus', defaultPoints: 0, isToggleable: true, group: 'receiving', sport: 'NCAAF', requiresToggle: 'TE_PREMIUM' },
    { key: 'pass_2pt', label: 'Passing 2-Point Conversion', defaultPoints: 2, isToggleable: true, group: 'passing', sport: 'NCAAF' },
    { key: 'rush_2pt', label: 'Rushing 2-Point Conversion', defaultPoints: 2, isToggleable: true, group: 'rushing', sport: 'NCAAF' },
    { key: 'rec_2pt', label: 'Receiving 2-Point Conversion', defaultPoints: 2, isToggleable: true, group: 'receiving', sport: 'NCAAF' },
    { key: 'two_pt', label: '2-Point Conversion', defaultPoints: 2, isToggleable: true, group: 'special', sport: 'NCAAF' },
    { key: 'fg_made', label: 'Field Goal Made', defaultPoints: 3, isToggleable: true, group: 'kicking', sport: 'NCAAF' },
    { key: 'fg_miss', label: 'Field Goal Missed', defaultPoints: 0, isToggleable: true, group: 'kicking', sport: 'NCAAF' },
    { key: 'xp_miss', label: 'Extra Point Missed', defaultPoints: -1, isToggleable: true, group: 'kicking', sport: 'NCAAF' },
    { key: 'xp_made', label: 'Extra Point Made', defaultPoints: 1, isToggleable: true, group: 'kicking', sport: 'NCAAF' },
    { key: 'fum_lost', label: 'Fumble Lost', defaultPoints: -2, isToggleable: true, group: 'special', sport: 'NCAAF' },
    { key: 'def_td', label: 'Defense/Special Teams TD', defaultPoints: 6, isToggleable: true, group: 'defense', sport: 'NCAAF' },
    { key: 'def_int', label: 'Defense Interception', defaultPoints: 2, isToggleable: true, group: 'defense', sport: 'NCAAF' },
    { key: 'def_fr', label: 'Defense Fumble Recovery', defaultPoints: 2, isToggleable: true, group: 'defense', sport: 'NCAAF' },
    { key: 'def_sack', label: 'Defense Sack', defaultPoints: 1, isToggleable: true, group: 'defense', sport: 'NCAAF' },
  ],

  scoringPresets: [
    { name: 'College Half PPR', categories: [] },
    { name: 'College PPR', categories: [] },
    { name: 'College Standard', categories: [] },
  ],

  defaultRosterSlots: [
    { key: 'QB', label: 'Quarterback', eligiblePositions: ['QB'], defaultCount: 1, minCount: 1, maxCount: 2, isOptional: false },
    { key: 'RB', label: 'Running Back', eligiblePositions: ['RB'], defaultCount: 1, minCount: 1, maxCount: 4, isOptional: false },
    { key: 'WR', label: 'Wide Receiver', eligiblePositions: ['WR'], defaultCount: 2, minCount: 1, maxCount: 4, isOptional: false },
    { key: 'TE', label: 'Tight End', eligiblePositions: ['TE'], defaultCount: 1, minCount: 0, maxCount: 2, isOptional: false },
    { key: 'FLX', label: 'Flex', eligiblePositions: ['RB', 'WR', 'TE'], defaultCount: 0, minCount: 0, maxCount: 2, isOptional: true },
    { key: 'SF', label: 'Superflex', eligiblePositions: ['QB', 'RB', 'WR', 'TE'], defaultCount: 0, minCount: 0, maxCount: 1, isOptional: true },
    // Optional and off by default: no college team defense exists to draft, and an unfilled starter
    // slot fails lineup validation. A commissioner may still add one.
    { key: 'DEF', label: 'Team Defense', eligiblePositions: ['DEF', 'DST'], defaultCount: 0, minCount: 0, maxCount: 2, isOptional: true },
    { key: 'K', label: 'Kicker', eligiblePositions: ['K'], defaultCount: 0, minCount: 0, maxCount: 1, isOptional: true },
  ],

  defaultBenchSlots: 8,
  defaultIRSlots: 1,
  defaultTaxiSlots: 0,
  defaultDevySlots: 0,

  positionEligibility: {
    QB: ['QB', 'SF', 'SUPERFLEX', 'SUPER_FLEX'],
    RB: ['RB', 'FLX', 'FLEX', 'SF', 'SUPERFLEX', 'SUPER_FLEX'],
    WR: ['WR', 'FLX', 'FLEX', 'SF', 'SUPERFLEX', 'SUPER_FLEX'],
    TE: ['TE', 'FLX', 'FLEX', 'SF', 'SUPERFLEX', 'SUPER_FLEX'],
    K: ['K'],
    DEF: ['DEF'],
    DST: ['DEF'],
  },

  defaultSeasonWeeks: 13,
  defaultPlayoffStartWeek: 12,
  defaultPlayoffTeams: 4,
  defaultMatchupPeriodDays: 7,
  lineupLockType: 'per_player_kickoff',

  supportsRedraft: true,
  supportsDynasty: true,
  supportsKeeper: true,
  supportsDevy: true,
  supportsC2C: true,
  supportsIDP: true,
  supportsSuperflex: false,
  supportsTEPremium: false,
  supportsPPR: true,
  supportsCategories: false,
  supportsDailyLineups: false,

  commissionerSettings: [
    { key: 'seasonWeeks', label: 'Regular Season Weeks', type: 'number', defaultValue: 12, min: 8, max: 14, section: 'schedule', locksAfterStart: true },
    { key: 'benchSlots', label: 'Bench Slots', type: 'number', defaultValue: 8, min: 3, max: 12, section: 'roster' },
  ],

  aiMetadata: {
    scoringStyle: 'points',
    keyPositions: ['QB', 'RB', 'WR'],
    lineupNotes: 'Shorter season than NFL; playoff alignment with conference championships.',
  },
}
