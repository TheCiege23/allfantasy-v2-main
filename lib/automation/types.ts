/**
 * Phase 1 automation foundation — shared types for orchestrated jobs (Inngest-ready).
 *
 * Future phases:
 * - Waivers: `waivers.processLeague` ties into waiver engine + FAAB runs.
 * - Draft: `draft.tick` / `draft.autoPick` drive live draft clock + autopick.
 * - Scoring: `scoring.sync` batches provider stat sync + weekly scoring snapshots.
 * - Trades: `trades.process` handles review windows + ledger updates.
 * - League concepts: guillotine / survivor / big brother batch steps call into specialty engines.
 */

export type AutomationJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped"

/** Known job kinds — extend as new automation surfaces ship. */
export type AutomationJobType =
  | "waivers.processLeague"
  | "draft.tick"
  | "draft.autoPick"
  | "scoring.sync"
  | "lineups.lock"
  | "trades.process"
  | "leagueConcept.guillotine"
  | "leagueConcept.survivor"
  | "leagueConcept.bigBrother"
  | "notifications.dispatch"

export type AutomationContext = {
  jobId?: string
  leagueId?: string
  userId?: string
  jobType: AutomationJobType | string
  idempotencyKey: string
  metadata?: Record<string, unknown>
}

export type AutomationResult = {
  status: AutomationJobStatus
  message?: string
  metadata?: Record<string, unknown>
}

/** Used by future Inngest retries / backoff policies. */
export type RetryPolicy = {
  maxAttempts: number
  /** Optional hint for schedulers (not enforced in Phase 1). */
  backoffMs?: number
}

export type NotificationChannel = "in_app" | "league_chat" | "email" | "sms" | "push"

