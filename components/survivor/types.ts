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

/** Matches `ScrollRevealStep` from `lib/survivor/votingEngine.ts` (JSON on council). */
export type SurvivorScrollRevealStep =
  | { type: 'vote'; voterName: string; targetName: string }
  | { type: 'ballot'; targetName: string; stamp: string }
  | { type: 'pause' }
  | { type: 'does_not_count'; voterName: string }
  | { type: 'elimination'; userName: string }
  | { type: 'idol_play'; powerLabel: string }

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
  isRevealed?: boolean
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
  rosterDisplayNames?: Record<string, string>
}
