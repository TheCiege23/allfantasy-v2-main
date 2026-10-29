/**
 * Orchestrated waiver batch for a single league.
 *
 * Reuses:
 * - `processWaiverClaimsForLeague` — `lib/waiver-wire/process-engine.ts` (FAAB / rolling / reverse standings ordering).
 * - `runAutomationJob` — durable automation envelope + idempotency (`AutomationJob` / `AutomationRun`).
 * - `withAutomationLock` — `waiver:league:{leagueId}` mutex (Upstash or Postgres fallback).
 * - `NotificationOutbox` — the league-chat announcement only. Per-claim bell entries come from
 *   `onWaiverRunComplete`, through the notification dispatcher (see notifyClaimOutcomes).
 * - `RealtimeEvent` — per-claim realtime fan-out.
 */

import { randomUUID } from "crypto"

import { writeAutomationAuditLog } from "@/lib/automation/audit"
import { runAutomationJob } from "@/lib/automation/engine"
import { RetryableAutomationError, toErrorMessage } from "@/lib/automation/errors"
import { buildWaiverProcessIdempotencyKey } from "@/lib/automation/jobs/waivers/discoverDueWaiverLeagues"
import { summarizeWaiverProcessingResults } from "@/lib/automation/jobs/waivers/waiverAutomationSummary"
import type {
  ProcessLeagueWaiversInput,
  ProcessLeagueWaiversResult,
} from "@/lib/automation/jobs/waivers/waiverAutomationTypes"
import type { WaiverAutomationSummary } from "@/lib/automation/jobs/waivers/waiverAutomationSummary"
import { withAutomationLock } from "@/lib/automation/locks"
import { enqueueLeagueChatNotification } from "@/lib/automation/notifications"
import { publishRealtimeEvent } from "@/lib/automation/realtime"
import type { AutomationResult } from "@/lib/automation/types"
import { prisma } from "@/lib/prisma"
import { processWaiverClaimsForLeague, type WaiverRunSkipReason } from "@/lib/waiver-wire/process-engine"
import type { ProcessedClaimResult } from "@/lib/waiver-wire/types"

const WAIVER_SKIP_MESSAGES: Record<WaiverRunSkipReason, string> = {
  league_moves_locked:
    "League skipped: the commissioner has locked all roster moves. Pending claims stay pending until the lock is lifted.",
}

function mapRunType(trigger: ProcessLeagueWaiversInput["trigger"]): string {
  if (trigger === "manual" || trigger === "admin") return "manual"
  return "scheduled"
}

async function notifyClaimOutcomes(leagueId: string, rawResults: ProcessedClaimResult[]): Promise<void> {
  const rosterIds = [...new Set(rawResults.map((r) => r.rosterId))]
  if (rosterIds.length === 0) return

  const rosters = await prisma.roster.findMany({
    where: { id: { in: rosterIds } },
    select: { id: true, platformUserId: true },
  })
  const userByRoster = new Map(rosters.map((r) => [r.id, r.platformUserId]))

  for (const r of rawResults) {
    const uid = userByRoster.get(r.rosterId)
    if (!uid) continue

    /*
     * 🛑 REALTIME ONLY. This used to queue a bell entry per claim as well, and that was a
     * SECOND copy: processWaiverClaimsForLeague runs onWaiverRunComplete (run-hooks.ts),
     * which already announces "Waiver claim awarded" / "not awarded" through the
     * notification dispatcher. The queued copies were written by the outbox relay, which
     * checks only the fatigue budget — so every won claim would reach the bell twice, and
     * one of the two ignored the user's waiver switch and league mutes.
     *
     * Removed 2026-09-14. Measured on production that day: no waiver-claim notification of
     * either kind in 30 days, and the outbox's last waiver rows date from June, so the
     * duplicate had not yet reached anyone. The run hook now covers every failed claim,
     * which this queue was the only path to announce.
     */
    if (r.success) {
      await publishRealtimeEvent({
        leagueId,
        userId: uid,
        eventType: "waivers.claim.awarded",
        payload: {
          claimId: r.claimId,
          rosterId: r.rosterId,
          addPlayerId: r.addPlayerId,
          outcomeCode: r.outcomeCode ?? null,
        },
      })
    } else {
      await publishRealtimeEvent({
        leagueId,
        userId: uid,
        eventType: "waivers.claim.failed",
        payload: {
          claimId: r.claimId,
          rosterId: r.rosterId,
          addPlayerId: r.addPlayerId,
          outcomeCode: r.outcomeCode ?? null,
          message: r.message ?? null,
        },
      })
    }
  }
}

async function executeLockedWaiverProcess(input: {
  jobId: string
  leagueId: string
  trigger: ProcessLeagueWaiversInput["trigger"]
  dryRun: boolean
  actorUserId?: string | null
  scheduledFor: Date
  idempotencyKey: string
}): Promise<{ result: AutomationResult; rawResults: ProcessedClaimResult[] }> {
  const { leagueId, trigger, dryRun, actorUserId, scheduledFor, idempotencyKey } = input

  try {
    await publishRealtimeEvent({
      leagueId,
      eventType: "waivers.processing.started",
      payload: {
        automationJobId: input.jobId,
        trigger,
        dryRun,
        scheduledFor: scheduledFor.toISOString(),
      },
    })

    if (dryRun) {
      const summary = summarizeWaiverProcessingResults([], {
        extraMetadata: { dryRun: true, trigger },
      })
      await publishRealtimeEvent({
        leagueId,
        eventType: "waivers.processing.completed",
        payload: {
          dryRun: true,
          summary,
        },
      })
      await enqueueLeagueChatNotification({
        leagueId,
        eventType: "WAIVER_PROCESSING_COMPLETE",
        title: "Waiver run (dry run)",
        body: summary.message,
        metadata: { dryRun: true, trigger },
      })
      await writeAutomationAuditLog({
        leagueId,
        action: "waivers.processed",
        entityType: "league",
        entityId: leagueId,
        jobId: input.jobId,
        message: summary.message,
        metadata: { dryRun: true, trigger, summary },
      })
      return {
        result: {
          status: "completed",
          message: summary.message,
          metadata: { summary },
        },
        rawResults: [],
      }
    }

    const skip: { reason: WaiverRunSkipReason | null } = { reason: null }
    const rawResults = await processWaiverClaimsForLeague(leagueId, {
      runType: mapRunType(trigger),
      processedByUserId: actorUserId ?? null,
      idempotencyKey,
      onSkip: (reason) => {
        skip.reason = reason
      },
    })

    /*
     * 🛑 SKIPPED, NOT COMPLETED. The idempotency key is the league plus the UTC day of `nextRunAt`, and a
     * run the engine skipped does not move `nextRunAt` — so a COMPLETED job here would spend that key for
     * good and the claims would never settle after the commissioner lifts the lock. A skipped job re-runs
     * on the next fire. No "Waivers processed" chat post either: nothing was.
     */
    const skippedReason = skip.reason
    if (skippedReason) {
      const message = WAIVER_SKIP_MESSAGES[skippedReason]
      const summary = {
        ...summarizeWaiverProcessingResults([], { extraMetadata: { trigger, skippedReason } }),
        message,
      }
      await publishRealtimeEvent({
        leagueId,
        eventType: "waivers.processing.completed",
        payload: { processedCount: 0, awarded: 0, failed: 0, skippedReason },
      })
      await writeAutomationAuditLog({
        leagueId,
        action: "waivers.skipped",
        entityType: "league",
        entityId: leagueId,
        jobId: input.jobId,
        message,
        metadata: { trigger, skippedReason },
      })
      return {
        result: { status: "skipped", message, metadata: { summary } },
        rawResults: [],
      }
    }

    const summary = summarizeWaiverProcessingResults(rawResults, {
      extraMetadata: { trigger },
    })

    await publishRealtimeEvent({
      leagueId,
      eventType: "waivers.processing.completed",
      payload: {
        processedCount: summary.processedClaims,
        awarded: summary.awardedClaims,
        failed: summary.failedClaims,
      },
    })

    await notifyClaimOutcomes(leagueId, rawResults)

    await enqueueLeagueChatNotification({
      leagueId,
      eventType: "WAIVER_PROCESSING_COMPLETE",
      title: "Waivers processed",
      body: summary.message,
      metadata: {
        leagueId,
        processedClaims: summary.processedClaims,
        awardedClaims: summary.awardedClaims,
      },
    })

    await writeAutomationAuditLog({
      leagueId,
      action: "waivers.processed",
      entityType: "league",
      entityId: leagueId,
      jobId: input.jobId,
      message: summary.message,
      metadata: { trigger, summary },
    })

    return {
      result: {
        status: "completed",
        message: summary.message,
        metadata: { summary },
      },
      rawResults,
    }
  } catch (error: unknown) {
    await publishRealtimeEvent({
      leagueId,
      eventType: "waivers.processing.failed",
      payload: {
        message: toErrorMessage(error),
      },
    })
    throw error
  }
}

export async function processLeagueWaiversJob(
  input: ProcessLeagueWaiversInput
): Promise<ProcessLeagueWaiversResult> {
  const scheduledFor = input.scheduledFor ?? new Date()
  const idempotencyKey = buildWaiverProcessIdempotencyKey(input.leagueId, scheduledFor)
  const dryRun = Boolean(input.dryRun)

  let capturedRaw: ProcessedClaimResult[] = []

  const automation = await runAutomationJob(
    {
      jobType: "waivers.processLeague",
      leagueId: input.leagueId,
      idempotencyKey,
      metadata: {
        trigger: input.trigger,
        dryRun,
        scheduledFor: scheduledFor.toISOString(),
      },
    },
    async (ctx) => {
      const owner = `waiver:${ctx.jobId}:${randomUUID()}`
      const locked = await withAutomationLock(
        `waiver:league:${input.leagueId}`,
        { owner, ttlMs: 120_000 },
        async () => {
          const pack = await executeLockedWaiverProcess({
            jobId: ctx.jobId,
            leagueId: input.leagueId,
            trigger: input.trigger,
            dryRun,
            actorUserId: input.actorUserId ?? null,
            scheduledFor,
            idempotencyKey,
          })
          capturedRaw = pack.rawResults
          return pack.result
        }
      )

      if (!locked.ok) {
        throw new RetryableAutomationError(`Waiver lock unavailable: ${locked.reason}`)
      }

      return locked.value
    }
  )

  const meta = automation.metadata as { summary?: WaiverAutomationSummary } | undefined

  const summary =
    meta?.summary ??
    summarizeWaiverProcessingResults(capturedRaw, {
      extraMetadata: { automationStatus: automation.status },
    })
  const rawResults = capturedRaw

  return {
    ok: automation.status === "completed" || automation.status === "skipped",
    leagueId: input.leagueId,
    trigger: input.trigger,
    dryRun,
    automationJobId: automation.jobId,
    automationRunId: automation.runId,
    summary,
    rawResults,
    message: automation.message,
  }
}

export { buildWaiverProcessIdempotencyKey as buildWaiverJobIdempotencyKey } from "./discoverDueWaiverLeagues"

