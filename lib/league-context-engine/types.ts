/**
 * AllFantasy League Context Engine — single normalized contract for league-aware AI.
 * @see resolveNormalizedLeagueContext
 */

import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'

/** Re-export for tool imports */
export type LeagueContextEngineErrorCode = LeagueToolAccessErrorCode

export type LeagueSourceType =
  | 'native_af'
  | 'imported_sleeper'
  | 'imported_yahoo'
  | 'imported_espn'
  | 'imported_fantrax'
  | 'imported_mfl'
  | 'imported_fleaflicker'
  | 'imported_fantasypros'
  | 'imported_other'
  | 'unknown'

/**
 * Point-based stat weights — preserves provider keys (e.g. Sleeper `pass_td`, `rec`, `bonus_rec_te`).
 * Never replace this with vague labels alone; consumers may read numeric values for AI prompts.
 */
export type NormalizedScoringRules = {
  schemaVersion: 1
  scoringModel: 'points' | 'category' | 'hybrid' | 'unknown'
  /** Numeric weights keyed by stat id (Sleeper snake_case, Yahoo may use `yahoo_stat_<id>`). */
  pointsByStat: Record<string, number>
  rawSources: {
    leagueScoringColumn: string | null
    settingsJson: Record<string, unknown> | null
    /** Typical path: `settings.scoring_settings` (Sleeper / imports). */
    embeddedScoringSettings: Record<string, unknown> | null
    /** Yahoo-style arrays, ESPN modifiers, etc. — preserved verbatim. */
    categoryOrModifierPayload: unknown
  }
  labels: {
    receptionFormat: 'standard' | 'half_ppr' | 'ppr' | 'custom' | 'unknown'
    /** Extra TE reception / TE premium points if detectable from rules */
    tePremiumExtra: number | null
    isSuperflex: boolean
    isTwoQB: boolean
    idpSlotsPresent: boolean
  }
}

export type NormalizedWaiverSettings = {
  waiverType: string | null
  waiverBudget: number | null
  waiverMinBid: number | null
  waiverClearAfterGames: boolean | null
  waiverHours: number | null
  customDailyWaivers: boolean | null
  waiverProcessTime: string | null
  waiverSchedule: unknown
}

export type NormalizedTradeSettings = {
  tradeReviewHours: number | null
  tradeDeadlineWeek: number | null
  draftPickTrading: boolean | null
}

export type NormalizedPlayoffSettings = {
  playoffStartWeek: number | null
  playoffTeams: number | null
  playoffWeeksPerRound: number | null
  playoffSeedingRule: string | null
  playoffLowerBracket: string | null
}

export type NormalizedSalaryCapSettings = {
  enabled: boolean
  startupCap: number | null
  minimumSalary: number | null
  mode: string | null
}

export type NormalizedLineupBehavior = {
  /** Best ball / weekly vs daily — from league bbScoringPeriod + platform hints */
  scoringPeriod: 'weekly' | 'daily' | 'unknown'
  bestBallMode: boolean
  bestBallSettings?: {
    mode: string | null
    matchupFormat: string | null
    waiversEnabled: boolean | null
    tradesEnabled: boolean | null
    substitutionsEnabled: boolean | null
    lineupTemplateId: string | null
  } | null
}

export type NormalizedUserTeamContext = {
  teamId: string
  externalId: string
  teamName: string | null
  platformUserId: string | null
  isLeagueCommissioner: boolean
  isTeamCommissioner: boolean
  isCoCommissioner: boolean
}

export type NormalizedCommissionerContext = {
  userIsHeadCommissionerOnImport: boolean
  /** LeagueTeam flags for the resolved user team */
  userTeamCommissionerFlags: {
    isCommissioner: boolean
    isCoCommissioner: boolean
  }
}

export type MatchupPeriodContext = {
  season: number
  /** NFL week 1–18; other sports: period index or week as synced */
  currentPeriod: number
  periodLabel: string
  source: 'sleeper_state_nfl' | 'league_season_default' | 'unknown'
  /**
   * True only when Sleeper's NFL state is this league's season, regular season, and an integer
   * week 1–18. `source: 'sleeper_state_nfl'` alone does not mean that: it is also returned in the
   * preseason, the postseason and a prior season. Anything treating the week as a COMPLETED-week
   * boundary (value-v2 strategy evidence) must require this.
   */
  verifiedRegularSeason?: boolean
}

/**
 * Primary normalized payload — use this for Chimmy, tools, and prompts.
 */
export type NormalizedLeagueContext = {
  schemaVersion: 1
  leagueId: string
  userId: string
  team: NormalizedUserTeamContext | null
  sport: string
  leagueName: string | null
  leagueType: string | null
  leagueVariant: string | null
  sourceType: LeagueSourceType
  platform: string
  platformLeagueId: string
  season: number
  leagueStatus: string | null
  matchupPeriod: MatchupPeriodContext
  scoring: NormalizedScoringRules
  roster: {
    rosterSize: number | null
    starters: unknown
    irSlots: number | null
    taxiSlots: number | null
    taxiAllowNonRookies: boolean | null
    taxiYearsLimit: number | null
  }
  lineupBehavior: NormalizedLineupBehavior
  waiver: NormalizedWaiverSettings
  trade: NormalizedTradeSettings
  playoff: NormalizedPlayoffSettings
  flags: {
    isDynasty: boolean
    isKeeper: boolean
    isDevy: boolean
    isC2C: boolean
    bestBallMode: boolean
    guillotineMode: boolean
    survivorMode: boolean
  }
  salaryCap: NormalizedSalaryCapSettings
  commissioner: NormalizedCommissionerContext
  importHealth: {
    importedAt: string | null
    lastSyncedAt: string | null
    syncStatus: string | null
    syncError: string | null
    mappingOk: boolean
  }
  timezone: string | null
}

/** Alias — same object as `NormalizedLeagueContext`. */
export type ToolLeagueContext = NormalizedLeagueContext

/** Legacy / short name */
export type LeagueContext = NormalizedLeagueContext

export type ResolveLeagueContextOptions = {
  userId: string
  leagueId: string
  /** If set, resolve this team; must belong to league or `TEAM_NOT_FOUND`. */
  preferredTeamId?: string | null
  /** Sleeper roster id / platform external id */
  preferredTeamExternalId?: string | null
}

export type ResolveLeagueContextResult =
  | { ok: true; context: NormalizedLeagueContext }
  | { ok: false; code: LeagueToolAccessErrorCode }
