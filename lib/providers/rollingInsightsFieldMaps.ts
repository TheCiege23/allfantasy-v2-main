/**
 * Rolling Insights field maps — documented vendor fields only (all sports with uploads).
 * NFL maps are canonicalized in `rollingInsightsNflFieldMap.ts` and composed here.
 */

import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { normalizeSoccerLeague } from '@/lib/providers/rollingInsightsSoccerLeague'

import {
  ROLLING_INSIGHTS_NFL_DEPTH_CHART_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_ENDPOINTS,
  ROLLING_INSIGHTS_NFL_INJURY_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_LIVE_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_ROOKIE_FALLBACK_POLICY,
  ROLLING_INSIGHTS_NFL_SCHEDULE_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_TEAM_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_UNMAPPED_PROFILE_FIELDS,
} from './rollingInsightsNflFieldMap'

export type RollingInsightsVendorSport = 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'NCAABB' | 'NCAAFB' | 'SOCCER'

export type RollingInsightsFieldDomain =
  | 'profile'
  | 'player_stats'
  | 'live'
  | 'injury'
  | 'depth_chart'
  | 'team'
  | 'schedule'
  | 'live_batting'
  | 'live_pitching'
  | 'live_skaters'
  | 'live_goalies'
  | 'ncaaf_live'
  | 'ncaaf_live_current'
  | 'ncaaf_live_team'
  | 'ncaaf_live_team_stats'
  | 'ncaaf_live_player_box'
  | 'ncaaf_team_season_stats'
  | 'soccer_live'
  | 'soccer_live_team_shell'
  | 'soccer_live_team_stats'
  | 'soccer_live_player'
  | 'soccer_live_goalkeeper'
  | 'soccer_team_season_stats'

/** Path segment used in `/api/v1/.../<SPORT>` — NCAAB app sport maps to NCAABB for RI. */
export function getRollingInsightsSportCode(sport: string): RollingInsightsVendorSport {
  const raw = String(sport ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
  if (
    raw === 'NCAAF' ||
    raw === 'NCAAFB' ||
    raw === 'NCAA_FOOTBALL' ||
    raw === 'COLLEGE_FOOTBALL' ||
    raw === 'NCAA_FB' ||
    raw === 'NCAA_F' ||
    raw === 'CFB' ||
    raw === 'NCAAFOOTBALL'
  ) {
    return 'NCAAFB'
  }
  if (raw === 'EURO' || raw === 'UEFA') return 'SOCCER'
  if (normalizeSoccerLeague(raw) || normalizeSoccerLeague(raw.replace(/_/g, ' '))) return 'SOCCER'
  if (raw === 'NCAABB') return 'NCAABB'

  const su = normalizeToSupportedSport(sport)
  if (su === 'NCAAB') return 'NCAABB'
  if (su === 'NCAAF') return 'NCAAFB'
  if (su === 'SOCCER') return 'SOCCER'
  if (su === 'NFL') return 'NFL'
  if (su === 'NBA') return 'NBA'
  if (su === 'MLB') return 'MLB'
  if (su === 'NHL') return 'NHL'
  return 'NFL'
}

function endpointsFor(code: RollingInsightsVendorSport): Record<string, string> {
  const base = (sp: string) => ({
    scheduleSeason: `/api/v1/schedule-season/<DATE>/${sp}`,
    scheduleWeek: `/api/v1/schedule-week/<DATE>/${sp}`,
    scheduleDay: `/api/v1/schedule/<DATE>/${sp}`,
    live: `/api/v1/live/<DATE>/${sp}`,
    teamInfo: `/api/v1/team-info/${sp}`,
    teamStats: `/api/v1/team-stats/<DATE>/${sp}`,
    playerInfo: `/api/v1/player-info/${sp}`,
    playerStats: `/api/v1/player-stats/<DATE>/${sp}`,
    injuries: `/api/v1/injuries/${sp}`,
    depthCharts: `/api/v1/depth-charts/${sp}`,
    playByPlay: `/api/v1/play-by-play/${sp}`,
  })
  return base(code)
}

/** Documented NCAAFB paths — season/year vs calendar date segments differ by endpoint. */
const NCAAFB_ENDPOINT_OVERRIDES = {
  scheduleSeason: `/api/v1/schedule-season/<YYYY>/NCAAFB`,
  scheduleWeek: `/api/v1/schedule-week/<YYYY-MM-DD>/NCAAFB`,
  scheduleDay: `/api/v1/schedule/<YYYY-MM-DD>/NCAAFB`,
  teamStats: `/api/v1/team-stats/<YYYY>/NCAAFB`,
} as const

/**
 * SOCCER requires `league` query param on all calls (not encoded here).
 * Daily: documented `schedule-daily`; examples sometimes use `/schedule/<DATE>/SOCCER` — see `scheduleDayAlias`.
 */
const SOCCER_ENDPOINT_OVERRIDES = {
  scheduleSeason: `/api/v1/schedule-season/<YYYY>/SOCCER`,
  scheduleWeek: `/api/v1/schedule-weekly/<YYYY-MM-DD>/SOCCER`,
  scheduleDay: `/api/v1/schedule-daily/<YYYY-MM-DD>/SOCCER`,
  scheduleDayAlias: `/api/v1/schedule/<YYYY-MM-DD>/SOCCER`,
  teamStats: `/api/v1/team-stats/<YYYY>/SOCCER`,
  live: `/api/v1/live/<YYYY-MM-DD>/SOCCER`,
  playerInfo: `/api/v1/player-info/SOCCER`,
  teamInfo: `/api/v1/team-info/SOCCER`,
} as const

export const ROLLING_INSIGHTS_ENDPOINTS_BY_SPORT: Record<
  RollingInsightsVendorSport,
  Record<string, string>
> = {
  NFL: { ...ROLLING_INSIGHTS_NFL_ENDPOINTS },
  NBA: endpointsFor('NBA'),
  MLB: endpointsFor('MLB'),
  NHL: endpointsFor('NHL'),
  NCAABB: endpointsFor('NCAABB'),
  NCAAFB: { ...endpointsFor('NCAAFB'), ...NCAAFB_ENDPOINT_OVERRIDES },
  SOCCER: { ...endpointsFor('SOCCER'), ...SOCCER_ENDPOINT_OVERRIDES },
}

const NBA_LIVE_AND_BOX = {
  fullName: 'player',
  position: 'position',
  status: 'status',
  points: 'points',
  assists: 'assists',
  totalRebounds: 'total_rebounds',
  defensiveRebounds: 'defensive_rebounds',
  offensiveRebounds: 'offensive_rebounds',
  steals: 'steals',
  blocks: 'blocks',
  turnovers: 'turnovers',
  fouls: 'fouls',
  minutes: 'minutes',
  fieldGoalsMade: 'field_goals_made',
  fieldGoalsAttempted: 'field_goals_attempted',
  threePointsMade: 'three_points_made',
  threePointsAttempted: 'three_points_attempted',
  freeThrowsMade: 'free_throws_made',
  freeThrowsAttempted: 'free_throws_attempted',
  twoPointsMade: 'two_points_made',
  twoPointsAttempted: 'two_points_attempted',
  twoPointPercentage: 'two_point_percentage',
} as const

const NBA_SCHEDULE = {
  gameId: 'game_ID',
  gameTime: 'game_time',
  season: 'season',
  seasonType: 'season_type',
  status: 'status',
  homeTeam: 'home_team',
  awayTeam: 'away_team',
  homeTeamId: 'home_team_ID',
  awayTeamId: 'away_team_ID',
  broadcast: 'broadcast',
} as const

const NBA_LIVE_SHELL = {
  currentQuarter: 'full_box.current.Quarter',
  currentTimeRemaining: 'full_box.current.TimeRemaining',
  playerBox: 'player_box',
  teamStats: 'team_stats',
} as const

const NCAABB_PROFILE = {
  fullName: 'player',
  position: 'position',
  status: 'status',
  starter: 'starter',
} as const

const NCAABB_SCHEDULE_EXTRA = {
  ...NBA_SCHEDULE,
  region: 'region',
  round: 'round',
  awayTeamSeed: 'away_team_seed',
  homeTeamSeed: 'home_team_seed',
  regionDisplayOrder: 'region_display_order',
} as const

const MLB_BATTING = {
  player: 'player',
  status: 'status',
  pos: 'POS',
  positionCategory: 'position_category',
  batOrder: 'BAT_ORD',
  ab: 'AB',
  h: 'H',
  r: 'R',
  rbi: 'RBI',
  hr: 'HR',
  bb: 'BB',
  so: 'SO',
  sb: 'SB',
  cs: 'CS',
  single: '1B',
  double: '2B',
  triple: '3B',
  hbp: 'HBP',
  ibb: 'IBB',
  e: 'E',
} as const

const MLB_PITCHING = {
  player: 'player',
  status: 'status',
  pos: 'POS',
  positionCategory: 'position_category',
  ip: 'IP',
  h: 'H',
  k: 'K',
  bb: 'BB',
  er: 'ER',
  r: 'R',
  hr: 'HR',
  w: 'W',
  l: 'L',
  s: 'S',
  hld: 'HLD',
  bs: 'BS',
  pitches: 'pitches',
  strikes: 'strikes',
} as const

const NHL_SKATERS = {
  player: 'player',
  status: 'status',
  position: 'position',
  positionCategory: 'position_category',
  goals: 'goals',
  assists: 'assists',
  shotsOnGoal: 'shots_on_goal',
  hits: 'hits',
  blocks: 'blocks',
  plusMinus: 'plus_minus',
  penaltyMinutes: 'penalty_minutes',
  powerPlayGoals: 'power_play_goals',
  powerPlayAssists: 'power_play_assists',
  faceoffsWon: 'faceoffs_won',
  faceoffsLost: 'faceoffs_lost',
  giveaways: 'giveaways',
  takeaways: 'takeaways',
  timeOnIce: 'time_on_ice',
} as const

const NHL_GOALIES = {
  player: 'player',
  status: 'status',
  position: 'position',
  positionCategory: 'position_category',
  saves: 'saves',
  goalsAllowed: 'goals_allowed',
  shotsAgainst: 'shots_against',
  win: 'win',
  loss: 'loss',
  overtimeLoss: 'overtime_loss',
  shutouts: 'shutouts',
  timeOnIce: 'time_on_ice',
} as const

const NCAAFB_PROFILE = {
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
  collegeClass: 'class',
} as const

const NCAAFB_STATS = {
  gamesPlayed: 'regular_season.games_played',
  completions: 'regular_season.completions',
  passingAttempts: 'regular_season.passing_attempts',
  passingYards: 'regular_season.passing_yards',
  passingTouchdowns: 'regular_season.passing_touchdowns',
  passingInterceptions: 'regular_season.passing_interceptions',
  passerRating: 'regular_season.passer_rating',
  rushingAttempts: 'regular_season.rushing_attempts',
  rushingYards: 'regular_season.rushing_yards',
  rushingTouchdowns: 'regular_season.rushing_touchdowns',
  rushingLong: 'regular_season.rushing_long',
  receptions: 'regular_season.receptions',
  receivingYards: 'regular_season.receiving_yards',
  receivingTouchdowns: 'regular_season.receiving_touchdowns',
  receivingLong: 'regular_season.receiving_long',
  tackles: 'regular_season.tackles',
  sacks: 'regular_season.sacks',
  fumbles: 'regular_season.fumbles',
  fumblesLost: 'regular_season.fumbles_lost',
  kickReturns: 'regular_season.kick_returns',
  kickReturnYards: 'regular_season.kick_return_yards',
  kickReturnTouchdowns: 'regular_season.kick_return_touchdowns',
  puntReturns: 'regular_season.punt_returns',
  puntReturnYards: 'regular_season.punt_return_yards',
  puntReturnTouchdowns: 'regular_season.punt_return_touchdowns',
  twoPointConversionPassAttempts: 'regular_season.two_point_conversion_pass_attempts',
  twoPointConversionRushAttempts: 'regular_season.two_point_conversion_rush_attempts',
  twoPointConversionRushSucceeded: 'regular_season.two_point_conversion_rush_succeeded',
} as const

/** `/api/v1/live/<DATE>/NCAAFB` — documented game shell fields only. */
const NCAAFB_LIVE_TOP = {
  week: 'week',
  sport: 'sport',
  season: 'season',
  status: 'status',
  gameId: 'game_ID',
  gameTime: 'game_time',
  eventName: 'event_name',
  gameStatus: 'game_status',
  seasonType: 'season_type',
  gameLocation: 'game_location',
  awayTeamName: 'away_team_name',
  homeTeamName: 'home_team_name',
} as const

const NCAAFB_LIVE_CURRENT = {
  down: 'full_box.current.Down',
  possessionAbbr: 'full_box.current.poss',
  field: 'full_box.current.field',
  quarter: 'full_box.current.Quarter',
  redZone: 'full_box.current.RedZone',
  distance: 'full_box.current.Distance',
  yardLine: 'full_box.current.YardLine',
  possession: 'full_box.current.Possession',
  timeRemaining: 'full_box.current.TimeRemaining',
  yardLineTerritory: 'full_box.current.YardLineTerritory',
} as const

/** Home/away split — paths reference documented `full_box.home_team` / `full_box.away_team`. */
const NCAAFB_LIVE_TEAM_SHELL = {
  homeScore: 'full_box.home_team.score',
  homeAbbrv: 'full_box.home_team.abbrv',
  homeMascot: 'full_box.home_team.mascot',
  homeRecord: 'full_box.home_team.record',
  homeTeamId: 'full_box.home_team.team_id',
  homeDivisionName: 'full_box.home_team.division_name',
  homeQuarterScores: 'full_box.home_team.quarter_scores',
  awayScore: 'full_box.away_team.score',
  awayAbbrv: 'full_box.away_team.abbrv',
  awayMascot: 'full_box.away_team.mascot',
  awayRecord: 'full_box.away_team.record',
  awayTeamId: 'full_box.away_team.team_id',
  awayDivisionName: 'full_box.away_team.division_name',
  awayQuarterScores: 'full_box.away_team.quarter_scores',
} as const

const NCAAFB_LIVE_TEAM_STATS = {
  sacks: 'team_stats.sacks',
  safeties: 'team_stats.safeties',
  penaltiesTotal: 'team_stats.penalties.total',
  penaltiesYards: 'team_stats.penalties.yards',
  turnovers: 'team_stats.turnovers',
  firstDowns: 'team_stats.first_downs',
  totalYards: 'team_stats.total_yards',
  blockedKicks: 'team_stats.blocked_kicks',
  blockedPunts: 'team_stats.blocked_punts',
  kicksBlocked: 'team_stats.kicks_blocked',
  passingYards: 'team_stats.passing_yards',
  puntsBlocked: 'team_stats.punts_blocked',
  rushingYards: 'team_stats.rushing_yards',
  defenseTouchdowns: 'team_stats.defense_touchdowns',
  defenseInterceptions: 'team_stats.defense_interceptions',
  kickReturnTouchdowns: 'team_stats.kick_return_touchdowns',
  puntReturnTouchdowns: 'team_stats.punt_return_touchdowns',
  blockedKickTouchdowns: 'team_stats.blocked_kick_touchdowns',
  blockedPuntTouchdowns: 'team_stats.blocked_punt_touchdowns',
  interceptionTouchdowns: 'team_stats.interception_touchdowns',
  fumbleReturnTouchdowns: 'team_stats.fumble_return_touchdowns',
  defenseFumbleRecoveries: 'team_stats.defense_fumble_recoveries',
  fieldGoalReturnTouchdowns: 'team_stats.field_goal_return_touchdowns',
  twoPointConversionReturns: 'team_stats.two_point_conversion_returns',
  twoPointConversionAttempts: 'team_stats.two_point_conversion_attempts',
  twoPointConversionSucceeded: 'team_stats.two_point_conversion_succeeded',
  pointsAgainstDefenseSpecialTeams: 'team_stats.points_against_defense_special_teams',
} as const

const NCAAFB_LIVE_PLAYER_BOX = {
  fullName: 'player',
  status: 'status',
  position: 'position',
  positionCategory: 'position_category',
  completions: 'completions',
  passingAttempts: 'passing_attempts',
  passingYards: 'passing_yards',
  passingTouchdowns: 'passing_touchdowns',
  passingInterceptions: 'passing_interceptions',
  rushingAttempts: 'rushing_attempts',
  rushingYards: 'rushing_yards',
  rushingTouchdowns: 'rushing_touchdowns',
  rushingLong: 'rushing_long',
  receptions: 'receptions',
  receivingYards: 'receiving_yards',
  receivingTouchdowns: 'receiving_touchdowns',
  receivingLong: 'receiving_long',
  tackles: 'tackles',
  sacks: 'sacks',
  fumblesRecoveries: 'fumbles_recoveries',
  fieldGoalsAttempted: 'field_goals_attempted',
  fieldGoalsMade: 'field_goals_made',
  fieldGoalsLong: 'field_goals_long',
  fieldGoalDistances: 'field_goal_distances',
  extraPointsAttempted: 'extra_points_attempted',
  extraPointsMade: 'extra_points_made',
  punts: 'punts',
  inside20: 'inside_20',
  puntsLong: 'punts_long',
  puntingYards: 'punting_yards',
  kickReturns: 'kick_returns',
  kickReturnYards: 'kick_return_yards',
  kickReturnLong: 'kick_return_long',
  kickReturnTouchdowns: 'kick_return_touchdowns',
  puntReturns: 'punt_returns',
  puntReturnYards: 'punt_return_yards',
  puntReturnLong: 'punt_return_long',
  puntReturnTouchdowns: 'punt_return_touchdowns',
} as const

const NCAAFB_SCHEDULE = {
  awayTeam: 'away_team',
  homeTeam: 'home_team',
  awayTeamId: 'away_team_ID',
  homeTeamId: 'home_team_ID',
  gameId: 'game_ID',
  gameTime: 'game_time',
  seasonType: 'season_type',
  week: 'week',
  eventName: 'event_name',
  season: 'season',
  status: 'status',
  arena: 'arena',
  city: 'city',
  state: 'state',
  country: 'country',
  latitude: 'latitude',
  longitude: 'longitude',
  field: 'field',
  dome: 'dome',
  postalCode: 'postal_code',
} as const

const NCAAFB_TEAM_INFO = {
  teamId: 'team_id',
  teamName: 'team',
  abbreviation: 'abbrv',
  mascot: 'mascot',
  rank: 'rank',
  week: 'week',
  conferenceId: 'conf_ID',
  conference: 'conf',
  city: 'city',
  state: 'state',
  arena: 'arena',
  country: 'country',
  latitude: 'latitude',
  longitude: 'longitude',
  field: 'field',
  postalCode: 'postal_code',
  dome: 'dome',
} as const

/** `/api/v1/team-stats/<YYYY>/NCAAFB` — season aggregates under `regular_season.*`. */
const NCAAFB_TEAM_SEASON_STATS = {
  sacks: 'regular_season.sacks',
  points: 'regular_season.points',
  safeties: 'regular_season.safeties',
  gamesPlayed: 'regular_season.games_played',
  penalties: 'regular_season.penalties',
  penaltyYards: 'regular_season.penalty_yards',
  turnovers: 'regular_season.turnovers',
  firstDowns: 'regular_season.first_downs',
  totalYards: 'regular_season.total_yards',
  blockedKicks: 'regular_season.blocked_kicks',
  blockedPunts: 'regular_season.blocked_punts',
  kicksBlocked: 'regular_season.kicks_blocked',
  puntsBlocked: 'regular_season.punts_blocked',
  passingYards: 'regular_season.passing_yards',
  rushingYards: 'regular_season.rushing_yards',
  defenseTouchdowns: 'regular_season.defense_touchdowns',
  defenseInterceptions: 'regular_season.defense_interceptions',
  kickReturnTouchdowns: 'regular_season.kick_return_touchdowns',
  puntReturnTouchdowns: 'regular_season.punt_return_touchdowns',
  blockedKickTouchdowns: 'regular_season.blocked_kick_touchdowns',
  blockedPuntTouchdowns: 'regular_season.blocked_punt_touchdowns',
  interceptionTouchdowns: 'regular_season.interception_touchdowns',
  fumbleReturnTouchdowns: 'regular_season.fumble_return_touchdowns',
  defenseFumbleRecoveries: 'regular_season.defense_fumble_recoveries',
  fieldGoalReturnTouchdowns: 'regular_season.field_goal_return_touchdowns',
  twoPointConversionReturns: 'regular_season.two_point_conversion_returns',
  twoPointConversionAttempts: 'regular_season.two_point_conversion_attempts',
  twoPointConversionSucceeded: 'regular_season.two_point_conversion_succeeded',
  pointsAgainstDefenseSpecialTeams: 'regular_season.points_against_defense_special_teams',
} as const

const SOCCER_PROFILE = {
  providerPlayerId: 'player_id',
  fullName: 'player',
  teamRaw: 'team',
  providerTeamId: 'team_id',
  jerseyNumber: 'number',
  status: 'status',
  position: 'position',
  height: 'height',
  weight: 'weight',
  birthDateRaw: 'age',
} as const

const SOCCER_SCHEDULE = {
  awayTeam: 'away_team',
  homeTeam: 'home_team',
  awayTeamId: 'away_team_ID',
  homeTeamId: 'home_team_ID',
  gameId: 'game_ID',
  gameTime: 'game_time',
  seasonType: 'season_type',
  season: 'season',
  status: 'status',
  city: 'city',
  country: 'country',
  postalCode: 'postal_code',
  arena: 'arena',
  field: 'field',
  dome: 'dome',
  latitude: 'latitude',
  longitude: 'longitude',
} as const

const SOCCER_TEAM_INFO = {
  teamId: 'team_id',
  teamName: 'team',
  abbreviation: 'abbrv',
  league: 'league',
  city: 'city',
  arena: 'arena',
  country: 'country',
  latitude: 'latitude',
  longitude: 'longitude',
  field: 'field',
  postalCode: 'postal_code',
  dome: 'dome',
} as const

const SOCCER_LIVE_TOP = {
  sport: 'sport',
  gameStatus: 'game_status',
  status: 'status',
  awayTeamName: 'away_team_name',
  homeTeamName: 'home_team_name',
  gameId: 'game_ID',
  gameTime: 'game_time',
} as const

const SOCCER_LIVE_TEAM_SHELL = {
  homeQuarterScores: 'full_box.home_team.quarter_scores',
  homeScore: 'full_box.home_team.score',
  awayQuarterScores: 'full_box.away_team.quarter_scores',
  awayScore: 'full_box.away_team.score',
} as const

const SOCCER_LIVE_TEAM_STATS = {
  foulsCommitted: 'team_stats.fouls_committed',
  foulsDrawn: 'team_stats.fouls_drawn',
  saves: 'team_stats.saves',
  offsides: 'team_stats.offsides',
  redCards: 'team_stats.red_cards',
  yellowCards: 'team_stats.yellow_cards',
  corners: 'team_stats.corners',
  shotsOnGoal: 'team_stats.shots_on_goal',
  shotsAttempted: 'team_stats.shots_attempted',
  freeKicksWon: 'team_stats.free_kicks_won',
  freeKicksConceded: 'team_stats.free_kicks_conceded',
  penaltyAttempts: 'team_stats.penalty_attempts',
  penaltiesScored: 'team_stats.penalties_scored',
  penaltiesFaced: 'team_stats.penalties_faced',
  penaltiesConceded: 'team_stats.penalties_conceded',
  cleanSheets: 'team_stats.clean_sheets',
} as const

const SOCCER_LIVE_PLAYER = {
  fullName: 'player',
  position: 'position',
  foulsCommitted: 'fouls_committed',
  foulsDrawn: 'fouls_drawn',
  minutesPlayed: 'minutes_played',
  redCards: 'red_cards',
  yellowCards: 'yellow_cards',
  shotsOnGoal: 'shots_on_goal',
  shotsAttempted: 'shots_attempted',
  goals: 'goals',
  assists: 'assists',
  freeKicksWon: 'free_kicks_won',
  penaltyAttempts: 'penalty_attempts',
  penaltiesScored: 'penalties_scored',
} as const

const SOCCER_LIVE_GOALKEEPER = {
  goalsConceded: 'goals_conceded',
  saves: 'saves',
  cleanSheets: 'clean_sheets',
  penaltiesSaved: 'penalties_saved',
  penaltiesFaced: 'penalties_faced',
} as const

/** Vendor may emit `ties` and/or `draws`; ingestion uses `normalizeRollingInsightsSoccerDraws`. */
const SOCCER_TEAM_SEASON_STATS = {
  relegated: 'relegated',
  drawsFromVendor: 'regular_season.draws',
  tiesRaw: 'regular_season.ties',
  wins: 'regular_season.wins',
  saves: 'regular_season.saves',
  losses: 'regular_season.losses',
  corners: 'regular_season.corners',
  offsides: 'regular_season.offsides',
  redCards: 'regular_season.red_cards',
  foulsDrawn: 'regular_season.fouls_drawn',
  cleanSheets: 'regular_season.clean_sheets',
  gamesPlayed: 'regular_season.games_played',
  goalsScored: 'regular_season.goals_scored',
  yellowCards: 'regular_season.yellow_cards',
  shotsOnGoal: 'regular_season.shots_on_goal',
  freeKicksWon: 'regular_season.free_kicks_won',
  goalsConceded: 'regular_season.goals_conceded',
  foulsCommitted: 'regular_season.fouls_committed',
  penaltiesFaced: 'regular_season.penalties_faced',
  shotsAttempted: 'regular_season.shots_attempted',
  penaltiesScored: 'regular_season.penalties_scored',
  penaltyAttempts: 'regular_season.penalty_attempts',
  penaltiesConceded: 'regular_season.penalties_conceded',
  freeKicksConceded: 'regular_season.free_kicks_conceded',
} as const

export const ROLLING_INSIGHTS_FIELD_MAPS: Record<
  RollingInsightsVendorSport,
  Partial<Record<RollingInsightsFieldDomain, Readonly<Record<string, string>>>>
> = {
  NFL: {
    profile: ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP,
    player_stats: ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP,
    live: ROLLING_INSIGHTS_NFL_LIVE_FIELD_MAP,
    injury: ROLLING_INSIGHTS_NFL_INJURY_FIELD_MAP,
    depth_chart: ROLLING_INSIGHTS_NFL_DEPTH_CHART_FIELD_MAP,
    team: ROLLING_INSIGHTS_NFL_TEAM_FIELD_MAP,
    schedule: ROLLING_INSIGHTS_NFL_SCHEDULE_FIELD_MAP,
  },
  NBA: {
    live: { ...NBA_LIVE_AND_BOX, ...NBA_LIVE_SHELL },
    schedule: NBA_SCHEDULE,
    team: ROLLING_INSIGHTS_NFL_TEAM_FIELD_MAP,
  },
  MLB: {
    live_batting: MLB_BATTING,
    live_pitching: MLB_PITCHING,
    schedule: {
      ...ROLLING_INSIGHTS_NFL_SCHEDULE_FIELD_MAP,
      awayPitcherPlayerId: 'away_pitcher.player_id',
      homePitcherPlayerId: 'home_pitcher.player_id',
    },
    team: ROLLING_INSIGHTS_NFL_TEAM_FIELD_MAP,
  },
  NHL: {
    live_skaters: NHL_SKATERS,
    live_goalies: NHL_GOALIES,
    schedule: ROLLING_INSIGHTS_NFL_SCHEDULE_FIELD_MAP,
    team: ROLLING_INSIGHTS_NFL_TEAM_FIELD_MAP,
  },
  NCAABB: {
    profile: NCAABB_PROFILE,
    live: { ...NBA_LIVE_AND_BOX, ...NBA_LIVE_SHELL, starter: 'starter' },
    schedule: NCAABB_SCHEDULE_EXTRA,
    team: ROLLING_INSIGHTS_NFL_TEAM_FIELD_MAP,
  },
  NCAAFB: {
    profile: NCAAFB_PROFILE,
    player_stats: NCAAFB_STATS,
    schedule: NCAAFB_SCHEDULE,
    team: NCAAFB_TEAM_INFO,
    ncaaf_live: NCAAFB_LIVE_TOP,
    ncaaf_live_current: NCAAFB_LIVE_CURRENT,
    ncaaf_live_team: NCAAFB_LIVE_TEAM_SHELL,
    ncaaf_live_team_stats: NCAAFB_LIVE_TEAM_STATS,
    ncaaf_live_player_box: NCAAFB_LIVE_PLAYER_BOX,
    ncaaf_team_season_stats: NCAAFB_TEAM_SEASON_STATS,
  },
  SOCCER: {
    profile: SOCCER_PROFILE,
    schedule: SOCCER_SCHEDULE,
    team: SOCCER_TEAM_INFO,
    soccer_live: SOCCER_LIVE_TOP,
    soccer_live_team_shell: SOCCER_LIVE_TEAM_SHELL,
    soccer_live_team_stats: SOCCER_LIVE_TEAM_STATS,
    soccer_live_player: SOCCER_LIVE_PLAYER,
    soccer_live_goalkeeper: SOCCER_LIVE_GOALKEEPER,
    soccer_team_season_stats: SOCCER_TEAM_SEASON_STATS,
  },
}

export { ROLLING_INSIGHTS_NFL_ROOKIE_FALLBACK_POLICY, ROLLING_INSIGHTS_NFL_UNMAPPED_PROFILE_FIELDS }

export function getRollingInsightsFieldPath(
  sport: string,
  domain: RollingInsightsFieldDomain,
  canonicalField: string,
): string | undefined {
  const code = getRollingInsightsSportCode(sport)
  const map = ROLLING_INSIGHTS_FIELD_MAPS[code]?.[domain]
  if (!map) return undefined
  return map[canonicalField]
}

export function getRollingInsightsMappedCanonicalFields(
  sport: string,
  domain: RollingInsightsFieldDomain,
): string[] {
  const code = getRollingInsightsSportCode(sport)
  const map = ROLLING_INSIGHTS_FIELD_MAPS[code]?.[domain]
  return map ? Object.keys(map) : []
}

export function getRollingInsightsUnmappedCanonicalFields(
  sport: string,
  domain: RollingInsightsFieldDomain,
): string[] {
  const code = getRollingInsightsSportCode(sport)
  if (code === 'NFL' && domain === 'profile') {
    return [...ROLLING_INSIGHTS_NFL_UNMAPPED_PROFILE_FIELDS]
  }
  return []
}
