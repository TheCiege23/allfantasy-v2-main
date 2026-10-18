/**
 * Client-side shapes for `/api/survivor/season` + related Survivor UI.
 * Kept loose — server is source of truth.
 */

export type SurvivorUiPlayerState =
  | 'active'
  | 'immune'
  | 'eliminated'
  | 'exile'
  | 'jury'
  | 'finalist'

export type SurvivorSeasonTribeMember = {
  rosterId?: string
  userId?: string | null
}

export type SurvivorSeasonTribe = {
  logoUrl?: string | null
  id: string
  name?: string
  emoji?: string | null
  colorHex?: string | null
  slotIndex?: number
  members?: SurvivorSeasonTribeMember[]
}

export type SurvivorSeasonPlayer = {
  userId: string
  displayName: string
  avatarUrl?: string | null
  tribeId?: string | null
  playerState: string
  eliminatedWeek?: number | null
  hasImmunityThisWeek?: boolean
  tokenBalance?: number
  idolIds?: string[]
  isJuryMember?: boolean
  isFinalist?: boolean
  canAccessTribeChat?: boolean
  canAccessMergeChat?: boolean
  canAccessExileChat?: boolean
  canAccessJuryChat?: boolean
  canAccessFinaleChat?: boolean
}

export type SurvivorSeasonCouncil = {
  isRevealed?: boolean
  eliminatedName?: string | null
  isTie?: boolean
  revealSequence?: { targetName?: string | null; status?: string; isExtraVote?: boolean }[] | null
  /** Server-gated read: see lib/survivor/survivorRevealGate.ts. */
  revealMode?: 'one_at_a_time' | 'all_at_once'
  revealTotalSteps?: number | null
  revealComplete?: boolean
  revealNextStepAt?: string | null
  id: string
  week: number
  status?: string
  phase?: string
  attendingTribeId?: string | null
  votingDeadline?: string | null
  voteDeadlineAt?: string | null
}

export type SurvivorSeasonChallenge = {
  id: string
  week: number
  status?: string
  title?: string
  challengeType?: string
  scope?: string
  submissionMode?: string
  locksAt?: string | null
  lockAt?: string | null
  rewardType?: string | null
  instructions?: string
  description?: string
  configJson?: Record<string, unknown> | null
}

export type SurvivorSeasonPayload = {
  phase?: string | null
  mode?: boolean | null
  visualThemeId?: string | null
  tribes?: SurvivorSeasonTribe[]
  players?: SurvivorSeasonPlayer[]
  activeCouncil?: SurvivorSeasonCouncil | null
  currentChallenge?: SurvivorSeasonChallenge | null
  exileStatus?: { isActive?: boolean; currentWeek?: number; bossName?: string | null } | null
  /** League setting: voted-out managers go to Exile Island. */
  exileEnabled?: boolean
  juryStatus?: unknown
  userState?: SurvivorSeasonPlayer | null
  weeklyScores?: Array<{ userId: string; finalScore: number; tribeId: string | null; countedTowardTribeTotal: boolean; isFinalized: boolean }>
}

export type LeagueSettingsBrief = {
  league?: { name?: string | null; sport?: string | null }
  userRole?: string | null
  canEdit?: boolean
  hasAfCommissionerSub?: boolean
  viewerHasTeam?: boolean
  /** From league JSON when Survivor create used player/commissioner fair-play mode. */
  survivorFairPlayLimited?: boolean
}
