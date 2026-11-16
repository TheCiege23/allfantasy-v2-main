/**
 * [NEW] Big Brother UI types. PROMPT 4.
 */

export type BigBrotherUserStatus =
  | 'SAFE'
  | 'HOH'
  | 'NOMINATED'
  | 'VETO_PLAYER'
  | 'VETO_WINNER'
  | 'ELIMINATED'
  | 'JURY'

export interface BigBrotherMemoryWallEntry {
  rosterId: string
  displayName: string
  avatarUrl: string | null
  status: BigBrotherUserStatus
}

export interface BigBrotherSummary {
  totalRosterCount?: number
  remainingCount?: number
  config: {
    sport: string
    finaleFormat: string
    juryStartMode: string
    /** ai_theme | deterministic_score | hybrid — outcomes stay deterministic. */
    challengeMode?: string
  }
  /** Sport-calendar context: regular season weeks, eviction end week, disclaimer for non-NFL. */
  sportCalendar?: {
    regularSeasonWeeks: number
    evictionEndWeek: number
    scoringWindowDisclaimer: string
    timelineNote: string
  }
  cycle: {
    id: string
    week: number
    phase: string
    hohRosterId: string | null
    nominee1RosterId: string | null
    nominee2RosterId: string | null
    vetoWinnerRosterId: string | null
    vetoParticipantRosterIds: string[] | null
    vetoUsed: boolean
    vetoSavedRosterId: string | null
    replacementNomineeRosterId: string | null
    evictedRosterId: string | null
    voteDeadlineAt: string | null
    voteOpenedAt: string | null
    closedAt: string | null
  } | null
  finalNomineeRosterIds: string[]
  eligibility: {
    canCompeteHOH: string[]
    canBeNominated: string[]
    canVote: string[]
    juryRosterIds: string[]
    eliminatedRosterIds: string[]
  } | null
  jury: { rosterId: string; evictedWeek: number }[]
  finalists: { rosterId: string; stats?: { hohWins?: number; vetoWins?: number; timesNominated?: number } }[]
  /** `hasVoted`: the viewer's own ballot is in this cycle (never who for). Older payloads omit it. */
  ballot: { canVote: boolean; voteDeadlineAt: string | null; closed: boolean; hasVoted?: boolean } | null
  myRosterId: string | null
  myStatus: BigBrotherUserStatus | null
  rosterDisplayNames: Record<string, string>
  /** All houseguests — memory wall grid (status from current week). */
  memoryWall?: BigBrotherMemoryWallEntry[]
  /** True when the requesting user is the league commissioner. */
  isCommissioner?: boolean
  /** Roster IDs designated as Have-Nots for the current cycle (computed or commissioner override). */
  haveNotRosterIds?: string[]
  /** Veto challenge context for VETO_CHALLENGE_OPEN phase. */
  vetoChallenge?: {
    competitorRosterIds: string[]
    challengeMode: string
    themeHints?: string[]
  }
}

export type BigBrotherView =
  | 'house'
  | 'hoh'
  | 'veto'
  | 'twists'
  | 'history'
  | 'ceremony'
  | 'voting'
  | 'jury'
  | 'commissioner'
