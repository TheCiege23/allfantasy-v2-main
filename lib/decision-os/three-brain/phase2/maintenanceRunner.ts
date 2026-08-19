/**
 * The maintenance RUNNER. Registers + discovers + invokes the durable intelligence-refresh drain and the
 * token-reservation reconciliation drain. A cron route (`app/api/cron/decision-os-intelligence-maintenance`)
 * triggers it every 10 minutes.
 *
 * Overlap safety — TRUE global lease (Issue 2): the whole sweep runs under ONE shared DB-backed lease
 * (`withAutomationLock` on `INTELLIGENCE_MAINTENANCE_LOCK_KEY`, an `AutomationLock` row with owner + expiresAt +
 * atomic acquisition). Because every invocation contends on the SAME lock key, DIFFERENT tick ids cannot run the
 * drains concurrently — the loser returns `status:'skipped'`. A crashed owner is recovered when the lease
 * expires (bounded window, no heartbeat needed for a sub-minute sweep). The drains run OUTSIDE the acquire
 * transaction, so no DB transaction is held open while draining. Per-refresh (run owner-token lease) and
 * per-reservation (status-gated claim) idempotency remain as defense-in-depth so even a bypassed lease cannot
 * double-execute. Batch sizes / lease TTL / abandonment thresholds are bounded.
 *
 * STANDALONE — not wired to any live Decision OS/Chimmy user route.
 */
import 'server-only'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { withAutomationLock, renewAutomationLock } from '@/lib/automation/locks'
import { drainIntelligenceRefreshJobs } from './refreshJob'
import { reconcileReservations } from './reconciliationJob'
import type { ManagedIntelligenceDeps } from './intelligenceService'

type PrismaLike = typeof defaultPrisma

/** A lease fence: renews (heartbeat) the lease if still owned and reports ownership. `false` = lease lost →
 *  the caller must stop settling. Checked before every unit of settlement work in each drain. */
export type LeaseFence = () => Promise<boolean>

/** The ONE global maintenance lease key — all ticks contend on this so only one runner executes at a time. */
export const INTELLIGENCE_MAINTENANCE_LOCK_KEY = 'decision_os.intelligence_maintenance'
const DEFAULT_LEASE_MS = 5 * 60_000

/** A DB-backed lease: acquire the named lock for `owner`, run `fn` OUTSIDE the acquire transaction, release.
 *  Injectable so the runner is testable; the default is the repo's `withAutomationLock` (AutomationLock row +
 *  owner + expiresAt + atomic acquire + crash recovery via expiry). */
export type MaintenanceLease = <T>(
  owner: string,
  ttlMs: number,
  fn: () => Promise<T>,
) => Promise<{ ok: true; value: T } | { ok: false; reason: string }>

/** The default lease is the repo's real AutomationLock, bound to the runner's own db client so a worker with a
 *  dedicated PrismaClient (and the isolated-DB integration tests) exercise the SAME lock code, not a stub. */
const makeDefaultLease = (db: PrismaLike): MaintenanceLease => (owner, ttlMs, fn) =>
  withAutomationLock(INTELLIGENCE_MAINTENANCE_LOCK_KEY, { owner, ttlMs }, fn, db)

export type MaintenanceRunnerConfig = {
  refreshBatch?: number
  reconcileBatch?: number
  hardAbandonMs?: number
  staleRunningMs?: number
  leaseMs?: number
  /** Heartbeat interval — the lease is renewed every `heartbeatMs` DURING the sweep (incl. long provider calls),
   *  so a legitimate long run never expires. Default: leaseMs/3. */
  heartbeatMs?: number
  /** Hard execution deadline — abort the whole sweep (incl. in-flight provider calls) after `deadlineMs`, safely
   *  shorter than the lease, so no execution can outlive the lease. Default: min(leaseMs, staleRunningMs)*0.8. */
  deadlineMs?: number
  /** Injectable lease (default: repo AutomationLock via withAutomationLock). */
  lease?: MaintenanceLease
  /** Injectable owner-scoped renew (default: `renewAutomationLock`). Used by the heartbeat AND the per-item
   *  fence; returns false when ownership is lost. Tests stub this. */
  fence?: LeaseFence
  /** Injectable AbortController — tests drive abort deterministically. Default: a fresh controller. */
  controller?: AbortController
  /** Observability for the renewable-deadline heartbeat (each successful renew) — used by timestamp tests. */
  onHeartbeat?: (e: HeartbeatEvent) => void
}

/** Timestamp observability for the renewable-deadline heartbeat (tests assert deadline < renewed lease expiry). */
export type HeartbeatEvent = { at: number; renewedLeaseExpiryAt: number; deadlineAt: number }

/**
 * Independent periodic heartbeat with a RENEWABLE deadline (Issue-3 contract A). Every `intervalMs` it renews
 * the owner-scoped lease (to now + `leaseMs`) AND re-arms the execution deadline (to now + `deadlineWindowMs`).
 * INVARIANT: `deadlineWindowMs < leaseMs` and `intervalMs < deadlineWindowMs`, so the active deadline is ALWAYS
 * strictly before the renewed lease expiry, and a healthy beat re-arms the deadline before it can fire. A long
 * execution may therefore outlive the ORIGINAL lease/deadline ONLY because BOTH were renewed together. The first
 * renew failure (ownership lost) aborts immediately; if beats stop entirely (crash) the last-armed deadline
 * fires — a dead-man's switch that guarantees no execution continues without a currently-valid lease. Recursive
 * setTimeout (never overlapping), fully torn down by `stop()` — no fire-and-forget timer, no unhandled rejection.
 */
function startLeaseHeartbeat(input: {
  renew: LeaseFence
  intervalMs: number
  leaseMs: number
  deadlineWindowMs: number
  controller: AbortController
  onBeat?: (e: HeartbeatEvent) => void
}): { stop: () => void } {
  let stopped = false
  let hb: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  const armDeadline = () => {
    if (deadline) clearTimeout(deadline)
    deadline = setTimeout(() => input.controller.abort(), input.deadlineWindowMs)
  }
  const beat = async () => {
    if (stopped) return
    let ok = false
    try { ok = await input.renew() } catch { ok = false }
    if (stopped) return
    if (!ok) { input.controller.abort(); return } // lease lost → abort; stop beating (do NOT advance the deadline)
    const now = Date.now()
    armDeadline() // RENEWABLE: advance the deadline; still < the freshly renewed lease expiry (invariant above)
    input.onBeat?.({ at: now, renewedLeaseExpiryAt: now + input.leaseMs, deadlineAt: now + input.deadlineWindowMs })
    hb = setTimeout(beat, input.intervalMs)
  }
  armDeadline() // initial deadline, < the original lease expiry
  hb = setTimeout(beat, input.intervalMs)
  return {
    stop: () => {
      stopped = true
      if (hb) clearTimeout(hb)
      if (deadline) clearTimeout(deadline)
    },
  }
}

export type MaintenanceHandler = { name: string; run: () => Promise<Record<string, number>> }

/** The registry of maintenance handlers — discoverable by name and independently invocable. The `fence` is
 *  passed into every drain so a stale owner that lost the lease stops settling immediately (fail-safe). */
export function buildMaintenanceHandlers(
  deps: ManagedIntelligenceDeps,
  cfg: MaintenanceRunnerConfig = {},
  db: PrismaLike = defaultPrisma,
  fence?: LeaseFence,
  signal?: AbortSignal,
): MaintenanceHandler[] {
  return [
    {
      name: 'intelligence_refresh_drain',
      run: () => drainIntelligenceRefreshJobs(deps, { db, limit: cfg.refreshBatch ?? 20, staleRunningMs: cfg.staleRunningMs, fence, signal }),
    },
    {
      name: 'reservation_reconcile',
      run: async () => {
        // Reconcile honors the abort signal too: a lost lease stops settlement mid-sweep.
        const abortFence: LeaseFence | undefined = fence || signal ? async () => !signal?.aborted && (fence ? await fence() : true) : undefined
        const s = await reconcileReservations({ db, limit: cfg.reconcileBatch ?? 200, hardAbandonMs: cfg.hardAbandonMs, observer: deps.observer, fence: abortFence })
        return { processed: s.processed, finalized: s.finalized, released: s.released, left: s.left, ambiguous: s.ambiguous, fenced: s.fenced ?? 0 }
      },
    },
  ]
}

/**
 * Run one maintenance sweep under the ONE global lease. ANY tick id contends on the same lock key, so only one
 * runner executes the drains at a time — DIFFERENT tick ids cannot overlap. A busy invocation returns
 * `skipped` (no double-run). The drains run OUTSIDE the lease-acquire transaction (no long-held DB tx).
 *
 * Long-run safety (Issue 2 + provider cancellation): a background HEARTBEAT renews the lease every `heartbeatMs`
 * (default leaseMs/3) for the whole sweep — INCLUDING long provider calls — AND advances a RENEWABLE deadline
 * (default 0.9·lease window), which is always strictly before the renewed lease expiry. If a renew fails (a
 * successor acquired the lease, or it expired), the heartbeat ABORTS an `AbortController`; if beats stop entirely
 * (crash) the last-armed deadline fires (dead-man's switch). The abort signal is threaded through the refresh
 * drain → job → `runIntelligenceRefresh` → `executeAsOwner` → `runOrchestration` → the provider network client,
 * where it CANCELS the in-flight request (Anthropic/OpenAI/DeepSeek/Grok honor AbortSignal), and no further
 * provider/synthesis/fallback/review call is started. Provider-level exactly-once is enforced by the run's
 * durable claim: `owner_token` + `lease_expires_at` (run leaseMs > perProviderTimeoutMs), so a successor's claim
 * returns `busy` while owner A's request is unresolved — B can never issue a duplicate provider request.
 * `store.complete/fail` are owner-token-gated (a superseded owner writes 0 rows) and takeover is `attemptCount`
 * (generation) gated. The global maintenance owner token is a SEPARATE fence from the per-run owner token.
 * Timers are torn down in `finally` (no leaked timer, no fire-and-forget).
 */
export async function runIntelligenceMaintenance(input: {
  tickId: string
  deps: ManagedIntelligenceDeps
  db?: PrismaLike
  config?: MaintenanceRunnerConfig
}): Promise<{ status: 'completed' | 'skipped'; reason?: string; results: Record<string, Record<string, number>> }> {
  const db = input.db ?? defaultPrisma
  const cfg = input.config ?? {}
  const ttlMs = cfg.leaseMs ?? DEFAULT_LEASE_MS
  const owner = `tick:${input.tickId}`
  const lease = cfg.lease ?? makeDefaultLease(db)
  // Owner-scoped renew: renews THIS owner's lease and reports ownership (false = lost). Used by both the
  // background heartbeat and the per-item fence.
  const renew: LeaseFence = cfg.fence ?? (async () => (await renewAutomationLock(INTELLIGENCE_MAINTENANCE_LOCK_KEY, { owner, ttlMs }, db)).ok)
  const controller = cfg.controller ?? new AbortController()
  // RENEWABLE-deadline invariant: deadlineWindow < lease, and heartbeat interval < deadlineWindow — so each
  // healthy beat re-arms the deadline strictly before it fires AND strictly before the renewed lease expiry.
  const deadlineWindowMs = Math.max(1, Math.min(cfg.deadlineMs ?? Math.floor(ttlMs * 0.9), ttlMs - 1))
  const heartbeatMs = Math.max(1, Math.min(cfg.heartbeatMs ?? Math.floor(ttlMs / 3), deadlineWindowMs - 1))
  const handlers = buildMaintenanceHandlers(input.deps, cfg, db, renew, controller.signal)

  const outcome = await lease(owner, ttlMs, async () => {
    // Heartbeat renews the lease AND advances the deadline during a long sweep/provider call, and aborts on
    // ownership loss; the renewable deadline aborts a stalled execution. Both are torn down in `finally`.
    const heartbeat = startLeaseHeartbeat({ renew, intervalMs: heartbeatMs, leaseMs: ttlMs, deadlineWindowMs, controller, onBeat: cfg.onHeartbeat })
    try {
      const results: Record<string, Record<string, number>> = {}
      for (const h of handlers) results[h.name] = await h.run() // sequential; drains are individually idempotent
      return results
    } finally {
      heartbeat.stop() // no leaked timer, no fire-and-forget
    }
  })

  if (!outcome.ok) return { status: 'skipped', reason: outcome.reason, results: {} }
  return { status: 'completed', results: outcome.value }
}
