/**
 * ⚠ `mlb` IS MODELLED HERE BUT NOT YET CREATABLE. The create API
 * (`app/api/brackets/playoffs/route.ts`) still accepts only `nba` and `nhl`,
 * deliberately: an MLB pool has no seeding source and no scheduled writer to
 * advance it, so opening creation first would ship a bracket that can never
 * resolve. Widen the API in the same change that lands those two, not before.
 */
export type PlayoffSport = "nba" | "nhl" | "mlb"

export type PlayoffChallengeConfig = {
  visibility: "private" | "public"
  maxParticipants: number
  maxEntriesPerParticipant: number
  scoringStyle: string
  lockRule: string
  inviteBehavior: "invite_code"
  includePlayIn: boolean
  pickSeriesScore: boolean
  pickSeriesLength: boolean
  pickSpread: boolean
  pickOverUnder: boolean
  scoring: {
    seriesWinnerPoints: number
    exactSeriesScoreBonus: number
    seriesLengthBonus: number
    upsetBonusPoints: number
    spreadPickPoints: number
    overUnderPickPoints: number
  }
  afCommissioner: {
    advancedScoring: {
      exactSeriesScore: boolean
      seriesLengthBonus: boolean
      upsetBonus: boolean
      spreadPrediction: boolean
      overUnderPrediction: boolean
      customPointValues: boolean
    }
    aiTools: {
      antiCollusion: boolean
      duplicateEntryDetection: boolean
      scoringExplainers: boolean
      poolHealthReport: boolean
      disputeAssistant: boolean
      bracketIntegrityCheck: boolean
    }
    automation: {
      incompleteBracketReminders: boolean
      autoLockAtDeadline: boolean
      autoRecalculateAfterSync: boolean
      autoPostScoringUpdates: boolean
      autoPostSeriesRecaps: boolean
    }
    privacy: {
      hidePicksUntilLock: boolean
      approvalRequired: boolean
      passwordProtected: boolean
      coCommissioners: boolean
    }
    branding: {
      customLogo: boolean
      customBanner: boolean
      customWelcomeMessage: boolean
      customRulesPage: boolean
    }
    exports: {
      leaderboardCsv: boolean
      picksCsv: boolean
      printableBracket: boolean
      auditLog: boolean
    }
  }
}

/**
 * Round keys are ADDITIVE per sport, never shared or renamed.
 *
 * ⚠ THE VALUE IS PERSISTED. `playoff_bracket_series.round` holds these strings
 * for 390 live rows across 26 pools, so renaming `round_1` to something generic
 * would need a data migration. A new sport therefore brings its own keys rather
 * than reusing the basketball/hockey ones — which also keeps the round LABEL a
 * lookup instead of a per-sport branch at every render site.
 */
export type PlayoffRoundKey =
  | "round_1"
  | "conference_semifinals"
  | "conference_finals"
  | "finals"
  | "wild_card"
  | "division_series"
  | "league_championship"
  | "world_series"

export type PlayoffSeriesStatus = "scheduled" | "in_progress" | "final"

export type PlayoffSeriesSlot = "home" | "away"

/**
 * The two halves of a draw, plus the cross-half final.
 *
 * ⚠ `finals` IS THE FINAL'S HALF, NOT A SPORT'S NAME FOR IT. It marks the one
 * series both halves feed into; what it is CALLED is resolved from the round
 * ("Cup Finals" vs "World Series"), so nothing here needs a sport.
 */
export type PlayoffConference = "east" | "west" | "al" | "nl" | "finals"

export type PlayoffChallengeView = {
  challenge: {
    id: string
    name: string
    ownerUserId: string
    sport: PlayoffSport
    seasonYear: number
    status: string
    isTestMode: boolean
    maxEntriesPerParticipant?: number
    inviteUrl?: string
    inviteCode?: string
    visibility?: string
    maxParticipants?: number
    scoringStyle?: string
    lockRule?: string
    config?: PlayoffChallengeConfig | null
    createdAt: string
    updatedAt: string
  }
  viewerUserId?: string | null
  activeEntry: {
    id: string
    name: string
    userId: string
    pickCount: number
    isComplete: boolean
    totalScore?: number
    correctPicks?: number
    resolvedPicks?: number
    createdAt: string
  } | null
  entries: Array<{
    id: string
    name: string
    userId: string
    pickCount: number
    isComplete: boolean
    totalScore?: number
    correctPicks?: number
    resolvedPicks?: number
    createdAt: string
  }>
  series: PlayoffSeriesView[]
  picks: PlayoffPickView[]
  rounds: PlayoffRoundKey[]
  lockDiagnostics?: PlayoffLockDiagnostics | null
  completion?: PlayoffCompletionView | null
}

export type PlayoffLockDiagnostics = {
  lockRule: string
  allowTestLatePicks: boolean
  viewerCanLatePick: boolean
  isPoolOwner: boolean
  isTestMode: boolean
  hasPoolAdminAccess: boolean
}

export type PlayoffCompletionView = {
  mode: "full_bracket_required" | "available_picks_only"
  isSubmittable: boolean
  requiredPickCount: number
  savedRequiredPickCount: number
  totalSeriesCount: number
  unavailableSeriesCount: number
  missingRequiredSeriesIds: string[]
  message: string
}

export type PlayoffSeriesView = {
  id: string
  round: PlayoffRoundKey
  roundIndex: number
  seriesNumber: number
  conference: PlayoffConference
  homeSeed: number
  awaySeed: number
  homeTeamName: string
  awayTeamName: string
  winnerTeamName: string | null
  bestOf: number
  status: PlayoffSeriesStatus
  startsAt: string | null
  homeTeamWins?: number
  awayTeamWins?: number
  seriesSummary?: string | null
  nextGameAt?: string | null
  venue?: string | null
  broadcastNetwork?: string | null
  liveHomeScore?: number | null
  liveAwayScore?: number | null
  liveStatus?: string | null
  providerGamesJson?: unknown
  lastSyncedAt?: string | null
  nextGameDateLabel?: string | null
  nextSeriesNumber: number | null
  nextSeriesSlot: PlayoffSeriesSlot | null
  sourceSeriesHome: number | null
  sourceSeriesAway: number | null
}

export type PlayoffPickView = {
  id: string
  entryId: string
  seriesId: string
  pickTeamName: string
  createdAt: string
  updatedAt: string
}

export type BuildPlayoffTemplateInput = {
  sport: PlayoffSport
  seasonYear: number
  isTestMode?: boolean
}

export type PlayoffTemplateSeries = Omit<PlayoffSeriesView, "id"> & {
  sourceSeriesHome: number | null
  sourceSeriesAway: number | null
}
