import type { SportConfigFull } from '../types'
import { DAILY_SPORT_SEASON_SHAPE, playoffStartWeekFor, regularSeasonWeeksFor } from '@/lib/sportConfig/dailySportSeasonShape'
import { DAILY_REDRAFT_ROSTER_LAYOUTS, dailyRedraftReserveCount, dailyRedraftSlotCount } from '@/lib/sportConfig/dailySportRedraftRoster'

/** Default counts are the one redraft layout (lib/sportConfig/dailySportRedraftRoster.ts). */
const LAYOUT = DAILY_REDRAFT_ROSTER_LAYOUTS.MLB

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
    { key: 'C', label: 'Catcher', eligiblePositions: ['C'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'C'), minCount: 0, maxCount: 2, isOptional: false },
    { key: '1B', label: 'First Base', eligiblePositions: ['1B'], defaultCount: dailyRedraftSlotCount(LAYOUT, '1B'), minCount: 0, maxCount: 2, isOptional: false },
    { key: '2B', label: 'Second Base', eligiblePositions: ['2B'], defaultCount: dailyRedraftSlotCount(LAYOUT, '2B'), minCount: 0, maxCount: 2, isOptional: false },
    { key: '3B', label: 'Third Base', eligiblePositions: ['3B'], defaultCount: dailyRedraftSlotCount(LAYOUT, '3B'), minCount: 0, maxCount: 2, isOptional: false },
    { key: 'SS', label: 'Shortstop', eligiblePositions: ['SS'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'SS'), minCount: 0, maxCount: 2, isOptional: false },
    { key: 'CI', label: 'Corner Infield (1B/3B)', eligiblePositions: ['1B', '3B'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'CI'), minCount: 0, maxCount: 2, isOptional: true },
    { key: 'MI', label: 'Middle Infield (2B/SS)', eligiblePositions: ['2B', 'SS'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'MI'), minCount: 0, maxCount: 2, isOptional: true },
    { key: 'OF', label: 'Outfield', eligiblePositions: ['OF', 'LF', 'CF', 'RF'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'OF'), minCount: 2, maxCount: 5, isOptional: false },
    { key: 'UTIL', label: 'Utility', eligiblePositions: ['1B', '2B', '3B', 'SS', 'OF', 'C'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'UTIL'), minCount: 0, maxCount: 2, isOptional: true },
    { key: 'SP', label: 'Starting Pitcher', eligiblePositions: ['SP'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'SP'), minCount: 2, maxCount: 7, isOptional: false },
    { key: 'RP', label: 'Relief Pitcher', eligiblePositions: ['RP'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'RP'), minCount: 0, maxCount: 5, isOptional: true },
    { key: 'P', label: 'Pitcher (SP/RP)', eligiblePositions: ['SP', 'RP'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'P'), minCount: 0, maxCount: 4, isOptional: true },
  ],

  defaultBenchSlots: LAYOUT.benchSlots,
  defaultIRSlots: dailyRedraftReserveCount(LAYOUT),
  defaultTaxiSlots: 0,
  defaultDevySlots: 0,

  positionEligibility: {
    C: ['C', 'UTIL'],
    '1B': ['1B', 'CI', 'UTIL'],
    '2B': ['2B', 'MI', 'UTIL'],
    '3B': ['3B', 'CI', 'UTIL'],
    SS: ['SS', 'MI', 'UTIL'],
    OF: ['OF', 'UTIL'],
    LF: ['OF', 'UTIL'],
    CF: ['OF', 'UTIL'],
    RF: ['OF', 'UTIL'],
    SP: ['SP', 'P'],
    RP: ['RP', 'P'],
  },

  defaultSeasonWeeks: DAILY_SPORT_SEASON_SHAPE.MLB.totalWeeks,
  defaultPlayoffStartWeek: playoffStartWeekFor('MLB'),
  defaultPlayoffTeams: DAILY_SPORT_SEASON_SHAPE.MLB.playoffTeams,
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
    { key: 'ilSlots', label: 'IL Slots', type: 'number', defaultValue: LAYOUT.reserveSlots.IL ?? 0, min: 0, max: 5, section: 'roster' },
    { key: 'benchSlots', label: 'Bench Slots', type: 'number', defaultValue: LAYOUT.benchSlots, min: 2, max: 10, section: 'roster' },
    { key: 'spCount', label: 'SP Slots', type: 'number', defaultValue: dailyRedraftSlotCount(LAYOUT, 'SP'), min: 2, max: 7, section: 'roster' },
    { key: 'rpCount', label: 'RP Slots', type: 'number', defaultValue: dailyRedraftSlotCount(LAYOUT, 'RP'), min: 0, max: 5, section: 'roster' },
    {
      key: 'seasonWeeks',
      label: 'Regular Season Weeks',
      type: 'number',
      defaultValue: regularSeasonWeeksFor('MLB'),
      min: 15,
      max: DAILY_SPORT_SEASON_SHAPE.MLB.totalWeeks,
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
