/**
 * Frontend types for Survivor league summary (PROMPT 347).
 */

export type SurvivorView =
  | 'tribe-board'
  | 'challenge'
  | 'council'
  | 'idols'
  | 'exile'
  | 'merge-jury'
  | 'ai'

export interface SurvivorSummaryConfig {
  mode: string
  tribeCount: number
  tribeSize: number
  tribeFormation?: string
  mergeTrigger: string
  mergeWeek: number
  mergePlayerCount: number | null
  juryStartAfterMerge: number
  exileReturnEnabled: boolean
  exileReturnTokens: number
  idolCount?: number
  idolPowerPool?: string[] | null
  tribeShuffleEnabled?: boolean
  tribeShuffleConsecutiveLosses?: number | null
  tribeShuffleImbalanceThreshold?: number | null
  voteDeadlineDayOfWeek: number | null
  voteDeadlineTimeUtc: string | null
  selfVoteDisallowed: boolean
  tribalCouncilDayOfWeek?: number | null
  tribalCouncilTimeUtc?: string | null
  minigameFrequency?: string
  /** Commissioner headline (e.g. Heroes vs Villains); not a default tribe split. */
  seasonThemeLabel?: string | null
  visualThemeId?: string | null
  challengesSystemRun?: boolean
  regularSeasonEndWeek?: number | null
  faqSeededAt?: string | null
}

/** One released ballot on the Tribal Council scroll (server-gated; see lib/survivor/survivorRevealGate.ts). */
export type SurvivorScrollRevealStep = {
  order: number
  targetName: string | null
  status: 'counts' | 'late_does_not_count' | 'forfeited_by_shot' | 'blocked_by_idol' | 'blocked_by_shot' | 'target_safe' | 'taken_by_vote_steal'
  isExtraVote: boolean
}

export interface SurvivorSeasonCalendar {
  firstWeek: number
  lastWeek: number
  sport: string
  sportsSupported: readonly string[] | string[]
}

export interface SurvivorSummaryTribe {
  /** Full crest with the tribe's current name in the banner. */
  logoUrl?: string | null
  /** Round mark for small placements (decorative next to a visible name). */
  markUrl?: string | null
  mascot?: string | null
  colorHex?: string | null
  id: string
  name: string
  emoji?: string | null
  slotIndex: number
  members: { rosterId: string; isLeader: boolean }[]
  /** Voted-out castaways from this tribe, for the struck-through "Out · Wk N" rows. */
  outMembers?: { rosterId: string; week: number | null }[]
}

export interface SurvivorSummaryCouncil {
  id: string
  week: number
  phase: string
  attendingTribeId: string | null
  voteDeadlineAt: string
  closedAt: string | null
  eliminatedRosterId: string | null
  revealSequence?: SurvivorScrollRevealStep[] | null
  /** When the read-out began; set only once the council is revealed. Drives the night mood. */
  revealStartsAt?: string | null
  isRevealed?: boolean
  revealMode?: 'one_at_a_time' | 'all_at_once'
  revealTotalSteps?: number | null
  revealComplete?: boolean
  revealNextStepAt?: string | null
  eliminatedName?: string | null
  isTie?: boolean
}

export interface SurvivorSummaryChallenge {
  id: string
  week: number
  challengeType: string
  title?: string
  scope?: string
  submissionMode?: string
  status?: string
  lockAt: string | null
  configJson?: unknown
  resultJson: unknown
  winnerTribeId?: string | null
  winnerUserIds?: string[]
  winnerUserNames?: string[]
  resultSummary?: string | null
  submissionCount: number
}

export interface SurvivorSummary {
  leagueName?: string
  config: SurvivorSummaryConfig
  /** Regular-season week window for main island + exile (no playoffs). */
  seasonCalendar?: SurvivorSeasonCalendar
  currentWeek: number
  tribeScores?: Record<string, number>
  /** This week's counted score per main roster. */
  memberScores?: Record<string, number>
  /** Main rosters holding individual immunity this week. */
  immunityRosterIds?: string[]
  /** Weekly necklaces still worn (top score in each tribe headed to Tribal Council). */
  immunity?: { rosterId: string; tribeId: string; week: number; score: number; displayName: string | null; expiresAt: string | null }[]
  scoresFinalized?: boolean
  nbaWeeklyScoringMode?: 'all_games' | 'one_game_per_player'
  tribes: SurvivorSummaryTribe[]
  council: SurvivorSummaryCouncil | null
  challenges: SurvivorSummaryChallenge[]
  jury: { rosterId: string; votedOutWeek: number }[]
  exileLeagueId: string | null
  exileTokens: { rosterId: string; mainRosterId: string | null; displayName: string; tokens: number; lastAwardedWeek: number | null }[]
  votedOutHistory: { rosterId?: string; week?: number }[]
  merged: boolean
  myRosterId?: string
  myTribeId?: string
  myTribeSource?: string | null
  myIdols: { id: string; playerId: string; powerType: string; playerName?: string | null; playerImageUrl?: string | null }[]
  /** The league's idol expiry rule, as the holder reads it (survivorIdolExpiry). */
  idolExpiryText?: string | null
  myActiveEffects?: {
    rewardType: string
    week: number
    appliedMode: 'full' | 'record_only' | 'queued'
    rosterId?: string | null
    tribeId?: string | null
    sourceRosterId?: string | null
  }[]
  myExileStatus?: {
    exileRosterId: string
    mainRosterId: string
    tokens: number
    eliminated: boolean
    eligibleToReturn: boolean
    reason: string | null
  } | null
  tribeBalance?: {
    requiredSitOuts: Record<string, number>
    activeCounts: Record<string, number>
  }
  sitOuts?: {
    pending: { id: string; targetTribeId: string | null; targetUserId: string | null }[]
    accepted: { id: string; targetTribeId: string | null; targetUserId: string | null }[]
    declined: { id: string; targetTribeId: string | null; targetUserId: string | null }[]
    myPendingResponse?: { sitOutId: string | null; week: number } | null
  }
  finale?: {
    open: boolean
    closed: boolean
    finalists: { rosterId: string }[]
    juryVotesSubmitted: number
    juryVotesRequired: number
    winnerRosterId: string | null
    crownedAt: string | null
    myJuryVote: { finalistRosterId: string; submittedAt: string } | null
    voteCount: Record<string, number> | null
    bonusVotesByFinalist: Record<string, number> | null
    tieBreakSeasonPoints: Record<string, number> | null
  } | null
  /** The commissioner paused Survivor events (survivor-core §7). */
  paused?: boolean
  rosterDisplayNames?: Record<string, string>
}
