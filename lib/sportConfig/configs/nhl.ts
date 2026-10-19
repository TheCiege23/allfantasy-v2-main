import type { SportConfigFull } from '../types'
import { DAILY_SPORT_SEASON_SHAPE, playoffStartWeekFor, regularSeasonWeeksFor } from '@/lib/sportConfig/dailySportSeasonShape'

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
  ],

  scoringPresets: [{ name: 'Standard', categories: [] }],

  defaultRosterSlots: [
    { key: 'C', label: 'Center', eligiblePositions: ['C'], defaultCount: 2, minCount: 1, maxCount: 4, isOptional: false },
    { key: 'LW', label: 'Left Wing', eligiblePositions: ['LW'], defaultCount: 2, minCount: 1, maxCount: 4, isOptional: false },
    { key: 'RW', label: 'Right Wing', eligiblePositions: ['RW'], defaultCount: 2, minCount: 1, maxCount: 4, isOptional: false },
    { key: 'D', label: 'Defenseman', eligiblePositions: ['D'], defaultCount: 4, minCount: 2, maxCount: 6, isOptional: false },
    { key: 'G', label: 'Goalie', eligiblePositions: ['G'], defaultCount: 1, minCount: 1, maxCount: 3, isOptional: false },
    { key: 'UTIL', label: 'Utility (F/D)', eligiblePositions: ['C', 'LW', 'RW', 'D'], defaultCount: 1, minCount: 0, maxCount: 2, isOptional: true },
  ],

  defaultBenchSlots: 5,
  defaultIRSlots: 2,
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
    { key: 'cCount', label: 'C Slots', type: 'number', defaultValue: 2, min: 1, max: 4, section: 'roster' },
    { key: 'dCount', label: 'D Slots', type: 'number', defaultValue: 4, min: 2, max: 6, section: 'roster' },
    { key: 'gCount', label: 'G Slots', type: 'number', defaultValue: 1, min: 1, max: 3, section: 'roster' },
    { key: 'benchSlots', label: 'Bench Slots', type: 'number', defaultValue: 5, min: 2, max: 10, section: 'roster' },
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
