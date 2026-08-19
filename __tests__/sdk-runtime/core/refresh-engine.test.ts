/**
 * Decision OS — Phase 7.7 Widget Runtime Core: refresh engine tests.
 *
 * Covers: all five refresh strategies (manual, scheduled, visibility_change,
 * offline_retry, host_callback), cancellation/disposal, offline/degraded
 * behavior, lifecycle integration, and no credential leakage. Uses
 * vitest's fake timers behind the injected RuntimeClock — core itself never
 * touches a global timer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RefreshEngine,
  computeBackoffDelayMs,
  LifecycleController,
} from '../../../sdk-runtime/core/src/index'
import type {
  HttpClientConfig,
  RefreshOutcome,
  RuntimeClock,
  RuntimeFetch,
  RuntimeFetchResponse,
  RuntimeTimerHandle,
} from '../../../sdk-runtime/core/src/index'
import type { WidgetApiCall } from '../../../lib/decision-os/presentation/widget-contracts'
import type { SDKAuth, SDKRefreshStrategyConfig } from '../../../lib/decision-os/sdk/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCall(): WidgetApiCall {
  return {
    endpoint: '/api/v1/intelligence/league',
    queryParams: { view: 'presentation', leagueId: 'league_001' },
    requiredScopes: ['intelligence:league:read'],
    view: 'presentation',
  }
}

function makeAuth(overrides: Partial<SDKAuth> = {}): SDKAuth {
  return {
    method: 'api_key',
    credential: 'afk_test_abcdefghijklmnop',
    tenantId: 'tenant_001',
    expiresAt: null,
    scopes: ['intelligence:league:read'],
    ...overrides,
  }
}

function makeEnvelope(completeness = 100) {
  return {
    data: { entityId: 'league_001', entityType: 'league', completeness, healthScore: 82 },
    meta: {
      requestId: 'req_001', derivedAt: '2026-07-01T00:00:00.000Z', completeness,
      version: 'v1', tier: 'commissioner', view: 'presentation' as const, presentationVersion: '7.0.0',
    },
  }
}

function makeFakeResponse(status: number, body: unknown): RuntimeFetchResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

/** Pops one entry per call; repeats the last entry once exhausted. */
function makeSequencedFetch(sequence: Array<RuntimeFetchResponse | Error>): { fetchImpl: RuntimeFetch; callCount: () => number } {
  let i = 0
  let calls = 0
  const fetchImpl: RuntimeFetch = async () => {
    calls++
    const entry = sequence[Math.min(i, sequence.length - 1)]
    if (i < sequence.length - 1) i++
    if (entry instanceof Error) throw entry
    return entry
  }
  return { fetchImpl, callCount: () => calls }
}

function makeConfig(fetchImpl: RuntimeFetch): HttpClientConfig {
  return { baseUrl: 'https://api.allfantasy.test', fetchImpl }
}

/** RuntimeClock backed by vitest's fake timers — core stays timer-agnostic; this is the test's own adapter. */
function makeFakeClock(): RuntimeClock {
  return {
    now: () => Date.now(),
    setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as RuntimeTimerHandle,
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
}

function expected() {
  return { entityId: 'league_001', entityType: 'league' }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── computeBackoffDelayMs ──────────────────────────────────────────────────────

describe('computeBackoffDelayMs', () => {
  it('is linear: backoffSeconds × attemptNumber × 1000', () => {
    const strategy: SDKRefreshStrategyConfig = { trigger: 'scheduled', intervalSeconds: 300, maxRetries: 3, backoffSeconds: 5 }
    expect(computeBackoffDelayMs(strategy, 1)).toBe(5000)
    expect(computeBackoffDelayMs(strategy, 2)).toBe(10000)
    expect(computeBackoffDelayMs(strategy, 3)).toBe(15000)
  })

  it('is deterministic', () => {
    const strategy: SDKRefreshStrategyConfig = { trigger: 'manual', intervalSeconds: null, maxRetries: 0, backoffSeconds: 0 }
    expect(computeBackoffDelayMs(strategy, 1)).toBe(computeBackoffDelayMs(strategy, 1))
  })
})

// ── 1. Manual refresh ──────────────────────────────────────────────────────────

describe('refreshNow (manual)', () => {
  it('succeeds in a single attempt', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.refreshNow()
    expect(outcome.outcome).toBe('success')
    expect(callCount()).toBe(1)
    expect(lifecycle.currentState).toBe('ready')
  })

  it('drives lifecycle ready → refreshing → ready on success', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })
    await engine.refreshNow()
    expect(lifecycle.history).toEqual(['ready', 'refreshing', 'ready'])
  })

  it('a non-retryable failure (401) lands in error with exactly one attempt (manual has maxRetries=0)', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(401, {})])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.refreshNow()
    expect(outcome.outcome).toBe('failure')
    if (outcome.outcome === 'failure') expect(outcome.result.error.code).toBe('UNAUTHORIZED')
    expect(callCount()).toBe(1)
    expect(lifecycle.currentState).toBe('error')
  })

  it('a retryable failure (network) with manual (maxRetries=0) lands in offline after one attempt', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([new Error('boom')])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.refreshNow()
    expect(outcome.outcome).toBe('failure')
    if (outcome.outcome === 'failure') expect(outcome.result.error.code).toBe('NETWORK')
    expect(callCount()).toBe(1)
    expect(lifecycle.currentState).toBe('offline')
  })

  it('returns cancelled when the widget is not in ready state', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('initializing')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.refreshNow()
    expect(outcome.outcome).toBe('cancelled')
    expect(callCount()).toBe(0)
  })
})

// ── Retry-with-backoff (shared mechanism, exercised via host_callback which has maxRetries=1) ─

describe('retry with backoff (host_callback, maxRetries=1)', () => {
  it('retries once after a retryable failure, then succeeds', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([new Error('transient'), makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const promise = engine.triggerFromHost()
    await vi.advanceTimersByTimeAsync(1000) // host_callback backoffSeconds=1 → 1000ms
    const outcome = await promise

    expect(outcome.outcome).toBe('success')
    expect(callCount()).toBe(2)
    expect(lifecycle.currentState).toBe('ready')
  })

  it('exhausts retries and reports failure with the final error', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([new Error('a'), new Error('b')])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const promise = engine.triggerFromHost()
    await vi.advanceTimersByTimeAsync(1000)
    const outcome = await promise

    expect(outcome.outcome).toBe('failure')
    expect(callCount()).toBe(2)
    expect(lifecycle.currentState).toBe('offline') // retryable error, retries exhausted
  })

  it('does not wait/retry after a non-retryable failure even with retries remaining', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(403, {})])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.triggerFromHost()
    expect(outcome.outcome).toBe('failure')
    expect(callCount()).toBe(1) // no retry attempted
    expect(lifecycle.currentState).toBe('error')
  })
})

// ── 2. Scheduled refresh contract ─────────────────────────────────────────────

describe('start/stop (scheduled)', () => {
  it('start() arms a timer and fires at the configured interval', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({
      clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
      strategyOverrides: { scheduled: { intervalSeconds: 10 } },
    })

    const armed = engine.start()
    expect(armed).toBe(true)
    expect(callCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(callCount()).toBe(1)
    expect(lifecycle.currentState).toBe('ready')

    engine.stop()
  })

  it('re-arms after each tick for the next interval', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([
      makeFakeResponse(200, makeEnvelope()),
      makeFakeResponse(200, makeEnvelope()),
      makeFakeResponse(200, makeEnvelope()),
    ])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({
      clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
      strategyOverrides: { scheduled: { intervalSeconds: 5 } },
    })

    engine.start()
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(callCount()).toBe(3)

    engine.stop()
  })

  it('stop() cancels the pending timer — no further fires', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({
      clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
      strategyOverrides: { scheduled: { intervalSeconds: 10 } },
    })

    engine.start()
    engine.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(callCount()).toBe(0)
  })

  // Note: resolveRefreshStrategy's `??` merge (Phase 7.4, frozen) treats an
  // explicit `intervalSeconds: null` override the same as "not provided" —
  // it falls back to the non-null 'scheduled' default (300s). There is no
  // reachable public path to force start()'s resolved strategy to a null
  // interval; the `intervalSeconds === null` guard in start() is retained
  // as defensive code for a future frozen-contract change, not something
  // testable through today's override surface.

  it('start() returns false when the engine is already disposed', () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })
    engine.dispose()
    expect(engine.start()).toBe(false)
  })
})

// ── 3. Visibility-change refresh contract ─────────────────────────────────────

describe('notifyVisible (visibility_change)', () => {
  it('performs an immediate refresh when ready', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.notifyVisible()
    expect(outcome.outcome).toBe('success')
    expect(callCount()).toBe(1)
  })

  it('is cancelled when not in ready state (e.g. still loading)', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('loading')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.notifyVisible()
    expect(outcome.outcome).toBe('cancelled')
    expect(callCount()).toBe(0)
  })

  it('retries per the visibility_change defaults (maxRetries=2) on transient failure', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([new Error('x'), new Error('y'), makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const promise = engine.notifyVisible()
    await vi.advanceTimersByTimeAsync(2_000) // visibility_change backoffSeconds=2
    await vi.advanceTimersByTimeAsync(4_000)
    const outcome = await promise

    expect(outcome.outcome).toBe('success')
    expect(callCount()).toBe(3)
  })
})

// ── 4. Offline-retry contract ─────────────────────────────────────────────────

describe('notifyOffline / notifyOnline (offline_retry)', () => {
  it('transitions ready → offline → loading → rendering → ready on eventual success', async () => {
    const { fetchImpl } = makeSequencedFetch([new Error('down'), makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({
      clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
    })

    const promise = engine.notifyOffline()
    await vi.advanceTimersByTimeAsync(10_000) // offline_retry backoffSeconds=10, attempt 1
    const outcome = await promise

    expect(outcome.outcome).toBe('success')
    expect(lifecycle.history).toEqual(['ready', 'offline', 'loading', 'offline', 'loading', 'rendering', 'ready'])
  })

  it('exhausts retries (maxRetries=5) and lands back in offline, not error', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([new Error('x')]) // always fails, retryable
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({
      clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
    })

    const promise = engine.notifyOffline()
    // 6 total attempts (1 + maxRetries=5); backoffSeconds=10 → delays 10s,20s,30s,40s,50s between them
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(20_000)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(40_000)
    await vi.advanceTimersByTimeAsync(50_000)
    const outcome = await promise

    expect(outcome.outcome).toBe('failure')
    if (outcome.outcome === 'failure') expect(outcome.result.error.code).toBe('NETWORK')
    expect(callCount()).toBe(6)
    expect(lifecycle.currentState).toBe('offline')
  })

  it('a non-retryable failure while offline lands in error immediately (no further retries)', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(403, {})])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.notifyOffline()
    expect(outcome.outcome).toBe('failure')
    expect(callCount()).toBe(1)
    expect(lifecycle.currentState).toBe('error')
  })

  it('notifyOnline() resumes retrying when currently offline', async () => {
    const { fetchImpl } = makeSequencedFetch([new Error('still down'), makeFakeResponse(200, makeEnvelope())])
    // Start already in 'offline' (simulating a prior exhausted retry cycle).
    const lifecycle = new LifecycleController('offline')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const promise = engine.notifyOnline()
    await vi.advanceTimersByTimeAsync(10_000)
    const outcome = await promise
    expect(outcome.outcome).toBe('success')
  })

  it('notifyOnline() is cancelled when not currently offline', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.notifyOnline()
    expect(outcome.outcome).toBe('cancelled')
    expect(callCount()).toBe(0)
  })

  it('notifyOffline() from refreshing transitions correctly', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('refreshing')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.notifyOffline()
    expect(outcome.outcome).toBe('success')
    expect(lifecycle.history[0]).toBe('refreshing')
    expect(lifecycle.history[1]).toBe('offline')
  })

  it('notifyOffline() is cancelled from a state that cannot reach offline (e.g. initializing)', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('initializing')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.notifyOffline()
    expect(outcome.outcome).toBe('cancelled')
    expect(callCount()).toBe(0)
  })
})

// ── 5. Host-callback refresh contract ─────────────────────────────────────────

describe('triggerFromHost (host_callback)', () => {
  it('performs an immediate refresh when ready', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.triggerFromHost()
    expect(outcome.outcome).toBe('success')
    expect(callCount()).toBe(1)
  })

  it('uses the host_callback attempt trigger label', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.triggerFromHost()
    expect(outcome.attempt.trigger).toBe('host_callback')
  })
})

// ── Degraded responses ─────────────────────────────────────────────────────────

describe('offline/degraded behavior', () => {
  it('a degraded (completeness < 100) response is still a success outcome', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope(60))])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.refreshNow()
    expect(outcome.outcome).toBe('success')
    if (outcome.outcome === 'success') expect(outcome.result.degraded).toBe(true)
    expect(lifecycle.currentState).toBe('ready')
  })

  it('a fully complete (100) response is not degraded', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope(100))])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const outcome = await engine.refreshNow()
    if (outcome.outcome === 'success') expect(outcome.result.degraded).toBe(false)
  })
})

// ── Cancellation / disposal ────────────────────────────────────────────────────

describe('cancellation and disposal', () => {
  it('dispose() during an in-flight retry backoff wait resolves the pending call as cancelled', async () => {
    const { fetchImpl } = makeSequencedFetch([new Error('down'), makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const promise = engine.notifyOffline() // first attempt fails, schedules a 10s backoff wait
    await vi.advanceTimersByTimeAsync(0) // let the first fetch attempt run
    engine.dispose()
    const outcome = await promise

    expect(outcome.outcome).toBe('cancelled')
  })

  it('dispose() cancels a pending scheduled timer — no further fires', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({
      clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
      strategyOverrides: { scheduled: { intervalSeconds: 10 } },
    })

    engine.start()
    engine.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(callCount()).toBe(0)
  })

  it('dispose() transitions the lifecycle to disposed', () => {
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(async () => makeFakeResponse(200, makeEnvelope())), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })
    engine.dispose()
    expect(lifecycle.currentState).toBe('disposed')
  })

  it('dispose() is idempotent — calling twice does not throw', () => {
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(async () => makeFakeResponse(200, makeEnvelope())), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })
    engine.dispose()
    expect(() => engine.dispose()).not.toThrow()
    expect(lifecycle.currentState).toBe('disposed')
  })

  it('isDisposed reflects state correctly', () => {
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(async () => makeFakeResponse(200, makeEnvelope())), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })
    expect(engine.isDisposed).toBe(false)
    engine.dispose()
    expect(engine.isDisposed).toBe(true)
  })

  it('refreshNow() on an already-disposed engine returns cancelled without calling fetch', async () => {
    const { fetchImpl, callCount } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })
    engine.dispose()

    const outcome = await engine.refreshNow()
    expect(outcome.outcome).toBe('cancelled')
    expect(callCount()).toBe(0)
  })

  it('does not throw when disposing a lifecycle already in a terminal state', () => {
    const lifecycle = new LifecycleController('disposed')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(async () => makeFakeResponse(200, makeEnvelope())), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })
    expect(() => engine.dispose()).not.toThrow()
  })

  it('stop() is always safe to call, even with nothing pending', () => {
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(async () => makeFakeResponse(200, makeEnvelope())), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })
    expect(() => engine.stop()).not.toThrow()
  })
})

// ── onResult listeners ─────────────────────────────────────────────────────────

describe('onResult listeners', () => {
  it('emits for a success outcome', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const received: RefreshOutcome[] = []
    engine.onResult((o) => received.push(o))
    await engine.refreshNow()

    expect(received).toHaveLength(1)
    expect(received[0].outcome).toBe('success')
  })

  it('emits for a cancelled outcome', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('initializing')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const received: RefreshOutcome[] = []
    engine.onResult((o) => received.push(o))
    await engine.refreshNow()

    expect(received[0].outcome).toBe('cancelled')
  })

  it('unsubscribe stops further notifications', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope()), makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle })

    const received: RefreshOutcome[] = []
    const unsubscribe = engine.onResult((o) => received.push(o))
    await engine.refreshNow()
    unsubscribe()
    await engine.refreshNow()

    expect(received).toHaveLength(1)
  })
})

// ── No credential leakage ─────────────────────────────────────────────────────

describe('no credential leakage', () => {
  const SECRET = 'afk_live_refresh_engine_secret_key'

  it('a success RefreshOutcome never contains the credential', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth({ credential: SECRET }), expected: expected(), lifecycle })

    const outcome = await engine.refreshNow()
    expect(JSON.stringify(outcome)).not.toContain(SECRET)
  })

  it('a failure RefreshOutcome never contains the credential', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(401, {})])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth({ credential: SECRET }), expected: expected(), lifecycle })

    const outcome = await engine.refreshNow()
    expect(JSON.stringify(outcome)).not.toContain(SECRET)
  })

  it('onResult listener payloads never contain the credential', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth({ credential: SECRET }), expected: expected(), lifecycle })

    const received: RefreshOutcome[] = []
    engine.onResult((o) => received.push(o))
    await engine.refreshNow()

    expect(JSON.stringify(received)).not.toContain(SECRET)
  })

  it('the RefreshAttemptInfo never contains the credential (structural check — no auth field at all)', async () => {
    const { fetchImpl } = makeSequencedFetch([makeFakeResponse(200, makeEnvelope())])
    const lifecycle = new LifecycleController('ready')
    const engine = new RefreshEngine({ clock: makeFakeClock(), httpConfig: makeConfig(fetchImpl), call: makeCall(), auth: makeAuth({ credential: SECRET }), expected: expected(), lifecycle })

    const outcome = await engine.refreshNow()
    expect(outcome.attempt).not.toHaveProperty('auth')
    expect(outcome.attempt).not.toHaveProperty('credential')
  })
})
