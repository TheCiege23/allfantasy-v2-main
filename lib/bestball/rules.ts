import type { LeagueSport } from '@prisma/client'

export const BEST_BALL_SUPPORTED_SPORTS = [
  'NFL',
  'NBA',
  'MLB',
  'NHL',
  'NCAAF',
  'NCAAB',
  'SOCCER',
] as const satisfies readonly LeagueSport[]

export const BEST_BALL_DRAFT_MODES = ['snake', 'auction', 'linear', 'offline', 'auto'] as const
export const BEST_BALL_MODE_IDS = ['standard', 'underdog'] as const
export const BEST_BALL_CONTEST_STRUCTURES = ['season_long', 'sit_and_go', 'tournament'] as const
export const BEST_BALL_MATCHUP_FORMATS = ['h2h', 'cumulative'] as const
export const BEST_BALL_PLAYOFF_FORMATS = ['bracket', 'advancement', 'none'] as const

export type BestBallSport = (typeof BEST_BALL_SUPPORTED_SPORTS)[number]
export type BestBallDraftMode = (typeof BEST_BALL_DRAFT_MODES)[number]
export type BestBallModeId = (typeof BEST_BALL_MODE_IDS)[number]
export type BestBallContestStructure = (typeof BEST_BALL_CONTEST_STRUCTURES)[number]
export type BestBallMatchupFormat = (typeof BEST_BALL_MATCHUP_FORMATS)[number]
export type BestBallPlayoffFormat = (typeof BEST_BALL_PLAYOFF_FORMATS)[number]
export type BestBallVisibility = 'public' | 'private'
export type BestBallMonetization = 'free' | 'paid'
export type BestBallOrderMethod = 'randomize' | 'manual' | 'imported'
export type BestBallAutoPickBehavior = 'queue_first' | 'best_available' | 'roster_balanced'
export type BestBallQueueBehavior = 'strict' | 'adaptive' | 'advisory'
export type BestBallMissedPickFallback = 'queue_first' | 'best_available' | 'commissioner'
export type BestBallTieRule = 'points_for' | 'max_week' | 'advance_all'
export type BestBallScoringPeriod = 'weekly' | 'daily'

export type BestBallLineupSlot = {
  code: string
  count: number
  allowedPositions: string[]
}

export type BestBallSportProfile = {
  sport: BestBallSport
  label: string
  recommendedRosterSize: number
  recommendedBenchSize: number
  scoringPeriod: BestBallScoringPeriod
  defaultRegularSeasonLength: number
  defaultPlayoffTeams: number
  defaultPlayoffFormat: BestBallPlayoffFormat
  defaultMatchupFormat: BestBallMatchupFormat
  lineupTemplateId: string
  rosterTemplateId: string
  lineupSlots: BestBallLineupSlot[]
  notes: string[]
}

export type BestBallAiToggles = {
  enabled: boolean
  rosterConstruction: boolean
  lineupExplainer: boolean
  weeklyRecap: boolean
}

export type BestBallCommissionerAiToggles = BestBallAiToggles & {
  rulesSummary: boolean
  conflictAlerts: boolean
  playoffRecommendations: boolean
}

export type BestBallCreateSettings = {
  mode: BestBallModeId
  sport: BestBallSport
  draftMode: BestBallDraftMode
  draftOrderType: 'snake' | 'linear' | 'auction'
  draftExecutionMode: 'live' | 'offline' | 'auto'
  contestStructure: BestBallContestStructure
  matchupFormat: BestBallMatchupFormat
  playoffFormat: BestBallPlayoffFormat
  lineupTemplateId: string
  rosterTemplateId: string
  regularSeasonLength: number
  playoffTeams: number
  scoringPeriod: BestBallScoringPeriod
  waiversEnabled: boolean
  tradesEnabled: boolean
  substitutionsEnabled: boolean
  sitAndGoEnabled: boolean
  tournamentEnabled: boolean
  podPlayEnabled: boolean
  podSize: number
  tournamentAdvancementRounds: number
  roundEndWeeks?: number[]
  advancersPerPod?: number
  resetBetweenRounds?: boolean
  finalRoundStructure: string
  tieRule: BestBallTieRule
  slowDraftClockMinutes: number | null
  draftDateUtc: string
  timezone: string
  language: string
  visibility: BestBallVisibility
  monetization: BestBallMonetization
  autoPickBehavior: BestBallAutoPickBehavior
  queueBehavior: BestBallQueueBehavior
  missedPickFallback: BestBallMissedPickFallback
  thirdRoundReversal: boolean
  orderMethod: BestBallOrderMethod
  allowCommissionerPause: boolean
  allowCommissionerResume: boolean
  allowCommissionerForcePick: boolean
  allowDuplicatePlayers: boolean
  offlineEntryTracking: boolean
  cumulativeScoring: boolean
  introVideoUrl: string
  introPosterUrl: string
  commissionerAi: BestBallCommissionerAiToggles
  userAi: BestBallAiToggles
}

const BEST_BALL_SPORT_PROFILES: Record<BestBallSport, BestBallSportProfile> = {
  NFL: {
    sport: 'NFL',
    label: 'NFL',
    recommendedRosterSize: 18,
    recommendedBenchSize: 9,
    scoringPeriod: 'weekly',
    defaultRegularSeasonLength: 14,
    defaultPlayoffTeams: 6,
    defaultPlayoffFormat: 'bracket',
    defaultMatchupFormat: 'h2h',
    lineupTemplateId: 'best_ball_nfl_default',
    rosterTemplateId: 'nfl-best_ball',
    lineupSlots: [
      { code: 'QB', count: 1, allowedPositions: ['QB'] },
      { code: 'RB', count: 2, allowedPositions: ['RB'] },
      { code: 'WR', count: 3, allowedPositions: ['WR'] },
      { code: 'TE', count: 1, allowedPositions: ['TE'] },
      { code: 'FLEX', count: 2, allowedPositions: ['RB', 'WR', 'TE'] },
    ],
    notes: ['Draft-only by default.', 'Ceiling and depth matter more than weekly lineup decisions.'],
  },
  NBA: {
    sport: 'NBA',
    label: 'NBA',
    recommendedRosterSize: 15,
    recommendedBenchSize: 7,
    scoringPeriod: 'daily',
    defaultRegularSeasonLength: 20,
    defaultPlayoffTeams: 6,
    defaultPlayoffFormat: 'bracket',
    defaultMatchupFormat: 'cumulative',
    lineupTemplateId: 'best_ball_nba_default',
    rosterTemplateId: 'nba-best_ball',
    lineupSlots: [
      { code: 'PG', count: 1, allowedPositions: ['PG'] },
      { code: 'SG', count: 1, allowedPositions: ['SG'] },
      { code: 'SF', count: 1, allowedPositions: ['SF'] },
      { code: 'PF', count: 1, allowedPositions: ['PF'] },
      { code: 'C', count: 1, allowedPositions: ['C'] },
      { code: 'G', count: 1, allowedPositions: ['PG', 'SG'] },
      { code: 'F', count: 1, allowedPositions: ['SF', 'PF'] },
      { code: 'UTIL', count: 2, allowedPositions: ['PG', 'SG', 'SF', 'PF', 'C'] },
    ],
    notes: ['Daily aggregation rewards depth through schedule density.', 'Load-management spikes are captured automatically.'],
  },
  MLB: {
    sport: 'MLB',
    label: 'MLB',
    recommendedRosterSize: 23,
    recommendedBenchSize: 10,
    scoringPeriod: 'daily',
    defaultRegularSeasonLength: 22,
    defaultPlayoffTeams: 6,
    defaultPlayoffFormat: 'bracket',
    defaultMatchupFormat: 'cumulative',
    lineupTemplateId: 'best_ball_mlb_default',
    rosterTemplateId: 'mlb-best_ball',
    lineupSlots: [
      { code: 'C', count: 1, allowedPositions: ['C'] },
      { code: '1B', count: 1, allowedPositions: ['1B'] },
      { code: '2B', count: 1, allowedPositions: ['2B'] },
      { code: '3B', count: 1, allowedPositions: ['3B'] },
      { code: 'SS', count: 1, allowedPositions: ['SS'] },
      { code: 'OF', count: 4, allowedPositions: ['OF', 'LF', 'CF', 'RF'] },
      { code: 'UTIL', count: 1, allowedPositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH'] },
      { code: 'SP', count: 3, allowedPositions: ['SP'] },
      { code: 'RP', count: 2, allowedPositions: ['RP'] },
      { code: 'P', count: 2, allowedPositions: ['SP', 'RP'] },
    ],
    notes: ['Daily aggregation captures double-headers and streaming value.', 'Pitching depth matters more than manual lineup timing.'],
  },
  NHL: {
    sport: 'NHL',
    label: 'NHL',
    recommendedRosterSize: 17,
    recommendedBenchSize: 8,
    scoringPeriod: 'daily',
    defaultRegularSeasonLength: 21,
    defaultPlayoffTeams: 6,
    defaultPlayoffFormat: 'bracket',
    defaultMatchupFormat: 'cumulative',
    lineupTemplateId: 'best_ball_nhl_default',
    rosterTemplateId: 'nhl-best_ball',
    lineupSlots: [
      { code: 'C', count: 2, allowedPositions: ['C'] },
      { code: 'W', count: 3, allowedPositions: ['LW', 'RW', 'W'] },
      { code: 'D', count: 2, allowedPositions: ['D'] },
      { code: 'G', count: 1, allowedPositions: ['G'] },
      { code: 'UTIL', count: 1, allowedPositions: ['C', 'LW', 'RW', 'W', 'D'] },
    ],
    notes: ['Goalie volatility is absorbed by roster depth.', 'Scoring periods aggregate across condensed game weeks.'],
  },
  NCAAF: {
    sport: 'NCAAF',
    label: 'College Football',
    recommendedRosterSize: 16,
    recommendedBenchSize: 9,
    scoringPeriod: 'weekly',
    defaultRegularSeasonLength: 12,
    defaultPlayoffTeams: 4,
    defaultPlayoffFormat: 'bracket',
    defaultMatchupFormat: 'h2h',
    lineupTemplateId: 'best_ball_ncaaf_default',
    rosterTemplateId: 'ncaaf-best_ball',
    lineupSlots: [
      { code: 'QB', count: 1, allowedPositions: ['QB'] },
      { code: 'RB', count: 2, allowedPositions: ['RB'] },
      { code: 'WR', count: 3, allowedPositions: ['WR'] },
      { code: 'FLEX', count: 2, allowedPositions: ['RB', 'WR', 'TE'] },
    ],
    notes: ['Spike weeks matter because of higher variance.', 'Short regular season makes playoff seeding tighter.'],
  },
  NCAAB: {
    sport: 'NCAAB',
    label: 'College Basketball',
    recommendedRosterSize: 12,
    recommendedBenchSize: 5,
    scoringPeriod: 'daily',
    defaultRegularSeasonLength: 18,
    defaultPlayoffTeams: 4,
    defaultPlayoffFormat: 'advancement',
    defaultMatchupFormat: 'cumulative',
    lineupTemplateId: 'best_ball_ncaab_default',
    rosterTemplateId: 'ncaab-best_ball',
    lineupSlots: [
      { code: 'G', count: 3, allowedPositions: ['G', 'PG', 'SG'] },
      { code: 'F', count: 3, allowedPositions: ['F', 'SF', 'PF'] },
      { code: 'UTIL', count: 2, allowedPositions: ['G', 'F', 'C', 'PG', 'SG', 'SF', 'PF'] },
    ],
    notes: ['Advancement-style playoff defaults fit tournament-heavy calendars.', 'Daily aggregation captures dense conference schedules.'],
  },
  SOCCER: {
    sport: 'SOCCER',
    label: 'Soccer',
    recommendedRosterSize: 16,
    recommendedBenchSize: 5,
    scoringPeriod: 'weekly',
    defaultRegularSeasonLength: 34,
    defaultPlayoffTeams: 4,
    defaultPlayoffFormat: 'none',
    defaultMatchupFormat: 'cumulative',
    lineupTemplateId: 'best_ball_soccer_default',
    rosterTemplateId: 'soccer-best_ball',
    lineupSlots: [
      { code: 'GK', count: 1, allowedPositions: ['GK', 'GKP'] },
      { code: 'DEF', count: 3, allowedPositions: ['DEF', 'CB', 'LB', 'RB', 'LWB', 'RWB'] },
      { code: 'MID', count: 4, allowedPositions: ['MID', 'CM', 'CDM', 'CAM', 'LM', 'RM', 'AM'] },
      { code: 'FWD', count: 3, allowedPositions: ['FWD', 'ST', 'CF', 'LW', 'RW', 'SS'] },
    ],
    notes: ['Soccer optimization chooses the highest-scoring valid formation each period.', 'Long season defaults to cumulative scoring.'],
  },
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
  }
  return fallback
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

export function isBestBallSupportedSport(sport: string | null | undefined): sport is BestBallSport {
  return !!sport && (BEST_BALL_SUPPORTED_SPORTS as readonly string[]).includes(String(sport).toUpperCase())
}

export function getBestBallSportProfile(sport: LeagueSport | string): BestBallSportProfile {
  const normalized = String(sport ?? 'NFL').trim().toUpperCase() as BestBallSport
  return BEST_BALL_SPORT_PROFILES[normalized] ?? BEST_BALL_SPORT_PROFILES.NFL
}

export function resolveBestBallDraftModeDraftOrderType(mode: BestBallDraftMode): 'snake' | 'linear' | 'auction' {
  if (mode === 'auction') return 'auction'
  if (mode === 'linear') return 'linear'
  return 'snake'
}

export function resolveBestBallDraftExecutionMode(mode: BestBallDraftMode): 'live' | 'offline' | 'auto' {
  if (mode === 'offline') return 'offline'
  if (mode === 'auto') return 'auto'
  return 'live'
}

export function getDefaultBestBallSettings(
  sport: LeagueSport | string,
  mode: BestBallModeId = 'standard',
  draftMode: BestBallDraftMode = mode === 'underdog' ? 'snake' : 'snake',
): BestBallCreateSettings {
  const profile = getBestBallSportProfile(sport)
  const underdog = mode === 'underdog'
  const contestStructure: BestBallContestStructure = underdog ? 'season_long' : 'season_long'
  const cumulativeScoring = underdog || profile.defaultMatchupFormat === 'cumulative'
  const matchupFormat: BestBallMatchupFormat = cumulativeScoring ? 'cumulative' : profile.defaultMatchupFormat
  return {
    mode,
    sport: profile.sport,
    draftMode,
    draftOrderType: resolveBestBallDraftModeDraftOrderType(draftMode),
    draftExecutionMode: resolveBestBallDraftExecutionMode(draftMode),
    contestStructure,
    matchupFormat,
    playoffFormat: cumulativeScoring ? 'advancement' : profile.defaultPlayoffFormat,
    lineupTemplateId: profile.lineupTemplateId,
    rosterTemplateId: profile.rosterTemplateId,
    regularSeasonLength: profile.defaultRegularSeasonLength,
    playoffTeams: profile.defaultPlayoffTeams,
    scoringPeriod: profile.scoringPeriod,
    waiversEnabled: underdog ? false : false,
    tradesEnabled: underdog ? false : false,
    substitutionsEnabled: false,
    sitAndGoEnabled: false,
    tournamentEnabled: false,
    podPlayEnabled: underdog,
    podSize: 12,
    tournamentAdvancementRounds: 0,
    advancersPerPod: 1,
    resetBetweenRounds: false,
    finalRoundStructure: cumulativeScoring ? 'cumulative_final' : 'single_week_final',
    tieRule: profile.scoringPeriod === 'weekly' ? 'max_week' : 'points_for',
    slowDraftClockMinutes: draftMode === 'snake' ? 60 : null,
    draftDateUtc: '',
    timezone: 'America/New_York',
    language: 'en',
    visibility: 'private',
    monetization: 'free',
    autoPickBehavior: 'queue_first',
    queueBehavior: 'adaptive',
    missedPickFallback: 'best_available',
    thirdRoundReversal: draftMode === 'snake' && profile.sport === 'NFL',
    orderMethod: 'randomize',
    allowCommissionerPause: true,
    allowCommissionerResume: true,
    allowCommissionerForcePick: true,
    allowDuplicatePlayers: false,
    offlineEntryTracking: draftMode === 'offline',
    cumulativeScoring,
    introVideoUrl: '/league-type-best-ball-intro.mp4',
    introPosterUrl: '/league-type-best-ball.png',
    commissionerAi: {
      enabled: true,
      rosterConstruction: true,
      lineupExplainer: true,
      weeklyRecap: true,
      rulesSummary: true,
      conflictAlerts: true,
      playoffRecommendations: true,
    },
    userAi: {
      enabled: true,
      rosterConstruction: true,
      lineupExplainer: true,
      weeklyRecap: true,
    },
  }
}

export function normalizeBestBallSettings(input: {
  teamCount?: number
  sport: LeagueSport | string
  conceptSetup?: Record<string, unknown> | null
  draftType?: string | null
  timezone?: string | null
  language?: string | null
}): BestBallCreateSettings {
  const conceptSetup = input.conceptSetup ?? {}
  const nested =
    conceptSetup.bestBall && typeof conceptSetup.bestBall === 'object'
      ? (conceptSetup.bestBall as Record<string, unknown>)
      : conceptSetup
  const rawMode = isOneOf(nested.mode, BEST_BALL_MODE_IDS) ? nested.mode : 'standard'
  const rawDraftMode = isOneOf(nested.draftMode, BEST_BALL_DRAFT_MODES)
    ? nested.draftMode
    : isOneOf(input.draftType, BEST_BALL_DRAFT_MODES)
      ? input.draftType
      : rawMode === 'underdog'
        ? 'snake'
        : 'snake'
  const defaults = getDefaultBestBallSettings(input.sport, rawMode, rawDraftMode)
  const contestStructure: BestBallContestStructure = asBool(nested.tournamentEnabled, defaults.tournamentEnabled)
    ? 'tournament'
    : asBool(nested.sitAndGoEnabled, defaults.sitAndGoEnabled)
      ? 'sit_and_go'
      : isOneOf(nested.contestStructure, BEST_BALL_CONTEST_STRUCTURES)
        ? nested.contestStructure
        : defaults.contestStructure
  const cumulativeScoring = asBool(nested.cumulativeScoring, defaults.cumulativeScoring)
  const matchupFormat: BestBallMatchupFormat = isOneOf(nested.matchupFormat, BEST_BALL_MATCHUP_FORMATS)
    ? nested.matchupFormat
    : cumulativeScoring
      ? 'cumulative'
      : defaults.matchupFormat
  const playoffFormat: BestBallPlayoffFormat = isOneOf(nested.playoffFormat, BEST_BALL_PLAYOFF_FORMATS)
    ? nested.playoffFormat
    : matchupFormat === 'cumulative'
      ? 'advancement'
      : defaults.playoffFormat

  return {
    ...defaults,
    draftMode: rawDraftMode,
    draftOrderType: resolveBestBallDraftModeDraftOrderType(rawDraftMode),
    draftExecutionMode: resolveBestBallDraftExecutionMode(rawDraftMode),
    contestStructure,
    matchupFormat: contestStructure === 'tournament' ? 'cumulative' : matchupFormat,
    playoffFormat: contestStructure === 'tournament' ? 'advancement' : playoffFormat,
    lineupTemplateId: asString(nested.lineupTemplateId, defaults.lineupTemplateId),
    rosterTemplateId: asString(nested.rosterTemplateId, defaults.rosterTemplateId),
    regularSeasonLength: asInt(nested.regularSeasonLength, defaults.regularSeasonLength, 1, 60),
    playoffTeams: contestStructure === 'tournament' ? 0 : asInt(nested.playoffTeams, Math.min(defaults.playoffTeams, input.teamCount ?? defaults.playoffTeams), 0, 16),
    scoringPeriod: isOneOf(nested.scoringPeriod, ['weekly', 'daily'] as const)
      ? nested.scoringPeriod
      : defaults.scoringPeriod,
    waiversEnabled: asBool(nested.waiversEnabled, defaults.waiversEnabled),
    tradesEnabled: asBool(nested.tradesEnabled, defaults.tradesEnabled),
    substitutionsEnabled: asBool(nested.substitutionsEnabled, defaults.substitutionsEnabled),
    sitAndGoEnabled: asBool(nested.sitAndGoEnabled, defaults.sitAndGoEnabled),
    tournamentEnabled: asBool(nested.tournamentEnabled, defaults.tournamentEnabled),
    podPlayEnabled: asBool(nested.podPlayEnabled, defaults.podPlayEnabled),
    podSize: asInt(nested.podSize, defaults.podSize, 2, 64),
    tournamentAdvancementRounds: asInt(nested.tournamentAdvancementRounds, defaults.tournamentAdvancementRounds, 0, 10),
    roundEndWeeks: Array.isArray(nested.roundEndWeeks) ? nested.roundEndWeeks.map(Number) : undefined,
    advancersPerPod: asInt(nested.advancersPerPod, defaults.advancersPerPod ?? 1, 1, asInt(nested.podSize, defaults.podSize, 2, 64)),
    resetBetweenRounds: asBool(nested.resetBetweenRounds, defaults.resetBetweenRounds ?? false),
    finalRoundStructure: asString(nested.finalRoundStructure, defaults.finalRoundStructure),
    tieRule: isOneOf(nested.tieRule, ['points_for', 'max_week', 'advance_all'] as const)
      ? nested.tieRule
      : defaults.tieRule,
    slowDraftClockMinutes:
      nested.slowDraftClockMinutes == null || nested.slowDraftClockMinutes === ''
        ? defaults.slowDraftClockMinutes
        : asInt(nested.slowDraftClockMinutes, defaults.slowDraftClockMinutes ?? 60, 1, 10080),
    draftDateUtc: asString(nested.draftDateUtc, defaults.draftDateUtc),
    timezone: asString(nested.timezone, input.timezone ?? defaults.timezone),
    language: asString(nested.language, input.language ?? defaults.language),
    visibility: isOneOf(nested.visibility, ['public', 'private'] as const) ? nested.visibility : defaults.visibility,
    monetization: isOneOf(nested.monetization, ['free', 'paid'] as const) ? nested.monetization : defaults.monetization,
    autoPickBehavior: isOneOf(nested.autoPickBehavior, ['queue_first', 'best_available', 'roster_balanced'] as const)
      ? nested.autoPickBehavior
      : defaults.autoPickBehavior,
    queueBehavior: isOneOf(nested.queueBehavior, ['strict', 'adaptive', 'advisory'] as const)
      ? nested.queueBehavior
      : defaults.queueBehavior,
    missedPickFallback: isOneOf(nested.missedPickFallback, ['queue_first', 'best_available', 'commissioner'] as const)
      ? nested.missedPickFallback
      : defaults.missedPickFallback,
    thirdRoundReversal: asBool(nested.thirdRoundReversal, defaults.thirdRoundReversal),
    orderMethod: isOneOf(nested.orderMethod, ['randomize', 'manual', 'imported'] as const)
      ? nested.orderMethod
      : defaults.orderMethod,
    allowCommissionerPause: asBool(nested.allowCommissionerPause, defaults.allowCommissionerPause),
    allowCommissionerResume: asBool(nested.allowCommissionerResume, defaults.allowCommissionerResume),
    allowCommissionerForcePick: asBool(nested.allowCommissionerForcePick, defaults.allowCommissionerForcePick),
    allowDuplicatePlayers: asBool(nested.allowDuplicatePlayers, defaults.allowDuplicatePlayers),
    offlineEntryTracking: asBool(nested.offlineEntryTracking, defaults.offlineEntryTracking),
    cumulativeScoring,
    introVideoUrl: asString(nested.introVideoUrl, defaults.introVideoUrl),
    introPosterUrl: asString(nested.introPosterUrl, defaults.introPosterUrl),
    commissionerAi: {
      ...defaults.commissionerAi,
      ...(nested.commissionerAi && typeof nested.commissionerAi === 'object'
        ? (nested.commissionerAi as Partial<BestBallCommissionerAiToggles>)
        : {}),
    },
    userAi: {
      ...defaults.userAi,
      ...(nested.userAi && typeof nested.userAi === 'object'
        ? (nested.userAi as Partial<BestBallAiToggles>)
        : {}),
    },
  }
}

export function buildBestBallSettingsSummary(settings: BestBallCreateSettings): string {
  const restrictions = [
    settings.waiversEnabled ? 'waivers on' : 'waivers off',
    settings.tradesEnabled ? 'trades on' : 'trades off',
    settings.substitutionsEnabled ? 'manual subs on' : 'manual subs off',
  ]
  return [
    `${settings.mode === 'underdog' ? 'Underdog-style' : 'Standard'} Best Ball`,
    `${settings.draftMode} draft`,
    `${settings.matchupFormat === 'cumulative' ? 'cumulative points' : 'head-to-head'} scoring`,
    restrictions.join(', '),
  ].join(' · ')
}
