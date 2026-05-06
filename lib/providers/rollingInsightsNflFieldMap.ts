/**
 * Rolling Insights NFL — documented field paths only (no live API calls).
 * Source: docs/provider-docs/rolling-insights/nfl-field-map.md
 */

export const ROLLING_INSIGHTS_NFL_ENDPOINTS = {
  scheduleSeason: '/api/v1/schedule-season/<DATE>/NFL',
  scheduleWeek: '/api/v1/schedule-week/<DATE>/NFL',
  scheduleDay: '/api/v1/schedule/<DATE>/NFL',
  live: '/api/v1/live/<DATE>/NFL',
  teamInfo: '/api/v1/team-info/NFL',
  teamStats: '/api/v1/team-stats/<DATE>/NFL',
  playerInfo: '/api/v1/player-info/NFL',
  playerStats: '/api/v1/player-stats/<DATE>/NFL',
  injuries: '/api/v1/injuries/NFL',
  depthCharts: '/api/v1/depth-charts/NFL',
  playByPlay: '/api/v1/play-by-play/NFL',
} as const

export const ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP = {
  providerPlayerId: 'player_id',
  fullName: 'player',
  teamName: 'team',
  providerTeamId: 'team_id',
  jerseyNumber: 'number',
  status: 'status',
  position: 'position',
  positionCategory: 'position_category',
  height: 'height',
  weight: 'weight',
  birthDateRaw: 'age',
  college: 'college',
  headshotImageId: 'img',
  allStar: 'all_star',
} as const

/** Dot-separated paths under `player-stats` payload (typically within `regular_season` + counting stats). */
export const ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP = {
  gamesPlayed: 'regular_season.games_played',
  fantasyPoints: 'regular_season.DK_fantasy_points',
  fantasyPointsPerGame: 'regular_season.DK_fantasy_points_per_game',
  completions: 'completions',
  passingAttempts: 'passing_attempts',
  passingYards: 'passing_yards',
  passingTouchdowns: 'passing_touchdowns',
  passingInterceptions: 'passing_interceptions',
  passerRating: 'passer_rating',
  rushingAttempts: 'rushing_attempts',
  rushingYards: 'rushing_yards',
  rushingTouchdowns: 'rushing_touchdowns',
  receptions: 'receptions',
  receivingYards: 'receiving_yards',
  receivingTouchdowns: 'receiving_touchdowns',
  fumbles: 'fumbles',
  fumblesLost: 'fumbles_lost',
  tackles: 'tackles',
  sacks: 'sacks',
  interceptions: 'interceptions',
  fieldGoalsAttempted: 'field_goals_attempted',
  fieldGoalsMade: 'field_goals_made',
  fieldGoalsLong: 'field_goals_long',
  extraPointsAttempted: 'extra_points_attempted',
  extraPointsMade: 'extra_points_made',
  puntReturns: 'punt_returns',
  puntReturnYards: 'punt_return_yards',
  puntReturnTouchdowns: 'punt_return_touchdowns',
  kickReturns: 'kick_returns',
  kickReturnYards: 'kick_return_yards',
  kickReturnTouchdowns: 'kick_return_touchdowns',
} as const

export const ROLLING_INSIGHTS_NFL_LIVE_FIELD_MAP = {
  gameId: 'game_ID',
  gameStatus: 'game_status',
  currentGameState: 'full_box.current',
  playerLiveStats: 'player_box',
  teamLiveStatsHome: 'full_box.home_team.team_stats',
  teamLiveStatsAway: 'full_box.away_team.team_stats',
} as const

export const ROLLING_INSIGHTS_NFL_INJURY_FIELD_MAP = {
  providerPlayerId: 'player_id',
  playerName: 'player',
  injury: 'injury',
  returnStatus: 'returns',
  dateInjured: 'date_injured',
  teamName: 'team',
  providerTeamId: 'team_id',
} as const

/**
 * Depth charts nest by team → position key → rank → `{ id, player, ... }`.
 * Dynamic segments are called out as literals for consumers/tests.
 */
export const ROLLING_INSIGHTS_NFL_DEPTH_CHART_FIELD_MAP = {
  providerPlayerId: 'id',
  playerName: 'player',
  depthPositionKey: '<team>.<position_key>',
  depthRankKey: '<team>.<position_key>.<rank_key>',
  providerTeamId: 'team_id',
} as const

export const ROLLING_INSIGHTS_NFL_TEAM_FIELD_MAP = {
  providerTeamId: 'team_id',
  teamName: 'team',
  abbreviation: 'abbrv',
  mascot: 'mascot',
  conference: 'conf',
  city: 'city',
  state: 'state',
  arena: 'arena',
  country: 'country',
  field: 'field',
  dome: 'dome',
} as const

export const ROLLING_INSIGHTS_NFL_SCHEDULE_FIELD_MAP = {
  gameId: 'game_ID',
  gameTime: 'game_time',
  season: 'season',
  seasonType: 'season_type',
  week: 'week',
  status: 'status',
  homeTeam: 'home_team',
  awayTeam: 'away_team',
  homeTeamId: 'home_team_ID',
  awayTeamId: 'away_team_ID',
} as const

export const ROLLING_INSIGHTS_NFL_UNMAPPED_PROFILE_FIELDS = [
  'draftYear',
  'draftRound',
  'draftPick',
  'yearsExperience',
  'experience',
  'years_exp',
  'rookie',
  'isRookie',
] as const

export const ROLLING_INSIGHTS_NFL_ROOKIE_FALLBACK_POLICY = {
  primaryIfVerified: 'rolling_insights_imported_fields',
  fallback: 'sleeper_years_exp',
  fallbackCondition: 'years_exp === 0',
  cacheFallback: 'SportsDataCache sleeper:nfl:yearsexp:compact:v1',
  note: 'NFL RI doc reviewed does not document rookie/experience/draftYear fields.',
} as const

export type RollingInsightsNflFieldDomain =
  | 'profile'
  | 'player_stats'
  | 'live'
  | 'injury'
  | 'depth_chart'
  | 'team'
  | 'schedule'

const DOMAIN_MAPS: Record<
  RollingInsightsNflFieldDomain,
  Readonly<Record<string, string>>
> = {
  profile: ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP,
  player_stats: ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP,
  live: ROLLING_INSIGHTS_NFL_LIVE_FIELD_MAP,
  injury: ROLLING_INSIGHTS_NFL_INJURY_FIELD_MAP,
  depth_chart: ROLLING_INSIGHTS_NFL_DEPTH_CHART_FIELD_MAP,
  team: ROLLING_INSIGHTS_NFL_TEAM_FIELD_MAP,
  schedule: ROLLING_INSIGHTS_NFL_SCHEDULE_FIELD_MAP,
}

export function getRollingInsightsNflFieldPath(
  domain: RollingInsightsNflFieldDomain,
  canonicalField: string,
): string | undefined {
  const map = DOMAIN_MAPS[domain]
  if (!map) return undefined
  return map[canonicalField]
}
