/**
 * Decision OS — Phase 7.7 Widget Runtime Core: refresh engine.
 *
 * Deterministic refresh behavior for a widget already at 'ready' (initial
 * load — init/auth/loading/rendering — is a future adapter's job; this
 * engine drives the ready→refreshing→ready cycle and the offline retry
 * loop). Every timer goes through an injected `RuntimeClock` — core never
 * calls global `setTimeout`/`setInterval`/`window`/`document` directly.
 *
 * Five entry points, one per trigger the ticket scopes (api_push is
 * explicitly out of scope for this ticket — see PHASE_7_7 notes below):
 *   1. refreshNow()      — manual
 *   2. start()/stop()    — scheduled (self-arming recurring timer)
 *   3. notifyVisible()   — visibility_change
 *   4. notifyOffline()/notifyOnline() — offline_retry
 *   5. triggerFromHost() — host_callback
 *
 * Each entry point resolves its OWN strategy via the frozen
 * `resolveRefreshStrategy(trigger, overrides)` (Phase 7.4) — trigger
 * primarily selects default retry/backoff/interval parameters; all five
 * entry points are always available on every engine instance regardless of
 * which trigger the widget's primary refresh mode is configured for (a
 * 'scheduled' widget may still want a manual refresh button, and every
 * widget should react to connectivity changes).
 *
 * Lifecycle integration respects the frozen Phase 7.4 transition table
 * exactly (lib/decision-os/sdk/lifecycle.ts) — NOT modified by this ticket:
 *   - ready-path (manual/scheduled/visibility_change/host_callback):
 *     ready → refreshing → (ready | error | offline)
 *   - offline-path (offline_retry): offline → loading → (rendering → ready
 *     pass-through | error | offline). Core has no renderer, so the
 *     'rendering' state is passed through instantaneously on this path — a
 *     future adapter that owns real rendering inserts its own signal there.
 *
 * A `SDKError.retryable` failure lands in 'offline' (more retries could
 * still succeed); a non-retryable failure lands in 'error' (a harder
 * failure — auth/scope/tenant/version — retrying won't help).
 */

import { resolveRefreshStrategy } from '../../../lib/decision-os/sdk/refresh'
import type { SDKRefreshStrategyConfig, SDKRefreshTrigger } from '../../../lib/decision-os/sdk/types'
import { fetchPresentation } from './httpClient'
import type { LifecycleController } from './lifecycleController'
import type {
  ExpectedEntity,
  HttpClientConfig,
  PresentationFetchResult,
  RuntimeClock,
  RuntimeTimerHandle,
} from './types'
import type { SDKAuth } from '../../../lib/decision-os/sdk/types'
import type { WidgetApiCall } from '../../../lib/decision-os/presentation/widget-contracts'

// ── Public types ──────────────────────────────────────────────────────────────

export interface RefreshAttemptInfo {
  trigger: SDKRefreshTrigger
  /** 1-based attempt number within this refresh cycle. */
  attempt: number
  maxRetries: number
  timestamp: string
}

export type RefreshOutcome =
  | { outcome: 'success'; result: PresentationFetchResult & { ok: true }; attempt: RefreshAttemptInfo }
  | { outcome: 'failure'; result: PresentationFetchResult & { ok: false }; attempt: RefreshAttemptInfo }
  | { outcome: 'cancelled'; attempt: RefreshAttemptInfo }

export type RefreshResultListener = (outcome: RefreshOutcome) => void

export type RefreshStrategyOverrides = Partial<
  Record<SDKRefreshTrigger, Partial<Omit<SDKRefreshStrategyConfig, 'trigger'>>>
>

export interface RefreshEngineDeps {
  clock: RuntimeClock
  httpConfig: HttpClientConfig
  call: WidgetApiCall
  auth: SDKAuth
  expected: ExpectedEntity
  lifecycle: LifecycleController
  strategyOverrides?: RefreshStrategyOverrides
}

// ── Pure helper ────────────────────────────────────────────────────────────────

/** Deterministic linear backoff: backoffSeconds × attemptNumber, in milliseconds. */
export function computeBackoffDelayMs(strategy: SDKRefreshStrategyConfig, attemptNumber: number): number {
  return strategy.backoffSeconds * attemptNumber * 1000
}

// ── Refresh engine ────────────────────────────────────────────────────────────

export class RefreshEngine {
  private readonly deps: RefreshEngineDeps
  private disposed = false
  private scheduledTimerHandle: RuntimeTimerHandle | null = null
  private readonly activeWaits = new Map<RuntimeTimerHandle, () => void>()
  private readonly listeners = new Set<RefreshResultListener>()

  constructor(deps: RefreshEngineDeps) {
    this.deps = deps
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  onResult(listener: RefreshResultListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ── 1. manual ─────────────────────────────────────────────────────────────

  async refreshNow(): Promise<RefreshOutcome> {
    return this.runReadyPathAttempts('manual', this.resolveStrategy('manual'))
  }

  // ── 2. scheduled ──────────────────────────────────────────────────────────

  /**
   * Arms a self-re-arming recurring timer. No-op (returns false) unless a
   * 'scheduled' interval is configured. `intervalSeconds` is non-null by
   * default for 'scheduled' and cannot be overridden to null (Phase 7.4's
   * `resolveRefreshStrategy` treats a null override as "unset" via `??`) —
   * this guard is defensive, protecting against a future frozen-contract
   * change to that default rather than a reachable path today.
   */
  start(): boolean {
    if (this.disposed) return false
    const strategy = this.resolveStrategy('scheduled')
    if (strategy.intervalSeconds === null) return false
    this.armScheduledTimer(strategy)
    return true
  }

  /** Cancels the recurring timer and any in-flight retry backoff wait. Always safe to call. */
  stop(): void {
    if (this.scheduledTimerHandle !== null) {
      this.deps.clock.clearTimeout(this.scheduledTimerHandle)
      this.scheduledTimerHandle = null
    }
    this.cancelAllWaits()
  }

  private armScheduledTimer(strategy: SDKRefreshStrategyConfig): void {
    if (this.disposed || strategy.intervalSeconds === null) return
    this.scheduledTimerHandle = this.deps.clock.setTimeout(() => {
      this.scheduledTimerHandle = null
      void this.runReadyPathAttempts('scheduled', strategy).finally(() => {
        if (!this.disposed) this.armScheduledTimer(strategy)
      })
    }, strategy.intervalSeconds * 1000)
  }

  // ── 3. visibility_change ──────────────────────────────────────────────────

  async notifyVisible(): Promise<RefreshOutcome> {
    return this.runReadyPathAttempts('visibility_change', this.resolveStrategy('visibility_change'))
  }

  // ── 4. offline_retry ──────────────────────────────────────────────────────

  async notifyOffline(): Promise<RefreshOutcome> {
    const strategy = this.resolveStrategy('offline_retry')
    if (this.disposed) return this.cancelledOutcome('offline_retry', 0, strategy.maxRetries)
    if (this.deps.lifecycle.canTransition('offline')) {
      this.deps.lifecycle.transition('offline')
    } else if (this.deps.lifecycle.currentState !== 'offline') {
      return this.cancelledOutcome('offline_retry', 0, strategy.maxRetries)
    }
    return this.runOfflinePathAttempts(strategy)
  }

  /** Resumes retrying after connectivity returns. No-op (cancelled) unless currently 'offline'. */
  async notifyOnline(): Promise<RefreshOutcome> {
    const strategy = this.resolveStrategy('offline_retry')
    if (this.disposed || this.deps.lifecycle.currentState !== 'offline') {
      return this.cancelledOutcome('offline_retry', 0, strategy.maxRetries)
    }
    return this.runOfflinePathAttempts(strategy)
  }

  // ── 5. host_callback ──────────────────────────────────────────────────────

  async triggerFromHost(): Promise<RefreshOutcome> {
    return this.runReadyPathAttempts('host_callback', this.resolveStrategy('host_callback'))
  }

  // ── 6. lifecycle integration — disposal ──────────────────────────────────

  /** Cancels every pending timer/wait and transitions the lifecycle to 'disposed' (idempotent). */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    if (this.deps.lifecycle.currentState !== 'disposed') {
      this.deps.lifecycle.transition('disposed')
    }
  }

  // ── Internal: strategy resolution ────────────────────────────────────────

  private resolveStrategy(trigger: SDKRefreshTrigger): SDKRefreshStrategyConfig {
    return resolveRefreshStrategy(trigger, this.deps.strategyOverrides?.[trigger])
  }

  // ── Internal: attempt-info + outcome helpers ─────────────────────────────

  private makeAttemptInfo(trigger: SDKRefreshTrigger, attempt: number, maxRetries: number): RefreshAttemptInfo {
    return {
      trigger,
      attempt,
      maxRetries,
      timestamp: new Date(this.deps.clock.now()).toISOString(),
    }
  }

  private cancelledOutcome(trigger: SDKRefreshTrigger, attempt: number, maxRetries: number): RefreshOutcome {
    return this.finish({ outcome: 'cancelled', attempt: this.makeAttemptInfo(trigger, attempt, maxRetries) })
  }

  private finish(outcome: RefreshOutcome): RefreshOutcome {
    for (const listener of this.listeners) listener(outcome)
    return outcome
  }

  // ── Internal: cancellable wait ────────────────────────────────────────────

  /** Waits `ms` via the injected clock. Resolves 'cancelled' immediately if stop()/dispose() fires first. */
  private wait(ms: number): Promise<'elapsed' | 'cancelled'> {
    return new Promise((resolve) => {
      const handle = this.deps.clock.setTimeout(() => {
        this.activeWaits.delete(handle)
        resolve('elapsed')
      }, ms)
      this.activeWaits.set(handle, () => resolve('cancelled'))
    })
  }

  private cancelAllWaits(): void {
    for (const [handle, resolveCancelled] of this.activeWaits) {
      this.deps.clock.clearTimeout(handle)
      resolveCancelled()
    }
    this.activeWaits.clear()
  }

  private async performSingleFetch(): Promise<PresentationFetchResult> {
    return fetchPresentation(this.deps.httpConfig, this.deps.call, this.deps.auth, this.deps.expected)
  }

  // ── Internal: ready-path attempt sequence ────────────────────────────────
  // ready → refreshing → (ready | error | offline)

  private async runReadyPathAttempts(
    trigger: SDKRefreshTrigger,
    strategy: SDKRefreshStrategyConfig,
  ): Promise<RefreshOutcome> {
    if (this.disposed) return this.cancelledOutcome(trigger, 0, strategy.maxRetries)
    if (!this.deps.lifecycle.canTransition('refreshing')) {
      return this.cancelledOutcome(trigger, 0, strategy.maxRetries)
    }
    this.deps.lifecycle.transition('refreshing')

    const totalAttempts = 1 + Math.max(0, strategy.maxRetries)
    for (let attemptNum = 1; attemptNum <= totalAttempts; attemptNum++) {
      if (this.disposed) return this.cancelledOutcome(trigger, attemptNum, strategy.maxRetries)

      const result = await this.performSingleFetch()
      const attempt = this.makeAttemptInfo(trigger, attemptNum, strategy.maxRetries)

      if (result.ok) {
        this.deps.lifecycle.transition('ready')
        return this.finish({ outcome: 'success', result, attempt })
      }

      const isLastAttempt = attemptNum === totalAttempts
      if (!result.error.retryable || isLastAttempt) {
        this.deps.lifecycle.transition(result.error.retryable ? 'offline' : 'error')
        return this.finish({ outcome: 'failure', result, attempt })
      }

      const waitResult = await this.wait(computeBackoffDelayMs(strategy, attemptNum))
      if (waitResult === 'cancelled' || this.disposed) {
        return this.cancelledOutcome(trigger, attemptNum, strategy.maxRetries)
      }
    }

    /* istanbul ignore next -- loop always returns before exhausting; satisfies TS control-flow analysis */
    throw new Error('unreachable: runReadyPathAttempts exhausted its loop without returning')
  }

  // ── Internal: offline-path attempt sequence ──────────────────────────────
  // offline → loading → (rendering → ready pass-through | error | offline)

  private async runOfflinePathAttempts(strategy: SDKRefreshStrategyConfig): Promise<RefreshOutcome> {
    const trigger: SDKRefreshTrigger = 'offline_retry'
    const totalAttempts = 1 + Math.max(0, strategy.maxRetries)

    for (let attemptNum = 1; attemptNum <= totalAttempts; attemptNum++) {
      if (this.disposed) return this.cancelledOutcome(trigger, attemptNum, strategy.maxRetries)

      if (attemptNum > 1) {
        const waitResult = await this.wait(computeBackoffDelayMs(strategy, attemptNum - 1))
        if (waitResult === 'cancelled' || this.disposed) {
          return this.cancelledOutcome(trigger, attemptNum, strategy.maxRetries)
        }
      }

      if (!this.deps.lifecycle.canTransition('loading')) {
        return this.cancelledOutcome(trigger, attemptNum, strategy.maxRetries)
      }
      this.deps.lifecycle.transition('loading')

      const result = await this.performSingleFetch()
      const attempt = this.makeAttemptInfo(trigger, attemptNum, strategy.maxRetries)

      if (result.ok) {
        // Core has no renderer — pass through 'rendering' instantaneously.
        this.deps.lifecycle.transition('rendering')
        this.deps.lifecycle.transition('ready')
        return this.finish({ outcome: 'success', result, attempt })
      }

      if (!result.error.retryable) {
        this.deps.lifecycle.transition('error')
        return this.finish({ outcome: 'failure', result, attempt })
      }

      // Retryable failure — back to 'offline'; loop again unless attempts are exhausted.
      this.deps.lifecycle.transition('offline')
      if (attemptNum === totalAttempts) {
        return this.finish({ outcome: 'failure', result, attempt })
      }
    }

    /* istanbul ignore next -- loop always returns before exhausting; satisfies TS control-flow analysis */
    throw new Error('unreachable: runOfflinePathAttempts exhausted its loop without returning')
  }
}
