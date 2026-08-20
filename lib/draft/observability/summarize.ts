import type { DraftHealthEventId } from './taxonomy'
import { DRAFT_HEALTH_SOURCE } from './taxonomy'

/** Minimal parsed row (e.g. from a log drain JSON line). */
export type DraftHealthLogRow = {
  source?: string
  event?: string
  draftEvent?: DraftHealthEventId
  level?: string
  outcome?: string
  reason?: string
  counts?: Record<string, number>
  [key: string]: unknown
}

function eventKey(row: DraftHealthLogRow): string {
  if (row.source === DRAFT_HEALTH_SOURCE && typeof row.event === 'string') return row.event
  if (typeof row.draftEvent === 'string') return row.draftEvent
  return ''
}

export type DraftCronBatchSummary = {
  batchStarted: number
  batchCompleted: number
  errors: number
  lastDurationMs?: number
  lastCounts?: Record<string, number>
}

export function summarizeDraftCronBatch(rows: DraftHealthLogRow[]): DraftCronBatchSummary {
  let batchStarted = 0
  let batchCompleted = 0
  let errors = 0
  let lastDurationMs: number | undefined
  let lastCounts: Record<string, number> | undefined
  for (const r of rows) {
    const ev = eventKey(r)
    if (ev === 'draft_cron_batch_started') batchStarted += 1
    if (ev === 'draft_cron_batch_completed') {
      batchCompleted += 1
      if (typeof r.durationMs === 'number') lastDurationMs = r.durationMs
      if (r.counts && typeof r.counts === 'object') lastCounts = r.counts as Record<string, number>
      if (r.outcome === 'completed_with_errors') errors += 1
    }
  }
  return { batchStarted, batchCompleted, errors, lastDurationMs, lastCounts }
}

export type LegacyRouteBlockSummary = {
  total: number
  byReason: Record<string, number>
}

export function summarizeLegacyRouteBlocks(rows: DraftHealthLogRow[]): LegacyRouteBlockSummary {
  const byReason: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    const ev = eventKey(r)
    if (ev !== 'legacy_draft_route_blocked') continue
    total += 1
    const reason = typeof r.reason === 'string' ? r.reason : 'unknown'
    byReason[reason] = (byReason[reason] ?? 0) + 1
  }
  return { total, byReason }
}

export type DraftAutomationOutcomeSummary = {
  autopickFired: number
  queuePickUsed: number
  bpaFallbackUsed: number
  autopickSkipped: number
  auctionAutomation: number
  lockBusy: number
  slotOrderRepaired: number
  liveSyncFailures: number
  staleOverall: number
  chimmyLegacyFallback: number
}

export function summarizeDraftAutomationOutcomes(rows: DraftHealthLogRow[]): DraftAutomationOutcomeSummary {
  const out: DraftAutomationOutcomeSummary = {
    autopickFired: 0,
    queuePickUsed: 0,
    bpaFallbackUsed: 0,
    autopickSkipped: 0,
    auctionAutomation: 0,
    lockBusy: 0,
    slotOrderRepaired: 0,
    liveSyncFailures: 0,
    staleOverall: 0,
    chimmyLegacyFallback: 0,
  }
  for (const r of rows) {
    const ev = eventKey(r)
    switch (ev) {
      case 'draft_autopick_fired':
        out.autopickFired += 1
        break
      case 'draft_queue_pick_used':
        out.queuePickUsed += 1
        break
      case 'draft_bpa_fallback_used':
        out.bpaFallbackUsed += 1
        break
      case 'draft_autopick_skipped':
        out.autopickSkipped += 1
        break
      case 'draft_auction_automation_processed':
        out.auctionAutomation += 1
        break
      case 'draft_lock_busy':
        out.lockBusy += 1
        break
      case 'draft_session_slot_order_repaired':
        out.slotOrderRepaired += 1
        break
      case 'draft_live_sync_snapshot_failed':
        out.liveSyncFailures += 1
        break
      case 'draft_pick_stale_overall':
        out.staleOverall += 1
        break
      case 'chimmy_legacy_draft_signal_fallback':
        out.chimmyLegacyFallback += 1
        break
      default:
        break
    }
  }
  return out
}
