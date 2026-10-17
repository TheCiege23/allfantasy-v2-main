/**
 * Waiver wire engine – shared types (multi-sport).
 */

export const WAIVER_TYPES = [
  "faab",
  "rolling",
  "reverse_standings",
  "fcfs",
  "standard",
] as const
export type WaiverType = (typeof WAIVER_TYPES)[number]

export const WAIVER_CLAIM_STATUSES = [
  "pending",
  "processed",
  "failed",
  "cancelled",
] as const
export type WaiverClaimStatus = (typeof WAIVER_CLAIM_STATUSES)[number]

export const TIEBREAK_RULES = [
  "faab_highest",
  "priority_lowest_first",
  "reverse_standings",
  "earliest_claim",
] as const
export type TiebreakRule = (typeof TIEBREAK_RULES)[number]

export type LeagueWaiverSettingsInput = {
  waiverType?: WaiverType | string
  processingDayOfWeek?: number | null
  processingTimeUtc?: string | null
  claimLimitPerPeriod?: number | null
  claimLimitPerWeek?: number | null
  claimLimitPerRun?: number | null
  faabBudget?: number | null
  faabResetDate?: string | Date | null
  faabResetType?: string | null
  waiverOrderResetPolicy?: string | null
  postGameWaiverBehavior?: string | null
  processingDays?: unknown
  freeAgentWindowRules?: unknown
  dropRestrictions?: unknown
  commissionerOverrideRules?: unknown
  specialtyConceptOverrides?: unknown
  /** Extended rules JSON (min FAAB bid, undroppable ids, drop lock policy, etc.) */
  waiverEngineConfig?: unknown
  tiebreakRule?: TiebreakRule | string | null
  lockType?: string | null
  instantFaAfterClear?: boolean
}

export type WaiverClaimInput = {
  addPlayerId: string
  dropPlayerId?: string | null
  faabBid?: number | null
  priorityOrder?: number
  userId?: string | null
  claimType?: string
  metadata?: Record<string, unknown> | null
}

/** Stable codes for UI, history, and AI — align with `WAIVER_TX_RESULT_CODES` where applicable. */
export type WaiverClaimOutcomeCode =
  | "won"
  | "lost_priority"
  | "lost_tiebreaker"
  | "insufficient_faab"
  | "invalid_due_to_roster"
  | "player_no_longer_available"
  | "blocked_by_lineup_lock"
  | "blocked_by_roster_lock"
  | "blocked_by_ir_taxi_devy_violation"
  | "failed"

export type ProcessedClaimResult = {
  claimId: string
  rosterId: string
  success: boolean
  addPlayerId: string
  dropPlayerId?: string | null
  faabSpent?: number | null
  message?: string
  waiverRunId?: string
  /** Outcome code for notifications and transaction history. */
  outcomeCode?: WaiverClaimOutcomeCode
}
