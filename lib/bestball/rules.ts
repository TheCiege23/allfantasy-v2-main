import type { LeagueSport } from '@prisma/client'
import { regularSeasonWeeksFor } from '@/lib/sportConfig/dailySportSeasonShape'
import { bestBallSportSupportsDaily } from '@/lib/bestball/scoringPeriod'
import { bestBallDisplaySlots } from '@/lib/bestball/productionLineup'

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
  /**
   * The DEFAULT scoring period — weekly for every sport. It used to say `daily` for NBA / NHL / MLB /
   * NCAAB while scoring was weekly for all of them; see lib/bestball/scoringPeriod.ts.
   */
  scoringPeriod: BestBallScoringPeriod
  /** Whether a commissioner may choose daily best ball (NBA / NHL / MLB). */
  supportsDailyScoring: boolean
  /** The default tiebreaker (unchanged when the period defaults moved to weekly). */
  defaultTieRule: BestBallTieRule
  defaultRegularSeasonLength: number
  defaultPlayoffTeams: number
  defaultPlayoffFormat: BestBallPlayoffFormat
  defaultMatchupFormat: BestBallMatchupFormat
  lineupTemplateId: string
  rosterTemplateId: string
  /**
   * The starter seats best ball scoring seats — read from the same source as matchup scoring
   * (`buildBestBallSlots` via `lib/bestball/productionLineup.ts`), never restated here.
   *
   * 🛑 THESE WERE A HAND-WRITTEN COPY AND THEY DRIFTED: NBA 9 starters against the 11 of the `best_ball`
   * roster template a league is given, NHL 9 against 14, MLB 17 against 23, NCAAB 8 against 9, SOCCER 11
   * against 12 (audit 2026-11-06, finding #22). The settings copy, the War Room and the old weekly
   * optimizer all read this, so each showed a lineup the matchup never scored. Without league settings
   * this is the sport's `best_ball` template; pass the league's settings to `getBestBallSportProfile` for
   * that league's own seats.
   */
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
  /**
   * Written beside `scoringPeriod` on every normalize: true only for a daily choice the league can use.
   * Scoring reads a league as daily only when this marker is present (lib/bestball/scoringPeriod.ts) —
   * the legacy rows that defaulted to `'daily'` without it were always scored weekly.
   */
  dailyBestBall: boolean
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

/*
 * `lineupSlots` is not stored here: `getBestBallSportProfile` reads it, at call time, from the source
 * matchup scoring seats (see the field's comment). Computed lazily so importing this module never runs
 * the roster resolver.
 */
const BEST_BALL_SPORT_PROFILES: Record<BestBallSport, Omit<BestBallSportProfile, 'lineupSlots'>> = {
  NFL: {
    sport: 'NFL',
    label: 'NFL',
    recommendedRosterSize: 18,
    recommendedBenchSize: 9,
    scoringPeriod: 'weekly',
    supportsDailyScoring: false,
    defaultTieRule: 'max_week',
    defaultRegularSeasonLength: 14,
    defaultPlayoffTeams: 6,
    defaultPlayoffFormat: 'bracket',
    defaultMatchupFormat: 'h2h',
    lineupTemplateId: 'best_ball_nfl_default',
    rosterTemplateId: 'nfl-best_ball',
    notes: ['Draft-only by default.', 'Ceiling and depth matter more than weekly lineup decisions.'],
  },
  NBA: {
    sport: 'NBA',
    label: 'NBA',
    recommendedRosterSize: 15,
    recommendedBenchSize: 7,
    scoringPeriod: 'weekly',
    supportsDailyScoring: true,
    defaultTieRule: 'points_for',
    defaultRegularSeasonLength: regularSeasonWeeksFor('NBA'),
    defaultPlayoffTeams: 6,
    defaultPlayoffFormat: 'bracket',
    defaultMatchupFormat: 'cumulative',
    lineupTemplateId: 'best_ball_nba_default',
    rosterTemplateId: 'nba-best_ball',
    notes: ['Weekly by default; the commissioner can switch to daily best ball before the draft.', 'Depth through schedule density and load-management spikes is captured automatically.'],
  },
  MLB: {
    sport: 'MLB',
    label: 'MLB',
    recommendedRosterSize: 23,
    recommendedBenchSize: 10,
    scoringPeriod: 'weekly',
    supportsDailyScoring: true,
    defaultTieRule: 'points_for',
    defaultRegularSeasonLength: regularSeasonWeeksFor('MLB'),
    defaultPlayoffTeams: 6,
    defaultPlayoffFormat: 'bracket',
    defaultMatchupFormat: 'cumulative',
    lineupTemplateId: 'best_ball_mlb_default',
    rosterTemplateId: 'mlb-best_ball',
    notes: ['Weekly by default; the commissioner can switch to daily best ball before the draft.', 'Pitching depth matters more than manual lineup timing.'],
  },
  NHL: {
    sport: 'NHL',
    label: 'NHL',
    recommendedRosterSize: 17,
    recommendedBenchSize: 8,
    scoringPeriod: 'weekly',
    supportsDailyScoring: true,
    defaultTieRule: 'points_for',
    defaultRegularSeasonLength: regularSeasonWeeksFor('NHL'),
    defaultPlayoffTeams: 6,
    defaultPlayoffFormat: 'bracket',
    defaultMatchupFormat: 'cumulative',
    lineupTemplateId: 'best_ball_nhl_default',
    rosterTemplateId: 'nhl-best_ball',
    notes: ['Goalie volatility is absorbed by roster depth.', 'Weekly by default; the commissioner can switch to daily best ball before the draft.'],
  },
  NCAAF: {
    sport: 'NCAAF',
    label: 'College Football',
    recommendedRosterSize: 16,
    recommendedBenchSize: 9,
    scoringPeriod: 'weekly',
    supportsDailyScoring: false,
    defaultTieRule: 'max_week',
    defaultRegularSeasonLength: 12,
    defaultPlayoffTeams: 4,
    defaultPlayoffFormat: 'bracket',
    defaultMatchupFormat: 'h2h',
    lineupTemplateId: 'best_ball_ncaaf_default',
    rosterTemplateId: 'ncaaf-best_ball',
    notes: ['Spike weeks matter because of higher variance.', 'Short regular season makes playoff seeding tighter.'],
  },
  NCAAB: {
    sport: 'NCAAB',
    label: 'College Basketball',
    recommendedRosterSize: 12,
    recommendedBenchSize: 5,
    scoringPeriod: 'weekly',
    supportsDailyScoring: false,
    defaultTieRule: 'points_for',
    defaultRegularSeasonLength: 18,
    defaultPlayoffTeams: 4,
    defaultPlayoffFormat: 'advancement',
    defaultMatchupFormat: 'cumulative',
    lineupTemplateId: 'best_ball_ncaab_default',
    rosterTemplateId: 'ncaab-best_ball',
    notes: ['Advancement-style playoff defaults fit tournament-heavy calendars.', 'Weekly scoring captures dense conference schedules.'],
  },
  SOCCER: {
    sport: 'SOCCER',
    label: 'Soccer',
    recommendedRosterSize: 16,
    recommendedBenchSize: 5,
    scoringPeriod: 'weekly',
    supportsDailyScoring: false,
    defaultTieRule: 'max_week',
    defaultRegularSeasonLength: 34,
    defaultPlayoffTeams: 4,
    defaultPlayoffFormat: 'none',
    defaultMatchupFormat: 'cumulative',
    lineupTemplateId: 'best_ball_soccer_default',
    rosterTemplateId: 'soccer-best_ball',
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

/**
 * `leagueSettings` (a league's `settings`) swaps `lineupSlots` for that league's own seats — what its
 * matchups are actually scored on. Omitted, the sport's default `best_ball` seats.
 */
export function getBestBallSportProfile(sport: LeagueSport | string, leagueSettings?: unknown): BestBallSportProfile {
  const normalized = String(sport ?? 'NFL').trim().toUpperCase() as BestBallSport
  const profile = BEST_BALL_SPORT_PROFILES[normalized] ?? BEST_BALL_SPORT_PROFILES.NFL
  let lineupSlots: BestBallLineupSlot[] | null = null
  // A lazy, enumerable getter: callers that only want the other defaults never run the roster resolver,
  // and a serialized profile (the Best Ball API returns one) still carries the slots.
  return Object.defineProperty({ ...profile }, 'lineupSlots', {
    enumerable: true,
    get: () => {
      if (!lineupSlots) {
        const leagueSlots = leagueSettings === undefined ? [] : bestBallDisplaySlots(profile.sport, leagueSettings)
        lineupSlots = leagueSlots.length ? leagueSlots : bestBallDisplaySlots(profile.sport)
      }
      return lineupSlots
    },
  }) as BestBallSportProfile
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
    dailyBestBall: false,
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
    tieRule: profile.defaultTieRule,
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
  // Daily is offered only where per-day stats exist (lib/bestball/scoringPeriod.ts); anywhere else a
  // stored 'daily' was a profile default nobody chose, and was always scored weekly.
  const scoringPeriod: BestBallScoringPeriod =
    nested.scoringPeriod === 'daily' && bestBallSportSupportsDaily(defaults.sport) ? 'daily' : 'weekly'
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
    scoringPeriod,
    // A tournament is weekly-only; creation validation refuses the combination, so the marker stays off.
    dailyBestBall: scoringPeriod === 'daily' && contestStructure !== 'tournament',
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
    settings.scoringPeriod === 'daily' ? 'daily lineups' : 'weekly lineups',
    restrictions.join(', '),
  ].join(' · ')
}
