/**
 * Waiver automation (Phase 2) — types for cron/admin/manual runs.
 *
 * Reused persistence:
 * - `WaiverClaim`, `WaiverRun`, `LeagueWaiverState`, `League` (Prisma)
 * - `processWaiverClaimsForLeague` from `@/lib/waiver-wire/process-engine` (core processor)
 * - `getEffectiveLeagueWaiverSettings` from `@/lib/waiver-wire/settings-service`
 * - `getLeagueWaiverState` from `@/lib/waiver-wire/waiver-state-service`
 */

import type { ProcessedClaimResult } from "@/lib/waiver-wire/types"

import type { WaiverAutomationSummary } from "./waiverAutomationSummary"

type WaiverAutomationTrigger = "cron" | "admin" | "manual" | "test"

export type DueWaiverLeague = {
  leagueId: string
  /** Best-effort instant used for idempotency bucketing + logging (often `LeagueWaiverState.nextRunAt` or `now`). */
  scheduledFor: Date
  waiverType: string
  /** Deterministic key shared with `runAutomationJob` / `processWaiverClaimsForLeague`. */
  idempotencyKey: string
  pendingClaimCount: number
  metadata: {
    nextRunAt: string | null
    processingLocked: boolean
    discoveryReason: string
  }
}

export type ProcessLeagueWaiversInput = {
  leagueId: string
  scheduledFor?: Date
  trigger: WaiverAutomationTrigger
  /** Skip `processWaiverClaimsForLeague` — for safe previews (still records automation when routed through `runAutomationJob`). */
  dryRun?: boolean
  /** Explicit user when trigger is manual/admin (optional). */
  actorUserId?: string | null
}

export type ProcessLeagueWaiversResult = {
  ok: boolean
  leagueId: string
  trigger: WaiverAutomationTrigger
  dryRun: boolean
  automationJobId: string
  automationRunId: string
  /** Normalized aggregates over `ProcessedClaimResult[]`. */
  summary: WaiverAutomationSummary
  /** Raw processor output when not dry-run (empty when dry-run or lock/engine short-circuit). */
  rawResults: ProcessedClaimResult[]
  message?: string
}
