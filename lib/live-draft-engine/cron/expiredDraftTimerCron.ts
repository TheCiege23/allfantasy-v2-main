/**
 * Server-authoritative expired draft timer processing.
 *
 * Runs keeper + slow-draft (snake/linear) or auction automation under the
 * appropriate per-league draft lock. Safe to invoke from Vercel cron with zero
 * connected clients — does not depend on live-sync polling.
 */

import { prisma } from '@/lib/prisma'
import { withAuctionLock, withPickLock } from '@/lib/draft/draftLock'
import {
  draftSessionEligibleForExpiredWallClockCron,
  draftUISettingsFromLeagueStoredSettings,
} from '@/lib/draft-defaults/DraftUISettingsResolver'
import { reconcileOvernightDraftTimerForLeague } from '@/lib/live-draft-engine/DraftSessionService'
import { runSlowDraftAutomationTick } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'
import type { SlowDraftAutomationTickResult } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'
import { runAuctionAutomationTick } from '@/lib/live-draft-engine/auction'
import type { AuctionAutomationTickResult } from '@/lib/live-draft-engine/auction/AuctionAutomationService'
import { runKeeperAutomationTick } from '@/lib/live-draft-engine/keeper/KeeperAutomationService'
import { createTimer } from '@/lib/logging/structured'
import { emitDraftHealth } from '@/lib/draft/observability'
import { recordEngineTelemetrySample } from '@/lib/analytics/recordAnalyticsEvent'
import { ENGINE } from '@/lib/analytics/eventNames'

export type ExpiredDraftTimerProcessResult =
  | { outcome: 'skipped_not_in_progress' }
  | { outcome: 'skipped_timer_not_expired'; reason: string }
  | { outcome: 'skipped_lock_busy'; domain: 'pick' | 'auction' }
  | { outcome: 'skipped_cron_policy'; reason: 'autopick_disabled_or_soft_timer' }
  | {
      outcome: 'processed'
      domain: 'snake' | 'auction'
      changed: boolean
      actions: SlowDraftAutomationTickResult['actions'] | AuctionAutomationTickResult['actions']
    }
  | { outcome: 'error'; message: string }

export type ExpiredDraftTimersBatchResult = {
  scanned: number
  /** Leagues we attempted (including skips after discovery). */
  processed: number
  changed: number
  skippedLockBusy: number
  skippedTimerFresh: number
  skippedNotInProgress: number
  skippedCronPolicy: number
  errors: Array<{ leagueId: string; message: string }>
}

const DEFAULT_BATCH_LIMIT = 100
const MAX_BATCH_LIMIT = 250

/**
 * Leagues whose DraftSession has an expired wall-clock timer (timerEndAt <= now).
 * Paused sessions clear timerEndAt — excluded. Overnight freeze clears timerEndAt — excluded.
 */
export async function discoverExpiredDraftTimerLeagues(
  now: Date,
  opts?: { limit?: number },
): Promise<string[]> {
  const limit = Math.min(MAX_BATCH_LIMIT, Math.max(1, opts?.limit ?? DEFAULT_BATCH_LIMIT))
  const rows = await prisma.draftSession.findMany({
    where: {
      status: 'in_progress',
      timerEndAt: { not: null, lte: now },
    },
    select: { leagueId: true, draftType: true },
    orderBy: { timerEndAt: 'asc' },
    take: limit * 3,
  })
  const uniqueLeagueIds = [...new Set(rows.map((r) => r.leagueId))]
  if (uniqueLeagueIds.length === 0) return []

  const leagues = await prisma.league.findMany({
    where: { id: { in: uniqueLeagueIds } },
    select: { id: true, settings: true },
  })
  const uiByLeague = new Map<string, ReturnType<typeof draftUISettingsFromLeagueStoredSettings>>()
  for (const L of leagues) {
    uiByLeague.set(L.id, draftUISettingsFromLeagueStoredSettings((L.settings as Record<string, unknown>) ?? {}))
  }

  const eligibleLeagueIds: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (eligibleLeagueIds.length >= limit) break
    if (seen.has(r.leagueId)) continue
    const ui = uiByLeague.get(r.leagueId)
    if (!ui) continue
    if (
      !draftSessionEligibleForExpiredWallClockCron({
        draftType: String(r.draftType ?? ''),
        ui,
      })
    ) {
      continue
    }
    seen.add(r.leagueId)
    eligibleLeagueIds.push(r.leagueId)
  }
  return eligibleLeagueIds
}

type BodySkip = { kind: 'skip'; reason: 'not_in_progress' | 'timer_not_expired' }
type BodyTick =
  | { kind: 'tick'; domain: 'snake'; tick: SlowDraftAutomationTickResult }
  | { kind: 'tick'; domain: 'auction'; tick: AuctionAutomationTickResult }

async function runLockedAutomationBody(leagueId: string, now: Date): Promise<BodySkip | BodyTick> {
  await reconcileOvernightDraftTimerForLeague(leagueId, now)

  const session = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: { draftType: true, status: true, timerEndAt: true },
  })
  if (!session || session.status !== 'in_progress') {
    return { kind: 'skip', reason: 'not_in_progress' }
  }
  if (!session.timerEndAt || session.timerEndAt.getTime() > now.getTime()) {
    return { kind: 'skip', reason: 'timer_not_expired' }
  }

  await Promise.resolve(runKeeperAutomationTick(leagueId)).catch(() => {})

  if (session.draftType === 'auction') {
    const tick = await runAuctionAutomationTick(leagueId)
    return { kind: 'tick', domain: 'auction', tick }
  }

  const tick = await runSlowDraftAutomationTick(leagueId, now)
  return { kind: 'tick', domain: 'snake', tick }
}

/**
 * Process one league if its pick/bid timer is still expired after overnight reconcile.
 * Idempotent with concurrent crons: submitPick + unique (sessionId, overall); lock reduces contention.
 */
export async function processExpiredDraftTimerForLeague(
  leagueId: string,
  now: Date = new Date(),
): Promise<ExpiredDraftTimerProcessResult> {
  try {
    const head = await prisma.draftSession.findUnique({
      where: { leagueId },
      select: { id: true, draftType: true, status: true },
    })
    if (!head || head.status !== 'in_progress') {
      return { outcome: 'skipped_not_in_progress' }
    }

    const leagueRow = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { settings: true },
    })
    const ui = draftUISettingsFromLeagueStoredSettings((leagueRow?.settings as Record<string, unknown>) ?? {})
    if (
      !draftSessionEligibleForExpiredWallClockCron({
        draftType: String(head.draftType ?? ''),
        ui,
      })
    ) {
      emitDraftHealth('info', 'draft_expired_timer_processed', {
        leagueId,
        draftSessionId: head.id,
        draftType: String(head.draftType ?? ''),
        outcome: 'skipped',
        reason: 'cron_policy_autopick_or_soft_timer',
        counts: { autoPickEnabled: ui.autoPickEnabled ? 1 : 0 },
      })
      return { outcome: 'skipped_cron_policy', reason: 'autopick_disabled_or_soft_timer' }
    }

    const useAuctionLock = head.draftType === 'auction'
    const locked = useAuctionLock
      ? await withAuctionLock(leagueId, () => runLockedAutomationBody(leagueId, now))
      : await withPickLock(leagueId, () => runLockedAutomationBody(leagueId, now))

    if (!locked.acquired) {
      emitDraftHealth('info', 'draft_expired_timer_processed', {
        leagueId,
        draftSessionId: head.id,
        draftType: String(head.draftType ?? ''),
        outcome: 'skipped',
        reason: useAuctionLock ? 'lock_busy_auction' : 'lock_busy_pick',
      })
      return { outcome: 'skipped_lock_busy', domain: useAuctionLock ? 'auction' : 'pick' }
    }

    const inner = locked.value
    if (inner.kind === 'skip') {
      emitDraftHealth('info', 'draft_expired_timer_processed', {
        leagueId,
        draftSessionId: head.id,
        draftType: String(head.draftType ?? ''),
        outcome: 'skipped',
        reason: inner.reason,
      })
      return {
        outcome: 'skipped_timer_not_expired',
        reason: inner.reason,
      }
    }

    const changed = inner.tick.changed
    const actions = inner.tick.actions
    const actionTypes = actions.map((a) => a.type).join(',')

    for (const a of actions) {
      if (a.type === 'auto_pick') {
        if (inner.domain !== 'auction') continue
        emitDraftHealth('info', 'draft_autopick_fired', {
          leagueId,
          draftSessionId: head.id,
          draftType: String(head.draftType ?? ''),
          outcome: 'fired',
          reason: 'auction_tick',
          rosterId: 'rosterId' in a ? String(a.rosterId) : undefined,
        })
      }
    }

    const auctionActionCounts: Record<string, number> = {}
    for (const a of actions) {
      if (a.type === 'auto_resolve' || a.type === 'auto_bid' || a.type === 'auto_nominate') {
        auctionActionCounts[a.type] = (auctionActionCounts[a.type] ?? 0) + 1
      }
    }
    if (Object.keys(auctionActionCounts).length > 0) {
      emitDraftHealth('info', 'draft_auction_automation_processed', {
        leagueId,
        draftSessionId: head.id,
        draftType: 'auction',
        outcome: changed ? 'changed' : 'noop',
        counts: auctionActionCounts,
      })
    }

    emitDraftHealth('info', 'draft_expired_timer_processed', {
      leagueId,
      draftSessionId: head.id,
      draftType: inner.domain === 'auction' ? 'auction' : 'snake_linear',
      outcome: changed ? 'changed' : 'noop',
      reason: actionTypes || 'none',
      counts: { actionCount: actions.length },
    })

    recordEngineTelemetrySample(ENGINE.DRAFT_EXPIRED_TIMER_CRON, {
      meta: {
        leagueId,
        draftSessionId: head.id,
        domain: inner.domain,
        changed,
        actionTypes: actionTypes || 'none',
      },
    })

    return {
      outcome: 'processed',
      domain: inner.domain,
      changed,
      actions,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    emitDraftHealth('error', 'draft_expired_timer_processed', {
      leagueId,
      outcome: 'error',
      reason: message.slice(0, 500),
      errorClass: e instanceof Error ? e.name : 'unknown',
    })
    return { outcome: 'error', message }
  }
}

/**
 * Batch entry for cron: discover due leagues (or use explicit list) and process each serially.
 */
export async function processExpiredDraftTimersBatch(opts?: {
  now?: Date
  limit?: number
  leagueIds?: string[]
}): Promise<ExpiredDraftTimersBatchResult> {
  const timer = createTimer()
  const now = opts?.now ?? new Date()
  const leagueIds =
    opts?.leagueIds && opts.leagueIds.length > 0
      ? opts.leagueIds
      : await discoverExpiredDraftTimerLeagues(now, { limit: opts?.limit })

  emitDraftHealth('info', 'draft_cron_batch_started', {
    outcome: 'started',
    counts: { scanned: leagueIds.length, limit: opts?.limit ?? DEFAULT_BATCH_LIMIT },
  })

  const result: ExpiredDraftTimersBatchResult = {
    scanned: leagueIds.length,
    processed: 0,
    changed: 0,
    skippedLockBusy: 0,
    skippedTimerFresh: 0,
    skippedNotInProgress: 0,
    skippedCronPolicy: 0,
    errors: [],
  }

  for (const leagueId of leagueIds) {
    const out = await processExpiredDraftTimerForLeague(leagueId, now)
    result.processed += 1
    if (out.outcome === 'skipped_lock_busy') {
      result.skippedLockBusy += 1
    } else if (out.outcome === 'skipped_timer_not_expired') {
      result.skippedTimerFresh += 1
    } else if (out.outcome === 'skipped_not_in_progress') {
      result.skippedNotInProgress += 1
    } else if (out.outcome === 'skipped_cron_policy') {
      result.skippedCronPolicy += 1
    } else if (out.outcome === 'error') {
      result.errors.push({ leagueId, message: out.message })
    } else if (out.outcome === 'processed' && out.changed) {
      result.changed += 1
    }
  }

  emitDraftHealth(result.errors.length ? 'warn' : 'info', 'draft_cron_batch_completed', {
    outcome: result.errors.length ? 'completed_with_errors' : 'completed',
    durationMs: timer.elapsedMs(),
    counts: {
      scanned: result.scanned,
      processed: result.processed,
      changed: result.changed,
      skippedLockBusy: result.skippedLockBusy,
      skippedTimerFresh: result.skippedTimerFresh,
      skippedNotInProgress: result.skippedNotInProgress,
      skippedCronPolicy: result.skippedCronPolicy,
      errorCount: result.errors.length,
    },
  })

  return result
}
