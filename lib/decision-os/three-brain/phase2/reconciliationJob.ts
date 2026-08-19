/**
 * Blocker 3 — automatic, durable reservation reconciliation. A hold that is neither finalized nor released
 * (finalize crashed after persistence, or a worker abandoned a failed run) must be settled or returned WITHOUT
 * waiting for the user to make another request. This sweep reconciles every expired hold against the persisted
 * run state and is idempotent across concurrent workers (finalize/release are status-gated: `reserved` →
 * `finalized`/`released` exactly once).
 *
 * Decisions per expired hold:
 *   - run succeeded with a persisted result           → FINALIZE once (settle the successful run)
 *   - run failed / invalidated / missing              → RELEASE once (return the hold)
 *   - run running with a VALID lease                  → LEAVE (active)
 *   - ambiguous (pending / stale-running) beyond a hard abandonment threshold → RELEASE as a safety net
 *   - ambiguous within threshold                      → keep the hold, emit an observable warning
 *
 * Server-side only. Injectable client + observer for tests.
 */
import 'server-only'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { runAutomationJob } from '@/lib/automation/engine'
import { TokenReservationService } from '@/lib/tokens/TokenReservationService'
import { noopObserver, type IntelligenceObserver } from './observability'

type PrismaLike = typeof defaultPrisma

export const RESERVATION_RECONCILE_JOB_TYPE = 'decision_os.reservation_reconcile'

export type ReconcileSummary = {
  processed: number
  finalized: number
  released: number
  left: number
  ambiguous: number
  /** Items skipped because the lease fence reported ownership loss mid-sweep (fail-safe stop). */
  fenced?: number
}

/**
 * Reconcile expired holds against run state. Idempotent + safe under concurrent workers. Never finalizes a
 * failed run, never releases an active valid reservation, never finalizes twice.
 */
export async function reconcileReservations(opts?: {
  db?: PrismaLike
  now?: Date
  limit?: number
  /** Beyond this age an ambiguous hold is released as a safety net (default 1h). */
  hardAbandonMs?: number
  observer?: IntelligenceObserver
  /** Lease fence — checked BEFORE each settlement. Returns false when this worker has lost the lease, so a
   *  stale owner cannot keep settling holds after a successor took over. Renews the lease as a heartbeat too. */
  fence?: () => Promise<boolean>
}): Promise<ReconcileSummary> {
  const db = opts?.db ?? defaultPrisma
  const now = opts?.now ?? new Date()
  const observer = opts?.observer ?? noopObserver
  const hardAbandonMs = opts?.hardAbandonMs ?? 60 * 60_000
  const svc = new TokenReservationService(db)

  const expired = await db.tokenReservation.findMany({
    where: { status: 'reserved', expiresAt: { lt: now } },
    orderBy: { expiresAt: 'asc' },
    take: Math.max(1, Math.min(500, opts?.limit ?? 200)),
  })

  const summary: ReconcileSummary = { processed: expired.length, finalized: 0, released: 0, left: 0, ambiguous: 0, fenced: 0 }

  for (const r of expired) {
    // Fence BEFORE any settlement: if the lease was lost, stop — a successor now owns the sweep.
    if (opts?.fence && !(await opts.fence())) { summary.fenced = (summary.fenced ?? 0) + 1; break }
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: r.idempotencyKey } })
    const ageMs = now.getTime() - new Date(r.reservedAt).getTime()

    if (run && run.status === 'succeeded' && run.resultJson != null) {
      await svc.finalize({ userId: r.userId, idempotencyKey: r.idempotencyKey }) // settle exactly once (idempotent)
      summary.finalized += 1
      continue
    }
    if (!run || run.status === 'failed' || run.status === 'invalidated' || run.status === 'unknown') {
      // 'unknown' (owner crashed mid-provider-request) is NEVER finalized — the hold is returned, never charged.
      await svc.release({ userId: r.userId, idempotencyKey: r.idempotencyKey, reason: run?.status === 'unknown' ? 'reconcile_unknown_outcome' : 'reconcile_failed_or_missing' })
      summary.released += 1
      continue
    }
    const leaseLive = run.status === 'running' && run.leaseExpiresAt != null && run.leaseExpiresAt.getTime() > now.getTime()
    if (leaseLive) {
      summary.left += 1 // actively running — never release out from under it
      continue
    }
    if (ageMs > hardAbandonMs) {
      await svc.release({ userId: r.userId, idempotencyKey: r.idempotencyKey, reason: 'reconcile_abandoned' })
      summary.released += 1
      continue
    }
    // Ambiguous (pending / stale-running within threshold) → preserve the hold, warn, let a later sweep retry.
    summary.ambiguous += 1
    observer.emit({
      type: 'failure',
      tool: run.tool,
      decisionType: run.decisionType,
      userId: r.userId,
      failureCategory: 'stale_lock_recovery',
      meta: { stage: 'reconcile_ambiguous', reservationId: r.id, runStatus: run.status },
    })
  }
  return summary
}

/** Durable wrapper — runs the sweep as one attempt-bounded, audited AutomationJob per scheduler tick. */
export async function runReconciliationJob(opts: {
  tickId: string
  db?: PrismaLike
  now?: Date
  limit?: number
  hardAbandonMs?: number
  observer?: IntelligenceObserver
}): Promise<ReconcileSummary & { jobId: string }> {
  const db = opts.db ?? defaultPrisma
  const res = await runAutomationJob(
    { idempotencyKey: `reconcile:${opts.tickId}`, jobType: RESERVATION_RECONCILE_JOB_TYPE, metadata: {} },
    async () => {
      const summary = await reconcileReservations(opts)
      return { status: 'completed', metadata: summary }
    },
    { prisma: db, maxAttempts: 3 },
  )
  const summary = (res.metadata ?? {}) as ReconcileSummary
  return { ...summary, jobId: res.jobId }
}
