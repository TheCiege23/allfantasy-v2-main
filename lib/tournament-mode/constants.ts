/**
 * [NEW] lib/tournament-mode/constants.ts
 * Tournament Mode — defaults, theme packs, naming sets.
 */

import type { TournamentSettings } from './types'
export { TOURNAMENT_PARTICIPANT_POOL_SIZES } from './types'

export const TOURNAMENT_LEAGUE_VARIANT = 'tournament_mode' as const

/**
 * Every league a tournament builds has a draft ahead of it, so it starts before the draft.
 * Without this the league took the column default (`in_season`), which refuses a draft start.
 * Its draft-settings row is added after the league's defaults are in place
 * (lib/draft-defaults/ensureLeagueSettingsRow.ts).
 */
export const TOURNAMENT_LEAGUE_DRAFT_READY = {
  status: 'pre_draft',
  lifecycleState: 'pre_draft',
} as const

export const DEFAULT_TOURNAMENT_SETTINGS: TournamentSettings = {
  draftType: 'snake',
  participantPoolSize: 72,
  conferenceMode: 'black_vs_gold',
  leagueNamingMode: 'app_generated',
  initialLeagueSize: 12,
  qualificationWeeks: 9,
  qualificationTiebreakers: ['wins', 'points_for'],
  bubbleWeekEnabled: false,
  roundRedraftSchedule: [10],
  finalsRedraftEnabled: true,
  faabBudgetDefault: 100,
  faabResetByRound: true,
  benchSpotsQualification: 7,
  benchSpotsElimination: 2,
  universalPageVisibility: 'unlisted',
  forumAnnouncementsEnabled: true,
  eliminationAdvancementPerLeague: 6,
}

/** Feeder round league name pool (Black vs Gold style). */
export const FEEDER_LEAGUE_NAMES = [
  'BEAST', 'GOAT', 'GRIZZ', 'KINGS', 'REBELS', 'SMOKE', 'STEALTH', 'SWAMP', 'THUNDER', 'WARRIOR',
] as const

/** Later round league name pool (directional). */
export const LATER_ROUND_NAMES = ['NORTH', 'SOUTH', 'EAST', 'WEST'] as const

/** Random themed conference name pairs (for randomized 2-conference mode). */
export const THEMED_CONFERENCE_PAIRS: [string, string][] = [
  ['Black', 'Gold'],
  ['Shadow', 'Flame'],
  ['Storm', 'Tide'],
  ['Alpha', 'Omega'],
  ['Viper', 'Phoenix'],
]
