/**
 * [NEW] lib/playoff-settings/PlayoffStageRegistry.ts
 * Defines available postseason stages per sport.
 * Premium stages require AF Commissioner Subscription.
 */

import type { PlayoffStageOption } from './types'

const NFL_STAGES: PlayoffStageOption[] = [
  { id: 'wild_card', label: 'Wild Card Weekend', description: 'Include NFL Wild Card round games in fantasy scoring.', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'Week 18-19 (January)', warning: 'Players on eliminated teams will not play.' },
  { id: 'divisional', label: 'Divisional Round', description: 'Include NFL Divisional Round games.', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'January' },
  { id: 'conference_championship', label: 'Conference Championships', description: 'Include AFC/NFC Championship games.', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'January' },
  { id: 'super_bowl', label: 'Super Bowl', description: 'Include Super Bowl in fantasy championship.', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'February', warning: 'Only 2 teams play. Most rosters will score zero.' },
  { id: 'week_18_exclusion', label: 'Exclude Week 18', description: 'End regular season before Week 18 to avoid rest/benching.', shortensSeason: true, additionalWeeks: 0, defaultEnabled: true, premium: false },
]

const NBA_STAGES: PlayoffStageOption[] = [
  { id: 'play_in', label: 'Play-In Tournament', description: 'Include NBA Play-In Tournament games in fantasy scoring.', shortensSeason: true, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'Mid-April', warning: 'Only 8 teams participate in Play-In.' },
  { id: 'round_1', label: 'First Round', description: 'Include NBA Playoffs First Round.', shortensSeason: false, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'April-May' },
  { id: 'conference_semis', label: 'Conference Semifinals', description: 'Include conference semifinal series.', shortensSeason: false, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'May' },
  { id: 'conference_finals', label: 'Conference Finals', description: 'Include Eastern/Western Conference Finals.', shortensSeason: false, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'May-June' },
  { id: 'nba_finals', label: 'NBA Finals', description: 'Include NBA Finals in fantasy championship.', shortensSeason: false, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'June', warning: 'Only 2 teams play. Most rosters score zero.' },
]

const MLB_STAGES: PlayoffStageOption[] = [
  { id: 'wild_card_series', label: 'Wild Card Series', description: 'Include MLB Wild Card Series (best-of-3).', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'Early October' },
  { id: 'division_series', label: 'Division Series', description: 'Include ALDS/NLDS (best-of-5).', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'October' },
  { id: 'championship_series', label: 'Championship Series', description: 'Include ALCS/NLCS (best-of-7).', shortensSeason: false, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'October' },
  { id: 'world_series', label: 'World Series', description: 'Include World Series in fantasy championship.', shortensSeason: false, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'Late October', warning: 'Only 2 teams play.' },
]

const NHL_STAGES: PlayoffStageOption[] = [
  { id: 'round_1', label: 'First Round', description: 'Include Stanley Cup Playoffs First Round (best-of-7).', shortensSeason: false, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'April-May' },
  { id: 'round_2', label: 'Second Round', description: 'Include Conference Semifinals.', shortensSeason: false, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'May' },
  { id: 'conference_finals', label: 'Conference Finals', description: 'Include Conference Finals.', shortensSeason: false, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'May-June' },
  { id: 'stanley_cup_final', label: 'Stanley Cup Final', description: 'Include Stanley Cup Final.', shortensSeason: false, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'June', warning: 'Only 2 teams play.' },
]

const NCAAF_STAGES: PlayoffStageOption[] = [
  { id: 'conference_championships', label: 'Conference Championships', description: 'Include conference championship games.', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'First weekend of December' },
  { id: 'bowl_games', label: 'Bowl Games', description: 'Include bowl game scoring (40+ games).', shortensSeason: false, additionalWeeks: 3, defaultEnabled: false, premium: true, timing: 'Mid-December through early January' },
  { id: 'cfp_first_round', label: 'CFP First Round', description: 'Include College Football Playoff first round (12-team).', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'December' },
  { id: 'cfp_quarterfinals', label: 'CFP Quarterfinals', description: 'Include CFP quarterfinals (New Year\'s Six).', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'Late December / January 1' },
  { id: 'cfp_semifinals', label: 'CFP Semifinals', description: 'Include CFP semifinal games.', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'Early January' },
  { id: 'cfp_championship', label: 'National Championship', description: 'Include CFP National Championship.', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'Mid-January', warning: 'Only 2 teams play.' },
]

const NCAAB_STAGES: PlayoffStageOption[] = [
  { id: 'conference_tournaments', label: 'Conference Tournaments', description: 'Include conference tournament games (32 tournaments).', shortensSeason: true, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'Early-mid March' },
  { id: 'first_four', label: 'First Four', description: 'Include NCAA Tournament First Four play-in games.', shortensSeason: false, additionalWeeks: 0, defaultEnabled: false, premium: true, timing: 'Tuesday/Wednesday after Selection Sunday' },
  { id: 'round_of_64', label: 'Round of 64', description: 'Include first round of NCAA Tournament.', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'Thursday/Friday' },
  { id: 'round_of_32', label: 'Round of 32', description: 'Include second round.', shortensSeason: false, additionalWeeks: 0, defaultEnabled: false, premium: true, timing: 'Saturday/Sunday' },
  { id: 'sweet_16', label: 'Sweet 16', description: 'Include Sweet 16 games.', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'Thursday/Friday' },
  { id: 'elite_8', label: 'Elite 8', description: 'Include Elite 8 regional finals.', shortensSeason: false, additionalWeeks: 0, defaultEnabled: false, premium: true, timing: 'Saturday/Sunday' },
  { id: 'final_four', label: 'Final Four', description: 'Include Final Four.', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true, timing: 'First Saturday of April' },
  { id: 'championship', label: 'National Championship', description: 'Include the championship game.', shortensSeason: false, additionalWeeks: 0, defaultEnabled: false, premium: true, timing: 'First Monday of April', warning: 'Only 2 teams play.' },
]

const SOCCER_STAGES: PlayoffStageOption[] = [
  { id: 'domestic_cup_knockouts', label: 'Domestic Cup Knockouts', description: 'Include domestic cup knockout round games.', shortensSeason: false, additionalWeeks: 0, defaultEnabled: false, premium: true, timing: 'Throughout season' },
  { id: 'continental_knockouts', label: 'Continental Knockouts', description: 'Include Champions League / Europa League knockout stages.', shortensSeason: false, additionalWeeks: 0, defaultEnabled: false, premium: true, timing: 'February-June' },
  { id: 'league_playoffs', label: 'League Championship Playoffs', description: 'Include league championship playoffs (MLS-style).', shortensSeason: false, additionalWeeks: 4, defaultEnabled: false, premium: true, timing: 'November-December' },
  { id: 'relegation_playoffs', label: 'Relegation/Promotion Playoffs', description: 'Include relegation or promotion playoff games.', shortensSeason: false, additionalWeeks: 2, defaultEnabled: false, premium: true, timing: 'End of season' },
  { id: 'play_in_qualifiers', label: 'Play-In / Qualification Rounds', description: 'Include qualification or play-in matches.', shortensSeason: false, additionalWeeks: 1, defaultEnabled: false, premium: true },
]

const STAGE_REGISTRY: Record<string, PlayoffStageOption[]> = {
  NFL: NFL_STAGES,
  NBA: NBA_STAGES,
  MLB: MLB_STAGES,
  NHL: NHL_STAGES,
  NCAAF: NCAAF_STAGES,
  NCAAB: NCAAB_STAGES,
  SOCCER: SOCCER_STAGES,
}

/** Get all available playoff stage options for a sport. */
export function getPlayoffStagesBySport(sport: string): PlayoffStageOption[] {
  return STAGE_REGISTRY[sport.toUpperCase()] ?? []
}

/** Validate that a set of stage IDs are all valid for a sport. */
export function validateStageIds(sport: string, stageIds: string[]): { valid: boolean; invalidIds: string[] } {
  const available = new Set(getPlayoffStagesBySport(sport).map((s) => s.id))
  const invalidIds = stageIds.filter((id) => !available.has(id))
  return { valid: invalidIds.length === 0, invalidIds }
}

/** Check if any of the provided stages require premium. */
export function hasPremiumStages(sport: string, stageIds: string[]): boolean {
  const stages = getPlayoffStagesBySport(sport)
  return stageIds.some((id) => stages.find((s) => s.id === id)?.premium)
}
