import type { SportConfigFull } from '../types'

/** Keys aligned with `mlbAdapter` / legacy redraft stat lines. */
export const MLB_CONFIG: SportConfigFull = {
  sport: 'MLB',
  displayName: 'MLB Baseball',
  slug: 'mlb',
  defaultScoringSystem: 'categories',
  lineupFrequency: 'daily',
  hasBye: false,

  scoringCategories: [
    { key: 'r', label: 'Runs', defaultPoints: 1, isToggleable: false, group: 'hitting', sport: 'MLB' },
    { key: 'hr', label: 'Home Runs', defaultPoints: 4, isToggleable: false, group: 'hitting', sport: 'MLB' },
    { key: 'rbi', label: 'RBI', defaultPoints: 1, isToggleable: false, group: 'hitting', sport: 'MLB' },
    { key: 'sb', label: 'Stolen Bases', defaultPoints: 2, isToggleable: true, group: 'hitting', sport: 'MLB' },
    { key: 'avg', label: 'Batting Average', defaultPoints: 0, isToggleable: true, group: 'hitting', sport: 'MLB' },
    { key: 'tb', label: 'Total Bases', defaultPoints: 0.5, isToggleable: true, group: 'hitting', sport: 'MLB' },
    { key: 'bb', label: 'Walks (Batter)', defaultPoints: 0.5, isToggleable: true, group: 'hitting', sport: 'MLB' },
    { key: 'w', label: 'Win', defaultPoints: 5, isToggleable: false, group: 'pitching', sport: 'MLB' },
    { key: 'sv', label: 'Save', defaultPoints: 5, isToggleable: false, group: 'pitching', sport: 'MLB' },
    { key: 'so', label: 'Strikeouts', defaultPoints: 1, isToggleable: false, group: 'pitching', sport: 'MLB' },
    { key: 'era', label: 'ERA (category)', defaultPoints: -1, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'ip', label: 'Innings Pitched', defaultPoints: 1, isToggleable: true, group: 'pitching', sport: 'MLB', unit: 'per_inning' },
    { key: 'qs', label: 'Quality Start', defaultPoints: 4, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'l', label: 'Loss', defaultPoints: -5, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'er', label: 'Earned Runs', defaultPoints: -1, isToggleable: true, group: 'pitching', sport: 'MLB' },
    /*
     * Per-game stats the scoring panel offers and the Rolling Insights box score carries. Batting and
     * pitching share raw field names (`H`, `HR`, `BB`, `R`, `1B`…), so pitching keys are prefixed
     * `p_` and batter strikeouts are `bat_so` — `so` stays PITCHER strikeouts. A two-way player's
     * two box lines then sum into one week without a collision.
     *
     * Defaults: singles/doubles/triples are 0 because `tb` already scores them (no double count);
     * a league that scores hits by type does it through its panel, which sets `tb` to 0. Holds and
     * batter strikeouts carry the panel's AllFantasy defaults (3, -1). Everything else is 0 until a
     * league's panel says otherwise (see uiScoringStoreBridge.ts).
     */
    { key: 'single', label: 'Singles', defaultPoints: 0, isToggleable: true, group: 'hitting', sport: 'MLB' },
    { key: 'double', label: 'Doubles', defaultPoints: 0, isToggleable: true, group: 'hitting', sport: 'MLB' },
    { key: 'triple', label: 'Triples', defaultPoints: 0, isToggleable: true, group: 'hitting', sport: 'MLB' },
    { key: 'bat_so', label: 'Strikeouts (Batter)', defaultPoints: -1, isToggleable: true, group: 'hitting', sport: 'MLB' },
    { key: 'hbp', label: 'Hit By Pitch', defaultPoints: 0, isToggleable: true, group: 'hitting', sport: 'MLB' },
    { key: 'ibb', label: 'Intentional Walks', defaultPoints: 0, isToggleable: true, group: 'hitting', sport: 'MLB' },
    { key: 'cs', label: 'Caught Stealing', defaultPoints: 0, isToggleable: true, group: 'hitting', sport: 'MLB' },
    { key: 'hld', label: 'Hold', defaultPoints: 3, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'bs', label: 'Blown Save', defaultPoints: 0, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'outs', label: 'Outs Recorded', defaultPoints: 0, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'p_h', label: 'Hits Allowed', defaultPoints: 0, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'p_r', label: 'Runs Allowed', defaultPoints: 0, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'p_bb', label: 'Walks Allowed', defaultPoints: 0, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'p_hbp', label: 'Hit Batters', defaultPoints: 0, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'p_hr', label: 'Home Runs Allowed', defaultPoints: 0, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'wp', label: 'Wild Pitches', defaultPoints: 0, isToggleable: true, group: 'pitching', sport: 'MLB' },
    { key: 'bk', label: 'Balks', defaultPoints: 0, isToggleable: true, group: 'pitching', sport: 'MLB' },
  ],

  scoringPresets: [{ name: 'Standard', categories: [] }],

  defaultRosterSlots: [
    { key: 'C', label: 'Catcher', eligiblePositions: ['C'], defaultCount: 1, minCount: 0, maxCount: 2, isOptional: false },
    { key: '1B', label: 'First Base', eligiblePositions: ['1B'], defaultCount: 1, minCount: 0, maxCount: 2, isOptional: false },
    { key: '2B', label: 'Second Base', eligiblePositions: ['2B'], defaultCount: 1, minCount: 0, maxCount: 2, isOptional: false },
    { key: '3B', label: 'Third Base', eligiblePositions: ['3B'], defaultCount: 1, minCount: 0, maxCount: 2, isOptional: false },
    { key: 'SS', label: 'Shortstop', eligiblePositions: ['SS'], defaultCount: 1, minCount: 0, maxCount: 2, isOptional: false },
    { key: 'OF', label: 'Outfield', eligiblePositions: ['OF', 'LF', 'CF', 'RF'], defaultCount: 3, minCount: 2, maxCount: 5, isOptional: false },
    { key: 'UTIL', label: 'Utility', eligiblePositions: ['1B', '2B', '3B', 'SS', 'OF', 'C'], defaultCount: 1, minCount: 0, maxCount: 2, isOptional: true },
    { key: 'SP', label: 'Starting Pitcher', eligiblePositions: ['SP'], defaultCount: 4, minCount: 2, maxCount: 7, isOptional: false },
    { key: 'RP', label: 'Relief Pitcher', eligiblePositions: ['RP'], defaultCount: 2, minCount: 0, maxCount: 5, isOptional: true },
    { key: 'P', label: 'Pitcher (SP/RP)', eligiblePositions: ['SP', 'RP'], defaultCount: 0, minCount: 0, maxCount: 4, isOptional: true },
  ],

  defaultBenchSlots: 5,
  defaultIRSlots: 2,
  defaultTaxiSlots: 0,
  defaultDevySlots: 0,

  positionEligibility: {
    C: ['C', 'UTIL'],
    '1B': ['1B', 'UTIL'],
    '2B': ['2B', 'UTIL'],
    '3B': ['3B', 'UTIL'],
    SS: ['SS', 'UTIL'],
    OF: ['OF', 'UTIL'],
    LF: ['OF', 'UTIL'],
    CF: ['OF', 'UTIL'],
    RF: ['OF', 'UTIL'],
    SP: ['SP', 'P'],
    RP: ['RP', 'P'],
  },

  defaultSeasonWeeks: 23,
  defaultPlayoffStartWeek: 22,
  defaultPlayoffTeams: 4,
  defaultMatchupPeriodDays: 7,
  lineupLockType: 'daily',

  supportsRedraft: true,
  supportsDynasty: true,
  supportsKeeper: true,
  supportsDevy: false,
  supportsC2C: false,
  supportsIDP: false,
  supportsSuperflex: false,
  supportsTEPremium: false,
  supportsPPR: false,
  supportsCategories: true,
  supportsDailyLineups: true,

  commissionerSettings: [
    {
      key: 'scoringMode',
      label: 'Scoring Mode',
      type: 'select',
      defaultValue: 'categories',
      options: [
        { value: 'categories', label: 'Category League' },
        { value: 'points', label: 'Points League' },
      ],
      section: 'scoring',
      locksAfterStart: true,
    },
    { key: 'ilSlots', label: 'IL Slots', type: 'number', defaultValue: 2, min: 0, max: 5, section: 'roster' },
    { key: 'benchSlots', label: 'Bench Slots', type: 'number', defaultValue: 5, min: 2, max: 10, section: 'roster' },
    { key: 'spCount', label: 'SP Slots', type: 'number', defaultValue: 4, min: 2, max: 7, section: 'roster' },
    { key: 'rpCount', label: 'RP Slots', type: 'number', defaultValue: 2, min: 0, max: 5, section: 'roster' },
    {
      key: 'seasonWeeks',
      label: 'Regular Season Weeks',
      type: 'number',
      defaultValue: 21,
      min: 15,
      max: 25,
      section: 'schedule',
      locksAfterStart: true,
    },
  ],

  aiMetadata: {
    scoringStyle: 'categories',
    keyPositions: ['SP', '1B', 'SS', 'OF'],
    lineupNotes: 'Daily lineups. Rain delays and postponements affect scoring windows.',
    pitcherNotes: 'Streaming SPs is a core strategy. WHIP/ERA categories matter.',
  },
}
