/**
 * Discovers leagues whose batched waiver claims should run soon.
 *
 * Data sources:
 * - Pending rows on `WaiverClaim` (`status = 'pending'`)
 * - `LeagueWaiverState.nextRunAt` / `processingLocked` (`lib/waiver-wire/waiver-state-service`)
 * - Effective waiver mode via `getEffectiveLeagueWaiverSettings` (skips `fcfs` — FCFS is claim-time in `process-engine` docs)
 *
 * Fallback when `nextRunAt` is missing: include leagues with pending claims (conservative — cron may process earlier than ideal until state backfills).
 */

import { buildIdempotencyKey, hashIdempotencyKey } from "@/lib/automation/idempotency"
import type { DueWaiverLeague } from "@/lib/automation/jobs/waivers/waiverAutomationTypes"
import { prisma } from "@/lib/prisma"
import { getEffectiveLeagueWaiverSettings } from "@/lib/waiver-wire/settings-service"
import { getLeagueWaiverState } from "@/lib/waiver-wire/waiver-state-service"
import { guillotineClaimsCutoff, isBlindAuctionLeague } from "@/lib/guillotine/blindWaiverCutoff"

export type DiscoverDueWaiverLeaguesOptions = {
  limit?: number
  now?: Date
  leagueId?: string
}

function utcDateBucket(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function buildWaiverProcessIdempotencyKey(leagueId: string, scheduledFor: Date): string {
  const raw = buildIdempotencyKey(["waivers.processLeague", leagueId, utcDateBucket(scheduledFor)])
  return hashIdempotencyKey(raw)
}

export async function discoverDueWaiverLeagues(
  options?: DiscoverDueWaiverLeaguesOptions
): Promise<DueWaiverLeague[]> {
  const limit = options?.limit ?? 25
  const now = options?.now ?? new Date()

  const grouped = await prisma.waiverClaim.groupBy({
    by: ["leagueId"],
    where: {
      status: "pending",
      ...(options?.leagueId ? { leagueId: options.leagueId } : {}),
    },
    _count: { _all: true },
  })

  grouped.sort((a, b) => b._count._all - a._count._all)

  const out: DueWaiverLeague[] = []

  for (const row of grouped) {
    if (out.length >= limit) break

    const leagueId = row.leagueId
    const pendingClaimCount = row._count._all

    const state = await getLeagueWaiverState(leagueId).catch(() => null)
    if (state?.processingLocked) {
      continue
    }

    const running = await prisma.waiverRun.findFirst({
      where: { leagueId, status: "running" },
      select: { id: true },
    })
    if (running) {
      continue
    }

    let settings: Awaited<ReturnType<typeof getEffectiveLeagueWaiverSettings>>
    try {
      settings = await getEffectiveLeagueWaiverSettings(leagueId)
    } catch {
      continue
    }

    const waiverType = settings.normalizedWaiverType ?? settings.waiverType ?? "rolling"
    // Guilly blind FAAB auction (lib/guillotine/blindWaiverCutoff.ts). While the window holds every
    // pending claim, the league is NOT due: a run that settles nothing would still spend the day's
    // idempotency key and push the real auction to tomorrow. And an FCFS Guilly league is not skipped,
    // because the claims it held at claim time have no other way to settle once the window closes.
    const league = await prisma.league
      .findUnique({ where: { id: leagueId }, select: { sport: true, guillotineMode: true, leagueVariant: true } })
      .catch(() => null)
    const blindLeague = league != null && isBlindAuctionLeague(league)
    if (blindLeague) {
      const cutoff = await guillotineClaimsCutoff(leagueId, now, league)
      if (cutoff) {
        const dueCount = await prisma.waiverClaim.count({ where: { leagueId, status: "pending", createdAt: { lt: cutoff } } })
        if (dueCount === 0) continue
      }
    }
    if (waiverType === "fcfs" && !blindLeague) {
      continue
    }

    const nextRunAt = state?.nextRunAt ?? null
    let discoveryReason = "pending_claims"
    let due = true

    if (nextRunAt != null) {
      if (now.getTime() < nextRunAt.getTime()) {
        due = false
        discoveryReason = "before_next_run_at"
      } else {
        discoveryReason = "next_run_at_elapsed"
      }
    } else {
      discoveryReason = "pending_claims_no_next_run_at_fallback"
    }

    if (!due) {
      continue
    }

    const scheduledFor = nextRunAt ?? now
    const idempotencyKey = buildWaiverProcessIdempotencyKey(leagueId, scheduledFor)

    out.push({
      leagueId,
      scheduledFor,
      waiverType,
      idempotencyKey,
      pendingClaimCount,
      metadata: {
        nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
        processingLocked: Boolean(state?.processingLocked),
        discoveryReason,
      },
    })
  }

  return out
}
