export const WORLD_CUP_TOURNAMENT_KEY = "fifa_world_cup"
export const WORLD_CUP_ROUNDS = ["round_of_32", "round_of_16", "quarterfinal", "semifinal", "third_place", "final"] as const
export type WorldCupRound = (typeof WORLD_CUP_ROUNDS)[number]
export type WorldCupMatchStatus = "scheduled" | "live" | "halftime" | "final" | "postponed" | "cancelled"
type WorldCupPickLockStrategy = "per_match" | "tournament_start"
type WorldCupVisibility = "public" | "private"
type WorldCupKnockoutMode = "predictive" | "reseeded" | "knockout_only"
export const WORLD_CUP_ROUND_LABELS: Record<WorldCupRound, string> = {
  round_of_32: "Round of 32",
  round_of_16: "Round of 16",
  quarterfinal: "Quarterfinals",
  semifinal: "Semifinals",
  third_place: "Third Place",
  final: "Final",
}
export type WorldCupSlotSpec = { slotKey: string; round: WorldCupRound; region?: string | null; sourceGroup?: string | null; sourceRank?: string | null; displayName: string; isPlaceholder: boolean }
export type WorldCupMatchSpec = { matchNumber: number; round: WorldCupRound; roundIndex: number; homeSlotKey: string; awaySlotKey: string; homeTeamName: string; awayTeamName: string; nextMatchNumber?: number | null; nextMatchSlot?: "home" | "away" | null }
export type WorldCupScoringValues = { roundOf32Points: number; roundOf16Points: number; quarterFinalPoints: number; semiFinalPoints: number; finalPoints: number; championBonusPoints: number; thirdPlacePoints?: number | null; confidenceScoringEnabled?: boolean | null }
export type WorldCupMatchView = { id: string; apiFixtureId: number | null; round: WorldCupRound; roundIndex: number; matchNumber: number; homeSlotKey: string; awaySlotKey: string; homeTeamId: string | null; awayTeamId: string | null; homeTeamName: string; awayTeamName: string; homeTeamLogo: string | null; awayTeamLogo: string | null; homeScore: number | null; awayScore: number | null; homePenaltyScore: number | null; awayPenaltyScore: number | null; status: WorldCupMatchStatus; startsAt: string | null; winnerTeamId: string | null; winnerTeamName: string | null; nextMatchId: string | null; nextMatchSlot: "home" | "away" | null; elapsedMinute: number | null; injuryTime: number | null; period: string | null; venueName: string | null; venueCity: string | null; apiStatusShort: string | null; lastScoreSyncedAt: string | null }
type WorldCupParticipantView = {
  id: string
  userId: string
  displayName: string
  joinedAt: string
  totalScore: number
  maxPossibleScore: number
  championPickTeamId: string | null
  championPickName: string | null
  correctPicks: number
  rank: number | null
}
export type WorldCupPickView = {
  id: string
  matchId: string
  matchNumber?: number | null
  round: WorldCupRound
  selectedTeamId: string | null
  selectedSlotKey: string | null
  selectedTeamName: string
  confidencePoints?: number | null
  pointsAwarded: number
  isCorrect: boolean | null
  lockedAt: string | null
}
type WorldCupEntrySummaryView = {
  id: string
  name: string
  createdAt: string
  totalScore: number
  rank: number | null
  isComplete: boolean
  submittedAt?: string | null
}
export type WorldCupLeaderboardRow = {
  rank: number
  entryId: string
  entryName: string
  participantId: string
  userId: string
  username: string | null
  avatarUrl: string | null
  displayName: string
  totalScore: number
  maxPossibleScore: number
  correctPicks: number
  incorrectPicks: number
  championPickName: string | null
  championTeamId: string | null
  championStillAlive: boolean
  championCorrect: boolean
  finalistsCorrect: number
  knockoutPicksCorrect: number
  groupWinnersCorrect: number
  roundBreakdown: Record<string, number>
  joinedAt: string
  updatedAt: string
  submittedAt: string | null
}
export type WorldCupChallengeView = {
  challenge: {
    id: string
    name: string
    ownerUserId: string
    seasonYear: number
    inviteCode: string
    inviteUrl: string | null
    visibility: WorldCupVisibility
    pickLockStrategy: WorldCupPickLockStrategy
    pickLockAt: string | null
    participantCount: number
    maxParticipants: number
    maxEntriesPerParticipant: number
    /** Resolved tournament-start lock instant (explicit pickLockAt or earliest match kickoff). */
    effectivePickLockAt: string | null
    status: string
    includeThirdPlace: boolean
    knockoutMode: WorldCupKnockoutMode
    confidenceScoringEnabled: boolean
    isTestMode: boolean
    simulationEnabled: boolean
    simulatedAt: string | null
    simulationStatus: string | null
    hasSimulatedResults: boolean
    lastSyncedAt: string | null
    createdAt: string
    updatedAt: string
  }
  scoring: WorldCupScoringValues
  slots: Array<{
    id: string
    slotKey: string
    round: WorldCupRound
    region: string | null
    sourceGroup: string | null
    sourceRank: string | null
    teamId: string | null
    displayName: string
    isPlaceholder: boolean
    lockedAt: string | null
  }>
  matches: WorldCupMatchView[]
  participant: WorldCupParticipantView | null
  /** Primary bracket used for picks when the client has not selected another entry. */
  activeEntry: { id: string; name: string } | null
  /** Current user's bracket entries in this challenge. */
  entries: WorldCupEntrySummaryView[]
  picks: WorldCupPickView[]
  leaderboard: WorldCupLeaderboardRow[]
  isOwner: boolean
  isAdmin: boolean
  /** AF Pro entitlement — Bracket Brain AI (matchup LLM, etc.). */
  hasBracketBrainAi: boolean
  /** AF Commissioner entitlement — advanced scoring, locks, exports, and commissioner AI. */
  hasAfCommissioner: boolean
}

// ── AI types ──────────────────────────────────────────────────────────────────

export type WorldCupAiStrategy = "safe" | "balanced" | "upset" | "chaos"

export type WorldCupAiMatchupPreview = {
  matchId: string
  recommendedTeamId: string | null
  recommendedTeamName: string
  recommendedSide: "home" | "away" | null
  homeWinProbability: number
  awayWinProbability: number
  confidence: "low" | "medium" | "high"
  upsetRisk: "low" | "medium" | "high"
  keyFactors: string[]
  summary: string
  safePick: string
  contrarianPick: string
  projectedScore?: string | null
  /** true if the summary was generated by AI; false if deterministic fallback */
  generative: boolean
}

/** Full matchup intelligence for the guided picker (deterministic + optional LLM copy). */
export type WorldCupMatchupIntelligence = WorldCupAiMatchupPreview & {
  safePickSide: "home" | "away"
  upsetPickSide: "home" | "away"
  safePickTeamName: string
  upsetPickTeamName: string
  /** Bracket pick risk (aligned with upset volatility — close games read as higher risk). */
  riskLevel: "low" | "medium" | "high"
  recentFormSummary: string
  rankingSeedComparison: string
  bracketImpactIfHomeWins: string
  bracketImpactIfAwayWins: string
  whyThisPickMakesSense: string
  howRiskyIsThisPick: string
  whatThisMeansForYourBracket: string
  /** True when optional narrative blocks used the LLM */
  narrativesGenerative: boolean
}

export type WorldCupBracketHealth = {
  score: number
  label: "Excellent" | "Alive" | "Risky" | "Busted"
  championAlive: boolean
  possiblePointsRemaining: number
  correctPicks: number
  incorrectPicks: number
  totalPicks: number
  summary: string
}

