/**
 * Fantasy OS — durable, season-aware synchronization runner (orchestration core).
 *
 * Provider-neutral. All side-effecting concerns are injected (clock, rng, sleep, distributed lock, store,
 * per-scope fetcher) so the orchestration is fully deterministic and unit-testable. Guarantees:
 *   - overlap prevention + stale-lease recovery via a leased distributed lock,
 *   - retry with exponential backoff + jitter, bounded by maxRetries,
 *   - resumable per-scope checkpoints (never refetch already-checkpointed immutable scopes),
 *   - idempotent persistence (the store upserts by deterministic id),
 *   - partial-failure recovery: completed scopes persist, incomplete scopes are recorded, status = partial,
 *   - a failed/partial run NEVER advances the certified freshness checkpoint,
 *   - full request accounting where attempts != logical requests (both fully classified).
 */
import type { SeasonState } from './season'

export type SyncScope = string

export type Accounting = {
  requestAttempts: number
  logicalRequests: number
  retries: number
  cacheHits: number
  successful: number
  notFound: number
  permanentFailures: number
  imported: number
  unchanged: number
  rejected: number
}

export type RunStatus = 'completed' | 'partial' | 'failed' | 'skipped' | 'locked'

export type RunResult = {
  runKey: string
  status: RunStatus
  seasonState: SeasonState
  completedScopes: SyncScope[]
  incompleteScopes: SyncScope[]
  checkpoint: Record<SyncScope, string>
  accounting: Accounting
  advancedFreshness: boolean
  startedAt: string
  finishedAt: string
  /**
   * Milliseconds spent waiting for the run lock, before any scope was attempted.
   *
   * 🛑 RECORDED BECAUSE THE TWO CAUSES OF A DEAD RUN ARE INDISTINGUISHABLE WITHOUT IT, AND ONE OF
   * THEM WAS MISDIAGNOSED. Measured on production 2026-09-20: 54 runs timed out having completed
   * ZERO scopes, burning 121–300s of wall clock before the first scope was even checked — while a
   * successful run of the same lane finishes at p50 1.9s and p95 7.3s. So the time went on
   * queueing, not on work. What it cannot say is WHICH queue: waiting on this lock, or waiting on
   * the worker's single JS thread (see the contention note in CLAUDE.md). This field separates
   * them: a large `lockWaitMs` is lock contention, a small one with a large wall clock is the
   * event loop.
   */
  lockWaitMs: number
  warnings: string[]
  /** Set when a fetch threw an error the caller classified as terminal; the run stopped there. */
  terminalError?: string
}

export interface Clock {
  now(): Date
}
export interface Rng {
  next(): number
}
export type Sleep = (ms: number) => Promise<void>

export interface SyncLock {
  /** Acquire (or steal an EXPIRED lease). Returns a token when held. */
  acquire(key: string, leaseMs: number, now: Date): Promise<{ acquired: boolean; token?: string }>
  release(key: string, token: string): Promise<void>
}

export type ScopeFetchResult = {
  records: { id: string; [k: string]: unknown }[]
  nextCheckpoint: string
  attempts: number
  logical: number
  notFound: number
  cacheHits: number
}

export interface ScopeFetcher {
  (scope: SyncScope, checkpoint: string | null, now: Date): Promise<ScopeFetchResult>
}

export interface SyncStore {
  getCheckpoint(runKey: string, scope: SyncScope): Promise<string | null>
  saveCheckpoint(runKey: string, scope: SyncScope, checkpoint: string): Promise<void>
  /** Idempotent upsert by record id. Reruns of identical records report `unchanged`, not `imported`. */
  persistScope(runKey: string, scope: SyncScope, records: { id: string }[]): Promise<{ imported: number; unchanged: number; rejected: number }>
  recordRun(result: RunResult): Promise<void>
  setLastSuccessfulSyncAt(runKey: string, iso: string): Promise<void>
}

export type RunSyncOptions = {
  runKey: string
  seasonState: SeasonState
  scopes: SyncScope[]
  /** Scopes whose historical records are immutable — skip refetch if already checkpointed. */
  immutableScopes?: SyncScope[]
  lock: SyncLock
  store: SyncStore
  clock: Clock
  rng: Rng
  sleep: Sleep
  fetchScope: ScopeFetcher
  leaseMs?: number
  maxRetries?: number
  runTimeoutMs?: number
  baseBackoffMs?: number
  /**
   * An error that retrying cannot change — today only "the provider says this league is gone".
   * It is not retried, and the run stops: every scope reads the same memoized payload, so the
   * remaining scopes would each re-ask the provider the question the first one just answered.
   * The run finishes `skipped` when nothing completed before it.
   */
  isTerminalError?: (err: unknown) => boolean
}

function emptyAccounting(): Accounting {
  return { requestAttempts: 0, logicalRequests: 0, retries: 0, cacheHits: 0, successful: 0, notFound: 0, permanentFailures: 0, imported: 0, unchanged: 0, rejected: 0 }
}

/** Deterministic backoff with jitter: base * 2^attempt * (1 + rng()). */
export function backoffMs(base: number, attempt: number, rng: Rng): number {
  return Math.round(base * Math.pow(2, attempt) * (1 + rng.next()))
}

/** attempts == logical + retries, and every attempt/logical is classified. */
export function reconcileAccounting(a: Accounting): { ok: boolean; detail: string } {
  const logicalOk = a.logicalRequests === a.successful + a.notFound + a.permanentFailures
  const attemptsOk = a.requestAttempts === a.logicalRequests + a.retries
  return {
    ok: logicalOk && attemptsOk,
    detail: `logical(${a.logicalRequests})=ok+404+fail(${a.successful}+${a.notFound}+${a.permanentFailures}) ${logicalOk}; attempts(${a.requestAttempts})=logical+retries(${a.logicalRequests}+${a.retries}) ${attemptsOk}`,
  }
}

export async function runSync(opts: RunSyncOptions): Promise<RunResult> {
  const leaseMs = opts.leaseMs ?? 5 * 60_000
  const maxRetries = opts.maxRetries ?? 3
  const runTimeoutMs = opts.runTimeoutMs ?? 4 * 60_000
  const baseBackoff = opts.baseBackoffMs ?? 250
  const immutable = new Set(opts.immutableScopes ?? [])
  const startedAt = opts.clock.now()
  /*
   * 🛑 TWO CLOCKS, AND CONFLATING THEM IS WHAT KILLED 54 RUNS A WEEK. `startedAt` is the run's
   * true wall clock and stays that way — it is what `durationMs` reports, and it is the only
   * reason this was diagnosable at all. `budgetStartedAt` starts when the run actually has the
   * lock and can do work.
   *
   * The budget exists to bound WORK, and charging it for queueing meant a run could arrive
   * already dead: the active lane's 20s allowance against 121–200s of measured wall clock, with
   * `completedScopes: []` every time. Those runs did not overrun anything; they were never
   * scheduled in time to start.
   */
  let budgetStartedAt = startedAt
  let lockWaitMs = 0
  const acc = emptyAccounting()
  const completed: SyncScope[] = []
  const incomplete: SyncScope[] = []
  const checkpoints: Record<SyncScope, string> = {}
  const warnings: string[] = []
  let terminalError: string | undefined

  const lock = await opts.lock.acquire(opts.runKey, leaseMs, startedAt)
  if (!lock.acquired || !lock.token) {
    return finalize('locked', false)
  }
  budgetStartedAt = opts.clock.now()
  lockWaitMs = budgetStartedAt.getTime() - startedAt.getTime()

  try {
    for (const scope of opts.scopes) {
      // A terminal error already answered for every scope; do not ask the provider again.
      if (terminalError !== undefined) {
        incomplete.push(scope)
        continue
      }
      /* Against the BUDGET clock, not the wall clock — see `budgetStartedAt`. */
      if (opts.clock.now().getTime() - budgetStartedAt.getTime() > runTimeoutMs) {
        incomplete.push(scope)
        warnings.push(`run timeout before scope "${scope}"`)
        continue
      }

      const priorCheckpoint = await opts.store.getCheckpoint(opts.runKey, scope)
      // Immutable, already-checkpointed scopes are reused from cache — never refetched.
      if (immutable.has(scope) && priorCheckpoint) {
        acc.cacheHits += 1
        checkpoints[scope] = priorCheckpoint
        completed.push(scope)
        continue
      }

      let ok = false
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const r = await opts.fetchScope(scope, priorCheckpoint, opts.clock.now())
          // Fetcher-internal accounting: attempts >= logical; the surplus are HTTP-level retries.
          acc.requestAttempts += r.attempts
          acc.logicalRequests += r.logical
          acc.notFound += r.notFound
          acc.successful += Math.max(0, r.logical - r.notFound)
          acc.retries += Math.max(0, r.attempts - r.logical)
          acc.cacheHits += r.cacheHits
          const p = await opts.store.persistScope(opts.runKey, scope, r.records)
          acc.imported += p.imported
          acc.unchanged += p.unchanged
          acc.rejected += p.rejected
          await opts.store.saveCheckpoint(opts.runKey, scope, r.nextCheckpoint)
          checkpoints[scope] = r.nextCheckpoint
          ok = true
          break
        } catch (err) {
          // A scope-level attempt that threw. Not final → a retry attempt (attempt, no terminal outcome).
          // Final → a terminal permanent failure (one attempt, one logical request classified as failed).
          acc.requestAttempts += 1
          if (opts.isTerminalError?.(err)) {
            // Retrying cannot change the answer: one attempt, one logical request, and the run stops.
            acc.permanentFailures += 1
            acc.logicalRequests += 1
            terminalError = err instanceof Error ? err.message : 'terminal error'
            warnings.push(`scope "${scope}" stopped: ${terminalError}`)
            break
          }
          if (attempt < maxRetries) {
            acc.retries += 1
            await opts.sleep(backoffMs(baseBackoff, attempt, opts.rng))
          } else {
            acc.permanentFailures += 1
            acc.logicalRequests += 1
            warnings.push(`scope "${scope}" failed after ${maxRetries + 1} attempts: ${err instanceof Error ? err.message : 'error'}`)
          }
        }
      }
      if (ok) completed.push(scope)
      else incomplete.push(scope)
    }

    const status: RunStatus =
      terminalError !== undefined && completed.length === 0
        ? 'skipped'
        : incomplete.length === 0 ? 'completed' : completed.length > 0 ? 'partial' : 'failed'
    // Freshness advances ONLY on a fully completed run.
    const advanced = status === 'completed'
    if (advanced) await opts.store.setLastSuccessfulSyncAt(opts.runKey, opts.clock.now().toISOString())
    const result = finalize(status, advanced)
    await opts.store.recordRun(result)
    return result
  } finally {
    await opts.lock.release(opts.runKey, lock.token)
  }

  function finalize(status: RunStatus, advancedFreshness: boolean): RunResult {
    return {
      runKey: opts.runKey,
      status,
      seasonState: opts.seasonState,
      completedScopes: completed,
      incompleteScopes: incomplete,
      checkpoint: checkpoints,
      accounting: acc,
      advancedFreshness,
      startedAt: startedAt.toISOString(),
      finishedAt: opts.clock.now().toISOString(),
      lockWaitMs,
      warnings,
      ...(terminalError !== undefined ? { terminalError } : {}),
    }
  }
}

/** Offseason enrichment scopes — append-only closure of the disclosed week-0 gap. */
export const OFFSEASON_SCOPES: SyncScope[] = [
  'offseason_trades',
  'offseason_waivers',
  'offseason_free_agents',
  'offseason_faab',
  'rookie_drafts',
  'startup_drafts',
  'supplemental_drafts',
  'traded_future_picks',
  'league_renewals',
  'roster_and_commissioner_changes',
]
