import type { SportConfigFull } from '../types'
import { DAILY_SPORT_SEASON_SHAPE, playoffStartWeekFor, regularSeasonWeeksFor } from '@/lib/sportConfig/dailySportSeasonShape'
import { DAILY_REDRAFT_ROSTER_LAYOUTS, dailyRedraftReserveCount, dailyRedraftSlotCount } from '@/lib/sportConfig/dailySportRedraftRoster'

/** Default counts are the one redraft layout (lib/sportConfig/dailySportRedraftRoster.ts). */
const LAYOUT = DAILY_REDRAFT_ROSTER_LAYOUTS.NHL

/** Stat keys aligned with `nhlAdapter` (g, a, ppp, sog, hits, blks). */
export const NHL_CONFIG: SportConfigFull = {
  sport: 'NHL',
  displayName: 'NHL Hockey',
  slug: 'nhl',
  defaultScoringSystem: 'points',
  lineupFrequency: 'daily',
  hasBye: false,

  scoringCategories: [
    { key: 'g', label: 'Goal', defaultPoints: 3, isToggleable: false, group: 'offense', sport: 'NHL' },
    { key: 'a', label: 'Assist', defaultPoints: 2, isToggleable: false, group: 'offense', sport: 'NHL' },
    { key: 'plusminus', label: '+/-', defaultPoints: 0.5, isToggleable: true, group: 'defense', sport: 'NHL' },
    { key: 'sog', label: 'Shots on Goal', defaultPoints: 0.3, isToggleable: true, group: 'offense', sport: 'NHL' },
    { key: 'ppp', label: 'Power Play Point', defaultPoints: 0.5, isToggleable: true, group: 'special_teams', sport: 'NHL' },
    { key: 'shp', label: 'Short-Handed Point', defaultPoints: 1, isToggleable: true, group: 'special_teams', sport: 'NHL' },
    { key: 'blks', label: 'Blocked Shots', defaultPoints: 0.3, isToggleable: true, group: 'defense', sport: 'NHL' },
    { key: 'hits', label: 'Hits', defaultPoints: 0.2, isToggleable: true, group: 'defense', sport: 'NHL' },
    { key: 'pim', label: 'PIM', defaultPoints: -0.1, isToggleable: true, group: 'negative', sport: 'NHL' },
    { key: 'g_win', label: 'Win (G)', defaultPoints: 5, isToggleable: false, group: 'goalie', sport: 'NHL' },
    { key: 'g_sv', label: 'Save (G)', defaultPoints: 0.2, isToggleable: false, group: 'goalie', sport: 'NHL' },
    { key: 'g_so', label: 'Shutout (G)', defaultPoints: 5, isToggleable: true, group: 'goalie', sport: 'NHL' },
    { key: 'g_ga', label: 'Goal Against (G)', defaultPoints: -1, isToggleable: true, group: 'goalie', sport: 'NHL' },
    // Wired 2026-10 from fields the box already carries. 0 by default: they score only what a
    // commissioner's saved panel sets (lib/nhl-scoring/nhlScoringEngineContract.ts).
    { key: 'pts', label: 'Point (G+A)', defaultPoints: 0, isToggleable: true, group: 'offense', sport: 'NHL' },
    { key: 'ppg', label: 'Power Play Goal', defaultPoints: 0, isToggleable: true, group: 'special_teams', sport: 'NHL' },
    { key: 'ppa', label: 'Power Play Assist', defaultPoints: 0, isToggleable: true, group: 'special_teams', sport: 'NHL' },
    { key: 'shg', label: 'Short-Handed Goal', defaultPoints: 0, isToggleable: true, group: 'special_teams', sport: 'NHL' },
    { key: 'sha', label: 'Short-Handed Assist', defaultPoints: 0, isToggleable: true, group: 'special_teams', sport: 'NHL' },
    { key: 'fow', label: 'Faceoff Win', defaultPoints: 0, isToggleable: true, group: 'offense', sport: 'NHL' },
    { key: 'fol', label: 'Faceoff Loss', defaultPoints: 0, isToggleable: true, group: 'negative', sport: 'NHL' },
    { key: 'tk', label: 'Takeaway', defaultPoints: 0, isToggleable: true, group: 'defense', sport: 'NHL' },
    { key: 'gv', label: 'Giveaway', defaultPoints: 0, isToggleable: true, group: 'negative', sport: 'NHL' },
    { key: 'so_g', label: 'Shootout Goal', defaultPoints: 0, isToggleable: true, group: 'offense', sport: 'NHL' },
    { key: 'hat_trick', label: 'Hat Trick (game)', defaultPoints: 0, isToggleable: true, group: 'bonus', sport: 'NHL' },
    { key: 'three_ast_game', label: '3+ Assist Game', defaultPoints: 0, isToggleable: true, group: 'bonus', sport: 'NHL' },
    { key: 'five_pt_game', label: '5+ Point Game', defaultPoints: 0, isToggleable: true, group: 'bonus', sport: 'NHL' },
    { key: 'multi_g_game', label: 'Multi-Goal Game', defaultPoints: 0, isToggleable: true, group: 'bonus', sport: 'NHL' },
    { key: 'multi_a_game', label: 'Multi-Assist Game', defaultPoints: 0, isToggleable: true, group: 'bonus', sport: 'NHL' },
    { key: 'ten_sog_game', label: '10+ Shot Game', defaultPoints: 0, isToggleable: true, group: 'bonus', sport: 'NHL' },
    { key: 'five_hit_game', label: '5+ Hit Game', defaultPoints: 0, isToggleable: true, group: 'bonus', sport: 'NHL' },
    { key: 'five_blk_game', label: '5+ Block Game', defaultPoints: 0, isToggleable: true, group: 'bonus', sport: 'NHL' },
    { key: 'g_loss', label: 'Loss (G)', defaultPoints: 0, isToggleable: true, group: 'goalie', sport: 'NHL' },
    { key: 'g_otl', label: 'OT/Shootout Loss (G)', defaultPoints: 0, isToggleable: true, group: 'goalie', sport: 'NHL' },
    { key: 'g_sa', label: 'Shot Against (G)', defaultPoints: 0, isToggleable: true, group: 'goalie', sport: 'NHL' },
    { key: 'g_40sv_game', label: '40+ Save Game (G)', defaultPoints: 0, isToggleable: true, group: 'goalie', sport: 'NHL' },
    { key: 'g_50sv_game', label: '50+ Save Game (G)', defaultPoints: 0, isToggleable: true, group: 'goalie', sport: 'NHL' },
    // Goalie `time_on_ice`, stored as minutes by the ingest. 0 by default, gated like the rows above.
    { key: 'g_toi', label: 'Minute Played (G)', defaultPoints: 0, isToggleable: true, group: 'goalie', sport: 'NHL' },
    // Rate-stat bonuses, evaluated PER GAME in `normalizeNhlGameStats` and summed. 0 by default, gated
    // like the rows above. Save % and shooting % count steps above the floor; GAA is one per game.
    { key: 'g_sv_pct_bonus', label: 'Save % Bonus (per .010 over .900, per game)', defaultPoints: 0, isToggleable: true, group: 'goalie', sport: 'NHL' },
    { key: 'g_gaa_bonus', label: 'GAA Under 2.50 Game (G)', defaultPoints: 0, isToggleable: true, group: 'goalie', sport: 'NHL' },
    { key: 'sh_pct_bonus', label: 'Shooting % Bonus (per point over 10%, per game)', defaultPoints: 0, isToggleable: true, group: 'bonus', sport: 'NHL' },
  ],

  scoringPresets: [{ name: 'Standard', categories: [] }],

  defaultRosterSlots: [
    { key: 'C', label: 'Center', eligiblePositions: ['C'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'C'), minCount: 1, maxCount: 4, isOptional: false },
    { key: 'LW', label: 'Left Wing', eligiblePositions: ['LW'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'LW'), minCount: 1, maxCount: 4, isOptional: false },
    { key: 'RW', label: 'Right Wing', eligiblePositions: ['RW'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'RW'), minCount: 1, maxCount: 4, isOptional: false },
    { key: 'D', label: 'Defenseman', eligiblePositions: ['D'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'D'), minCount: 2, maxCount: 6, isOptional: false },
    { key: 'G', label: 'Goalie', eligiblePositions: ['G'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'G'), minCount: 1, maxCount: 3, isOptional: false },
    { key: 'UTIL', label: 'Utility (F/D)', eligiblePositions: ['C', 'LW', 'RW', 'D'], defaultCount: dailyRedraftSlotCount(LAYOUT, 'UTIL'), minCount: 0, maxCount: 2, isOptional: true },
  ],

  defaultBenchSlots: LAYOUT.benchSlots,
  defaultIRSlots: dailyRedraftReserveCount(LAYOUT),
  defaultTaxiSlots: 0,
  defaultDevySlots: 0,

  positionEligibility: {
    C: ['C', 'UTIL'],
    LW: ['LW', 'UTIL'],
    RW: ['RW', 'UTIL'],
    D: ['D', 'UTIL'],
    G: ['G'],
  },

  defaultSeasonWeeks: DAILY_SPORT_SEASON_SHAPE.NHL.totalWeeks,
  defaultPlayoffStartWeek: playoffStartWeekFor('NHL'),
  defaultPlayoffTeams: DAILY_SPORT_SEASON_SHAPE.NHL.playoffTeams,
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
    { key: 'cCount', label: 'C Slots', type: 'number', defaultValue: dailyRedraftSlotCount(LAYOUT, 'C'), min: 1, max: 4, section: 'roster' },
    { key: 'dCount', label: 'D Slots', type: 'number', defaultValue: dailyRedraftSlotCount(LAYOUT, 'D'), min: 2, max: 6, section: 'roster' },
    { key: 'gCount', label: 'G Slots', type: 'number', defaultValue: dailyRedraftSlotCount(LAYOUT, 'G'), min: 1, max: 3, section: 'roster' },
    { key: 'benchSlots', label: 'Bench Slots', type: 'number', defaultValue: LAYOUT.benchSlots, min: 2, max: 10, section: 'roster' },
    {
      key: 'seasonWeeks',
      label: 'Regular Season Weeks',
      type: 'number',
      defaultValue: regularSeasonWeeksFor('NHL'),
      min: 14,
      max: DAILY_SPORT_SEASON_SHAPE.NHL.totalWeeks,
      section: 'schedule',
      locksAfterStart: true,
    },
    {
      key: 'playoffTeams',
      label: 'Playoff Teams',
      type: 'select',
      defaultValue: DAILY_SPORT_SEASON_SHAPE.NHL.playoffTeams,
      options: [
        { value: 4, label: '4 teams' },
        { value: 6, label: '6 teams' },
      ],
      section: 'schedule',
    },
  ],

  aiMetadata: {
    scoringStyle: 'points_or_categories',
    keyPositions: ['LW', 'C', 'RW', 'D', 'G'],
    lineupNotes: 'Daily lineups. Back-to-back game pairs often use backup goalies.',
  },
}
