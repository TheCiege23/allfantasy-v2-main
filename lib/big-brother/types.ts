/**
 * [NEW] lib/big-brother/types.ts
 * Big Brother League — shared types for config, cycles, and game loop.
 * PROMPT 2/6.
 */

import type { LeagueSport } from '@prisma/client'

/** Week state machine phases (deterministic automation). PROMPT 3. */
export type BigBrotherWeekPhase =
  | 'HOH_OPEN'
  | 'HOH_LOCKED'
  | 'NOMINATION_OPEN'
  | 'NOMINATION_LOCKED'
  | 'VETO_DRAW'
  | 'VETO_CHALLENGE_OPEN'
  | 'VETO_DECISION_OPEN'
  | 'REPLACEMENT_NOMINATION_OPEN'
  | 'VOTING_OPEN'
  | 'VOTING_LOCKED'
  | 'EVICTION_RESOLVED'
  | 'JURY_UPDATE'
  | 'RESET_NEXT_WEEK'

/** Jury start mode. */
export type JuryStartMode = 'after_eliminations' | 'when_remaining' | 'fixed_week'

/** Finale format. */
export type FinaleFormat = 'final_2' | 'final_3'

/** Waiver release timing after eviction. */
export type WaiverReleaseTiming = 'immediate' | 'next_waiver_run' | 'faab_window'

/** Public vote totals visibility. */
export type PublicVoteTotalsVisibility = 'exact' | 'evicted_only'

/** Challenge mode for HOH/veto. */
export type ChallengeMode = 'ai_theme' | 'deterministic_score' | 'hybrid'

/** Inactive player handling. */
export type InactivePlayerHandling = 'none' | 'replacement_after_n_weeks' | 'commissioner_only'

/** Auto-nomination fallback when HOH times out. */
export type AutoNominationFallback = 'lowest_season_points' | 'random' | 'commissioner'

/** Config loaded from DB (BigBrotherLeagueConfig + League.sport). */
export interface BigBrotherConfig {
  leagueId: string
  configId: string
  sport: LeagueSport
  hohChallengeDayOfWeek: number | null
  hohChallengeTimeUtc: string | null
  nominationDeadlineDayOfWeek: number | null
  nominationDeadlineTimeUtc: string | null
  vetoDrawDayOfWeek: number | null
  vetoDrawTimeUtc: string | null
  vetoDecisionDeadlineDayOfWeek: number | null
  vetoDecisionDeadlineTimeUtc: string | null
  replacementNomineeDeadlineDayOfWeek: number | null
  replacementNomineeDeadlineTimeUtc: string | null
  evictionVoteOpenDayOfWeek: number | null
  evictionVoteOpenTimeUtc: string | null
  evictionVoteCloseDayOfWeek: number | null
  evictionVoteCloseTimeUtc: string | null
  finalNomineeCount: number
  vetoCompetitorCount: number
  consecutiveHohAllowed: boolean
  hohVotesOnlyInTie: boolean
  juryStartMode: JuryStartMode
  juryStartAfterEliminations: number | null
  juryStartWhenRemaining: number | null
  juryStartWeek: number | null
  finaleFormat: FinaleFormat
  waiverReleaseTiming: WaiverReleaseTiming
  publicVoteTotalsVisibility: PublicVoteTotalsVisibility
  challengeMode: ChallengeMode
  antiCollusionLogging: boolean
  inactivePlayerHandling: InactivePlayerHandling
  autoNominationFallback: AutoNominationFallback
  evictionTieBreakMode: string
  weekProgressionPaused: boolean
  /** Twists / engine flags; see `big-brother-premium-engine-spec.ts`. */
  premiumEngineSpec?: unknown | null
}

/** Eviction vote tally result. */
export interface BigBrotherVoteTally {
  cycleId: string
  votesByTarget: Record<string, number>
  tied: boolean
  evictedRosterId: string | null
  tieBreakSeasonPoints: Record<string, number> | null
}

/** Result of closing an eviction cycle. */
export interface BigBrotherEvictionResult {
  cycleId: string
  week: number
  evictedRosterId: string
  voteCount: Record<string, number>
  tieBreakUsed: boolean
  juryEnrolled: boolean
}

