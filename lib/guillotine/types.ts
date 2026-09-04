/**
 * Shared types for the Guillotine league backend engine.
 */

import type { LeagueSport } from '@prisma/client'

export type TiebreakStep =
  | 'bench_points'
  | 'season_points'
  | 'previous_period'
  | 'draft_slot'
  | 'commissioner'
  | 'random'

/** Config loaded from DB (GuillotineLeagueConfig + League.sport). */
export interface GuillotineConfig {
  leagueId: string
  sport: LeagueSport
  eliminationStartWeek: number
  eliminationEndWeek: number | null
  teamsPerChop: number
  correctionWindow: 'immediate' | 'after_stat_corrections' | 'custom_cutoff'
  customCutoffDayOfWeek: number | null
  customCutoffTimeUtc: string | null
  statCorrectionHours: number | null
  tiebreakerOrder: TiebreakStep[]
  dangerMarginPoints: number | null
  rosterReleaseTiming: 'immediate' | 'next_waiver_run' | 'custom_time'
  commissionerOverride: boolean
}

/** One roster's score for a period (for evaluation and tiebreak). */
export interface PeriodScoreRow {
  rosterId: string
  displayName?: string
  periodPoints: number
  seasonPointsCumul: number
  previousPeriodPoints?: number
  /** Optional bench points for tiebreak (lower bench points loses when step is bench_points). */
  benchPoints?: number
  draftSlot?: number
}

/** Result of week evaluation: who is eligible for chop (ranked worst-first). */
export interface GuillotineWeekEvalResult {
  leagueId: string
  weekOrPeriod: number
  season: number | null
  pastCutoff: boolean
  activeRosterIds: string[]
  scores: PeriodScoreRow[]
  orderedWorstFirst: string[]
  alreadyChoppedRosterIds: string[]
}

/** Result of running elimination (who was chopped). */
export interface GuillotineChopResult {
  leagueId: string
  weekOrPeriod: number
  choppedRosterIds: string[]
  tiebreakStepUsed: TiebreakStep | null
  reason?: string
  /**
   * What became of the denormalized `RedraftRoster.isEliminated` flag for this chop.
   *
   * 🛑 REPORTED RATHER THAN ASSUMED, BECAUSE IT USED TO FAIL SILENTLY. The engine chops in
   * `Roster` id space; the flag consumers read lives on `RedraftRoster`, and the two are linked
   * only by platform user id, which resolves for roughly 83-87% of production rows. `unresolved`
   * names the chopped rosters whose team will still show as active in standings.
   *
   * Optional because the early-return paths chop nobody and have nothing to report.
   */
  eliminationFlagged?: { marked: string[]; unresolved: string[] }
  /**
   * Whether the audit half ran — the `GuillotineElimination` record, survival log and season
   * counters that only the manual engine used to write.
   *
   * ⚠ `recorded: false` IS AN ORDINARY OUTCOME, NOT A FAILURE. Production holds zero
   * `GuillotineSeason` rows because only a manual route creates one, so `no_guillotine_season` is
   * what almost every chop will report today. The chop itself still happened; the bookkeeping did
   * not. Reported rather than swallowed so the difference is legible.
   */
  audit?:
    | { recorded: true; seasonId: string; eliminations: number; survivalRows: number }
    | { recorded: false; reason: 'no_guillotine_season' | 'already_recorded' }
}

/** Danger tier for one roster. */
export type DangerTier = 'chop_zone' | 'danger' | 'safe'

export interface GuillotineDangerRow {
  rosterId: string
  displayName?: string
  projectedPoints: number
  seasonPointsCumul: number
  tier: DangerTier
  rank: number
  pointsFromChopZone: number
}

/** Survival standings row (active rosters only). */
export interface GuillotineSurvivalStanding {
  rosterId: string
  displayName?: string
  rank: number
  seasonPointsCumul: number
  periodPoints?: number
  isChopped: false
}

/** Event types for GuillotineEventLog. */
export type GuillotineEventType =
  | 'first_league_entry'
  | 'post_draft_intro'
  | 'chop'
  | 'commissioner_override'
  | 'weekly_recap'
  | 'chop_animation_trigger'
  | 'roster_released'
  | 'removal_request'
