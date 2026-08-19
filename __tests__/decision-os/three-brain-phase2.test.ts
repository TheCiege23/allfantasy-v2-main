/**
 * Decision OS three-brain — Phase 2 managed-intelligence layer. Exercises the REAL service flow with the
 * database, token ledger, entitlement gate, and providers all replaced by in-memory fakes implementing the
 * exact production interfaces — NO real DB, NO real charges, NO paid provider calls.
 *
 * Proves: DB-first reuse bypasses every provider; miss executes + persists; materially-changed context and a
 * version bump do not reuse; freshness follows the per-tool policy; live data is never served stale; concurrent
 * identical requests coalesce to ONE provider execution + ONE charge; lease expiry recovers safely; auth /
 * league / entitlement denials do zero provider + zero token work; token reserve/finalize/release is idempotent
 * and never charges on failure; private results are user-scoped; secrets never persist; Phase 1.5 fallback still
 * flows through.
 */
import { describe, it, expect, vi } from 'vitest'
import { buildEvidencePacket } from '@/lib/decision-os/three-brain/evidencePacket'
import type { ThreeBrainDecisionResult } from '@/lib/decision-os/three-brain/types'
import { runManagedIntelligence, type ManagedIntelligenceDeps } from '@/lib/decision-os/three-brain/phase2/intelligenceService'
import { runIntelligenceRefreshJob, reconstructRefreshContext } from '@/lib/decision-os/three-brain/phase2/refreshJob'
import type { EvidenceRehydrator } from '@/lib/decision-os/three-brain/phase2/evidenceRehydration'
import { DbEvidenceRehydrator, type CurrentEvidenceResolver } from '@/lib/decision-os/three-brain/phase2/dbEvidenceRehydration'
import { computeIntelligenceRequestIdentity, intelligenceVersionTag } from '@/lib/decision-os/three-brain/phase2/requestIdentity'
import { classifyStoredRun, resolveFreshnessPolicy } from '@/lib/decision-os/three-brain/phase2/freshnessPolicy'
import { CountingObserver } from '@/lib/decision-os/three-brain/phase2/observability'
import { intelligenceLedgerIdentity } from '@/lib/tokens/TokenReservationService'
import type {
  ClaimInput,
  ClaimResult,
  CompleteInput,
  FailInput,
  IntelligenceResultStore,
} from '@/lib/decision-os/three-brain/phase2/resultStore'
import type { IntelligenceRefreshScheduler, IntelligenceTokenGuard, TokenReservation } from '@/lib/decision-os/three-brain/phase2/tokenGuard'
import type { FeatureAccessChecker, LeagueAccessChecker } from '@/lib/decision-os/three-brain/phase2/entitlementPolicy'
import type {
  IntelligenceRequestContext,
  IntelligenceRunRecord,
  IntelligenceRunStatus,
  IntelligenceTool,
} from '@/lib/decision-os/three-brain/phase2/types'

const NOW = new Date('2026-07-28T12:00:00.000Z')
const clock = () => NOW
const flush = async (n = 40) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ── Fakes ──────────────────────────────────────────────────────────────────────────────────────────────────
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v), (k, val) =>
    typeof val === 'string' && /^\d{4}-\d\d-\d\dT/.test(val) ? new Date(val) : val,
  ) as T
}

let seq = 0
function baseRecord(over: Partial<IntelligenceRunRecord>): IntelligenceRunRecord {
  return {
    id: `run-${++seq}`,
    identityKey: 'k',
    inputHash: 'h',
    tool: 'manager_intelligence',
    decisionType: 'trade_review',
    userId: 'user-1',
    leagueId: 'league-1',
    connectedGroupId: null,
    sport: 'NFL',
    platform: null,
    entitlementMode: null,
    status: 'pending',
    versionTag: intelligenceVersionTag(),
    agreementState: null,
    claudeState: null,
    providerParticipation: null,
    resultJson: null,
    requestSnapshot: null,
    failureCategory: null,
    retryable: false,
    attemptCount: 0,
    maxAttempts: 3,
    ownerToken: null,
    leaseExpiresAt: null,
    providerExecStartedAt: null,
    tokenLedgerId: null,
    tokenReservationKey: null,
    correlationId: null,
    lastError: null,
    createdAt: NOW,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    lastAccessedAt: null,
    ...over,
  }
}

/** In-memory store with the SAME atomic-claim / lease / owner-gated semantics as the Prisma store. */
class InMemoryStore implements IntelligenceResultStore {
  rows = new Map<string, IntelligenceRunRecord>()
  failComplete = false

  async findByIdentity(input: { identityKey: string; userId: string }): Promise<IntelligenceRunRecord | null> {
    const r = this.rows.get(input.identityKey)
    return r && r.userId === input.userId ? clone(r) : null // tenant-scoped
  }

  // NOTE: synchronous body (no await) → atomic across concurrent callers, like the DB unique constraint.
  async claim(input: ClaimInput): Promise<ClaimResult> {
    const { identity, ownerToken, now, leaseMs } = input
    const leaseExpiresAt = new Date(now.getTime() + leaseMs)
    const existing = this.rows.get(identity.identityKey)
    if (!existing) {
      const row = baseRecord({
        identityKey: identity.identityKey,
        inputHash: identity.inputHash,
        userId: identity.scopeUserId,
        leagueId: identity.scopeLeagueId,
        tool: input.tool,
        decisionType: input.decisionType,
        sport: input.sport,
        platform: input.platform,
        connectedGroupId: input.connectedGroupId,
        versionTag: identity.versionTag,
        status: 'running',
        attemptCount: 1,
        maxAttempts: input.maxAttempts,
        ownerToken,
        leaseExpiresAt,
        startedAt: now,
      })
      this.rows.set(identity.identityKey, row)
      return { outcome: 'owner', run: clone(row), ownerToken }
    }
    if (existing.status === 'unknown') return { outcome: 'exists', run: clone(existing) } // UNKNOWN blocks re-exec
    const versionMismatch = existing.versionTag !== identity.versionTag
    const notExpired = !existing.expiresAt || existing.expiresAt.getTime() > now.getTime()
    if (!versionMismatch) {
      if (existing.status === 'succeeded' && notExpired) return { outcome: 'exists', run: clone(existing) }
      const leaseLive = existing.leaseExpiresAt != null && existing.leaseExpiresAt.getTime() > now.getTime()
      if (existing.status === 'running' && leaseLive) return { outcome: 'busy', run: clone(existing) }
      if (existing.status === 'failed' && (!existing.retryable || existing.attemptCount >= existing.maxAttempts)) {
        return { outcome: 'exists', run: clone(existing) }
      }
    }
    // HARD-CRASH GUARD: expired 'running' with an uncleared provider-exec marker → UNKNOWN (blocked), no re-exec.
    if (existing.status === 'running' && existing.providerExecStartedAt != null) {
      existing.status = 'unknown'
      existing.failureCategory = 'provider_outcome_unknown'
      existing.retryable = false
      existing.completedAt = now
      return { outcome: 'exists', run: clone(existing) }
    }
    existing.status = 'running'
    existing.ownerToken = ownerToken
    existing.leaseExpiresAt = leaseExpiresAt
    existing.attemptCount += 1
    existing.startedAt = now
    existing.providerExecStartedAt = null // fresh execution starts clean
    existing.failureCategory = null
    existing.lastError = null
    existing.versionTag = identity.versionTag
    return { outcome: 'owner', run: clone(existing), ownerToken }
  }

  async complete(input: CompleteInput): Promise<IntelligenceRunRecord> {
    if (this.failComplete) throw new Error('database write failed during persist')
    const row = this.rows.get(input.identityKey)
    if (!row) throw new Error('vanished')
    if (row.ownerToken !== input.ownerToken || row.userId !== input.userId || row.status !== 'running') return clone(row) // superseded / not-running
    Object.assign(row, {
      status: 'succeeded' as IntelligenceRunStatus,
      resultJson: input.result,
      requestSnapshot: input.requestSnapshot,
      providerParticipation: input.providerParticipation,
      agreementState: input.result.agreementState,
      claudeState: input.result.claudeState,
      entitlementMode: input.entitlementMode,
      tokenLedgerId: input.tokenLedgerId,
      tokenReservationKey: input.tokenReservationKey,
      expiresAt: input.expiresAt,
      completedAt: input.now,
      lastAccessedAt: input.now,
      providerExecStartedAt: null,
      failureCategory: null,
      retryable: false,
      lastError: null,
    })
    return clone(row)
  }

  async fail(input: FailInput): Promise<void> {
    const row = this.rows.get(input.identityKey)
    if (!row || row.ownerToken !== input.ownerToken || row.status !== 'running') return // owner-gated + running-gated
    Object.assign(row, {
      status: 'failed' as IntelligenceRunStatus,
      failureCategory: input.category,
      retryable: input.retryable,
      lastError: input.message,
      completedAt: input.now,
      providerExecStartedAt: null,
    })
  }

  async markProviderExecStarted(input: { identityKey: string; userId: string; ownerToken: string; now: Date }): Promise<void> {
    const row = this.rows.get(input.identityKey)
    if (!row || row.ownerToken !== input.ownerToken || row.userId !== input.userId || row.status !== 'running') return
    row.providerExecStartedAt = input.now
  }

  async markUnknown(input: { identityKey: string; userId: string; ownerToken: string; failureCategory: string; now: Date }): Promise<{ recorded: boolean }> {
    const row = this.rows.get(input.identityKey)
    if (!row || row.ownerToken !== input.ownerToken || row.userId !== input.userId || row.status !== 'running') return { recorded: false } // fenced
    Object.assign(row, {
      status: 'unknown' as IntelligenceRunStatus,
      failureCategory: input.failureCategory,
      retryable: false,
      completedAt: input.now,
      // providerExecStartedAt intentionally PRESERVED — a provider request was in flight when the outcome unknowned
    })
    return { recorded: true }
  }

  async touch(input: { identityKey: string; userId: string; now: Date }): Promise<void> {
    const row = this.rows.get(input.identityKey)
    if (row && row.userId === input.userId) row.lastAccessedAt = input.now
  }

  async extendFreshness(input: { identityKey: string; userId: string; expiresAt: Date | null; now: Date }): Promise<boolean> {
    const row = this.rows.get(input.identityKey)
    if (row && row.userId === input.userId && row.status === 'succeeded') {
      row.expiresAt = input.expiresAt
      row.lastAccessedAt = input.now
      return true
    }
    return false
  }

  seedSucceeded(ctx: IntelligenceRequestContext, over: Partial<IntelligenceRunRecord> = {}) {
    const identity = computeIntelligenceRequestIdentity(ctx)
    const row = baseRecord({
      identityKey: identity.identityKey,
      inputHash: identity.inputHash,
      userId: ctx.userId,
      leagueId: identity.scopeLeagueId,
      tool: ctx.tool,
      decisionType: ctx.packet.decisionType,
      sport: ctx.packet.sport,
      versionTag: identity.versionTag,
      status: 'succeeded',
      resultJson: result({ shortAnswer: 'CACHED' }),
      providerParticipation: { deepseek: 'completed', grok: 'completed', openai: 'completed', anthropic: 'not_requested' },
      entitlementMode: 'subscription',
      completedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 3600_000),
      ...over,
    })
    this.rows.set(identity.identityKey, row)
    return row
  }
}

/** Models TRUE reservation semantics: reserve = HOLD (not a charge), finalize = SETTLED charge, release =
 *  return the hold (never charged). A failed run reserves then releases → settledCharges() stays 0. */
class FakeTokenGuard implements IntelligenceTokenGuard {
  reserveCalls = 0
  finalizeCalls = 0
  releaseCalls = 0
  insufficient = false
  finalizeThrows = false
  cost = 5
  private holds = new Map<string, { status: 'reserved' | 'finalized' | 'released'; amount: number }>()

  async reserve(input: Parameters<IntelligenceTokenGuard['reserve']>[0]) {
    this.reserveCalls += 1
    if (input.entitlementMode === 'subscription') {
      return { ok: true as const, reservation: { reservationKey: input.reservationKey, ledgerId: null, charged: false, tokenCost: 0 } }
    }
    const existing = this.holds.get(input.reservationKey)
    if (existing && existing.status !== 'released') {
      return { ok: true as const, reservation: { reservationKey: input.reservationKey, ledgerId: null, charged: existing.amount > 0, tokenCost: existing.amount } }
    }
    if (this.insufficient) return { ok: false as const, denyReason: 'token_purchase_required' as const }
    this.holds.set(input.reservationKey, { status: 'reserved', amount: this.cost }) // HOLD, not a charge
    return { ok: true as const, reservation: { reservationKey: input.reservationKey, ledgerId: null, charged: true, tokenCost: this.cost } }
  }

  async finalize(input: { reservation: TokenReservation }): Promise<void> {
    if (this.finalizeThrows) throw new Error('finalize crashed after persist')
    const h = this.holds.get(input.reservation.reservationKey)
    if (h && h.status === 'reserved') {
      h.status = 'finalized' // settled charge
      this.finalizeCalls += 1
    }
  }

  /** Reconciliation: settle a still-held reservation (used to prove a finalize-crash hold is recoverable). */
  reconcile(reservationKey: string) {
    const h = this.holds.get(reservationKey)
    if (h && h.status === 'reserved') {
      h.status = 'finalized'
      this.finalizeCalls += 1
    }
  }

  async release(input: { reservation: TokenReservation }): Promise<void> {
    const h = this.holds.get(input.reservation.reservationKey)
    if (h && h.status === 'reserved') {
      h.status = 'released' // hold returned; never charged
      this.releaseCalls += 1
    }
  }

  /** Count of SETTLED (finalized) charges — the only real debits. A failed run never increments this. */
  settledCharges() {
    return [...this.holds.values()].filter((h) => h.status === 'finalized').length
  }
  /** Currently-held (pending) reservations — should be 0 after every run settles or releases. */
  activeHolds() {
    return [...this.holds.values()].filter((h) => h.status === 'reserved').length
  }
}

/** Durable-refresh double: enqueues at most one refresh per identity key (as the AutomationJob impl does). */
class FakeRefreshScheduler implements IntelligenceRefreshScheduler {
  enqueues = 0
  captured: Array<() => Promise<void>> = []
  private keys = new Set<string>()
  async enqueue(task: Parameters<IntelligenceRefreshScheduler['enqueue']>[0]) {
    if (this.keys.has(task.identityKey)) return { refreshInProgress: true } // one per key
    this.keys.add(task.identityKey)
    this.enqueues += 1
    this.captured.push(task.run)
    return { refreshInProgress: true }
  }
}

const allowFeature: FeatureAccessChecker = { async check() { return { allowed: true } } }
const denyFeature: FeatureAccessChecker = { async check() { return { allowed: false, requiredPlan: 'pro' } } }
const memberLeague = (isCommissioner = false): LeagueAccessChecker => ({ async check() { return { isMember: true, isCommissioner } } })
const notMemberLeague: LeagueAccessChecker = { async check() { return null } }

function result(over: Partial<ThreeBrainDecisionResult> = {}): ThreeBrainDecisionResult {
  return {
    schemaVersion: '1',
    decisionType: 'trade_review',
    shortAnswer: 'OK',
    whatDataSays: '',
    whatItMeans: '',
    recommendedAction: 'accept',
    alternatives: [],
    caveats: [],
    evidenceIds: ['sig-1'],
    agreementState: 'consensus',
    specialistStatus: { deepseek: 'completed', grok: 'completed', openai: 'completed', anthropic: 'not_requested' },
    claudeState: 'not_requested',
    reviewVerdict: undefined,
    confidencePct: 70,
    freshness: { state: 'fresh' },
    missingInformation: [],
    ...over,
  }
}
const providerFailureResult = () =>
  result({ agreementState: 'deterministic_only', specialistStatus: { deepseek: 'failed', grok: 'failed', openai: 'skipped', anthropic: 'not_requested' }, shortAnswer: 'AI analysis unavailable' })
const fallbackResult = () =>
  result({ specialistStatus: { deepseek: 'completed', grok: 'completed', openai: 'failed', anthropic: 'completed' }, claudeState: 'fallback_synthesis', shortAnswer: 'FALLBACK' })

function packetOf(over: { decisionType?: string; factValue?: string; mode?: 'league' | 'global' } = {}) {
  return buildEvidencePacket({
    userId: 'user-1',
    sport: 'NFL',
    decisionType: over.decisionType ?? 'trade_review',
    mode: over.mode ?? 'league',
    canonicalLeagueId: over.mode === 'global' ? undefined : 'league-1',
    signals: [{ id: 'sig-1', kind: 'trade_pending', summary: 'pending trade' }],
    facts: [{ id: 'fact-1', label: 'Value', value: over.factValue ?? '10' }],
    freshness: { state: 'fresh' },
    requestId: 'req-1',
    generatedAt: NOW.toISOString(),
  })
}

function ctxOf(over: Partial<IntelligenceRequestContext> & { tool?: IntelligenceTool } = {}): IntelligenceRequestContext {
  return {
    tool: over.tool ?? 'manager_intelligence',
    userId: 'userId' in over ? (over.userId as string) : 'user-1',
    packet: over.packet ?? packetOf(),
    ...over,
  }
}

function makeDeps(over: Partial<ManagedIntelligenceDeps> = {}): ManagedIntelligenceDeps & { store: InMemoryStore; tokenGuard: FakeTokenGuard; orch: ReturnType<typeof vi.fn> } {
  const store = (over.store as InMemoryStore) ?? new InMemoryStore()
  const tokenGuard = (over.tokenGuard as FakeTokenGuard) ?? new FakeTokenGuard()
  const orch = (over.runOrchestration as ReturnType<typeof vi.fn>) ?? vi.fn(async () => result())
  return {
    store,
    tokenGuard,
    featureChecker: over.featureChecker ?? allowFeature,
    leagueChecker: over.leagueChecker ?? memberLeague(),
    runOrchestration: orch,
    observer: over.observer,
    clock,
    newOwnerToken: over.newOwnerToken,
    leaseMs: over.leaseMs,
    maxAttempts: over.maxAttempts,
    waiter: over.waiter,
    sleep: over.sleep,
    refreshScheduler: over.refreshScheduler,
    evidenceRehydrator: over.evidenceRehydrator,
    refreshSupported: over.refreshSupported,
    orch,
  } as ManagedIntelligenceDeps & { store: InMemoryStore; tokenGuard: FakeTokenGuard; orch: ReturnType<typeof vi.fn> }
}

// ── 1–2: DB-first reuse vs miss ──────────────────────────────────────────────────────────────────────────
describe('DB-first reuse', () => {
  it('1. a fresh stored result bypasses every model provider (and any charge)', async () => {
    const deps = makeDeps()
    const ctx = ctxOf()
    deps.store.seedSucceeded(ctx)
    const r = await runManagedIntelligence(ctx, deps)
    expect(deps.orch).not.toHaveBeenCalled()
    expect(deps.tokenGuard.reserveCalls).toBe(0)
    expect(r.cached).toBe(true)
    expect(r.freshness).toBe('fresh')
    expect(r.result?.shortAnswer).toBe('CACHED')
  })

  it('2. a cache miss runs the Phase 1.5 orchestration and persists the result', async () => {
    const deps = makeDeps()
    const ctx = ctxOf()
    const r = await runManagedIntelligence(ctx, deps)
    expect(deps.orch).toHaveBeenCalledTimes(1)
    expect(r.status).toBe('succeeded')
    expect(r.cached).toBe(false)
    const identity = computeIntelligenceRequestIdentity(ctx)
    expect(deps.store.rows.get(identity.identityKey)?.status).toBe('succeeded')
  })
})

// ── 3–6: freshness / invalidation ────────────────────────────────────────────────────────────────────────
describe('freshness & invalidation', () => {
  it('3. materially-changed league context is not reused (different fingerprint → different key)', async () => {
    const deps = makeDeps()
    deps.store.seedSucceeded(ctxOf({ packet: packetOf({ factValue: '10' }) }))
    const r = await runManagedIntelligence(ctxOf({ packet: packetOf({ factValue: '99' }) }), deps)
    expect(deps.orch).toHaveBeenCalledTimes(1) // recomputed, not reused
    expect(r.cached).toBe(false)
  })

  it('4. a version-tag change invalidates an older stored result', async () => {
    const deps = makeDeps()
    const ctx = ctxOf()
    deps.store.seedSucceeded(ctx, { versionTag: 'c0.s0.p0' }) // stale version under the current key
    const r = await runManagedIntelligence(ctx, deps)
    expect(deps.orch).toHaveBeenCalledTimes(1)
    expect(r.cached).toBe(false)
  })

  it('5. an expired stale-safe result is served stale + enqueues exactly one DURABLE refresh (deduped by key)', async () => {
    const scheduler = new FakeRefreshScheduler()
    const deps = makeDeps({ refreshScheduler: scheduler, refreshSupported: () => true }) // refresh supported → enqueues
    const ctx = ctxOf({ packet: packetOf({ decisionType: 'trade_review' }) }) // allowStale, SWR window
    deps.store.seedSucceeded(ctx, { expiresAt: new Date(NOW.getTime() - 60_000) }) // expired 1m ago, within SWR
    const r = await runManagedIntelligence(ctx, deps)
    expect(r.freshness).toBe('stale')
    expect(r.cached).toBe(true)
    expect(r.refreshInProgress).toBe(true)
    expect(deps.orch).not.toHaveBeenCalled() // request did not synchronously call providers
    // A second stale request must NOT enqueue a duplicate refresh.
    deps.store.seedSucceeded(ctx, { expiresAt: new Date(NOW.getTime() - 60_000) })
    await runManagedIntelligence(ctx, deps)
    expect(scheduler.enqueues).toBe(1) // exactly one durable refresh across duplicate stale requests
    await scheduler.captured[0]() // a durable runner executes the refresh
    expect(deps.orch).toHaveBeenCalledTimes(1)
  })

  it('6. expired LIVE-sensitive data is never served stale — it recomputes', async () => {
    const deps = makeDeps()
    const ctx = ctxOf({ packet: packetOf({ decisionType: 'injury_watch' }) }) // liveSensitive
    deps.store.seedSucceeded(ctx, { expiresAt: new Date(NOW.getTime() - 60_000) })
    const r = await runManagedIntelligence(ctx, deps)
    // The stale cached row was NOT served (cached:false); it was recomputed. The freshly-computed answer is
    // legitimately fresh — the safety property is that expired LIVE data is never returned from cache.
    expect(r.freshness).not.toBe('stale')
    expect(r.cached).toBe(false)
    expect(r.result?.shortAnswer).not.toBe('CACHED')
    expect(deps.orch).toHaveBeenCalledTimes(1) // recomputed, not served stale
  })
})

// ── 7–9: single-flight / lease ───────────────────────────────────────────────────────────────────────────
describe('single-flight coalescing & lease recovery', () => {
  it('7. concurrent identical requests result in only ONE provider execution', async () => {
    const d = deferred<ThreeBrainDecisionResult>()
    const orch = vi.fn(() => d.promise)
    const deps = makeDeps({ runOrchestration: orch })
    const ctx = ctxOf()
    const runs = Array.from({ length: 6 }, () => runManagedIntelligence(ctx, deps))
    await flush(60)
    expect(orch).toHaveBeenCalledTimes(1) // one owner; others coalesced
    d.resolve(result())
    const results = await Promise.all(runs)
    expect(orch).toHaveBeenCalledTimes(1)
    expect(results.some((r) => r.status === 'succeeded' && !r.cached)).toBe(true)
  })

  it('8. concurrent duplicate token-required requests result in only ONE charge', async () => {
    const d = deferred<ThreeBrainDecisionResult>()
    const deps = makeDeps({ runOrchestration: vi.fn(() => d.promise), featureChecker: denyFeature })
    const ctx = ctxOf()
    const runs = Array.from({ length: 6 }, () => runManagedIntelligence(ctx, deps))
    await flush(60)
    d.resolve(result())
    await Promise.all(runs)
    expect(deps.tokenGuard.settledCharges()).toBe(1) // exactly one settled charge
    expect(deps.tokenGuard.activeHolds()).toBe(0) // no stranded holds
  })

  it('9. an expired lease (stuck run) is safely recovered by a later request', async () => {
    const deps = makeDeps()
    const ctx = ctxOf()
    // Seed a stuck running row: lease already expired.
    const identity = computeIntelligenceRequestIdentity(ctx)
    deps.store.rows.set(
      identity.identityKey,
      baseRecord({
        identityKey: identity.identityKey,
        userId: ctx.userId,
        status: 'running',
        ownerToken: 'dead-owner',
        leaseExpiresAt: new Date(NOW.getTime() - 10_000),
        attemptCount: 1,
      }),
    )
    const r = await runManagedIntelligence(ctx, deps)
    expect(deps.orch).toHaveBeenCalledTimes(1) // took over the stuck run
    expect(r.status).toBe('succeeded')
    expect(deps.store.rows.get(identity.identityKey)?.attemptCount).toBe(2)
  })
})

// ── 10–14: access gating (zero provider/token on denial) ─────────────────────────────────────────────────
describe('entitlement gating (server-side, before any provider call)', () => {
  it('10. authentication failure → zero provider calls, zero token activity', async () => {
    const deps = makeDeps()
    const r = await runManagedIntelligence(ctxOf({ userId: '' }), deps)
    expect(r.status).toBe('denied')
    expect(r.denyReason).toBe('authentication_required')
    expect(deps.orch).not.toHaveBeenCalled()
    expect(deps.tokenGuard.reserveCalls).toBe(0)
  })

  it('11. league-access failure → zero provider calls', async () => {
    const deps = makeDeps({ leagueChecker: notMemberLeague })
    const r = await runManagedIntelligence(ctxOf(), deps)
    expect(r.denyReason).toBe('league_access_denied')
    expect(deps.orch).not.toHaveBeenCalled()
  })

  it('12. subscription entitlement permits a covered tool WITHOUT token usage', async () => {
    const deps = makeDeps({ featureChecker: allowFeature })
    const r = await runManagedIntelligence(ctxOf(), deps)
    expect(r.entitlementMode).toBe('subscription')
    expect(deps.tokenGuard.settledCharges()).toBe(0) // no token charge under subscription
    expect(deps.tokenGuard.activeHolds()).toBe(0) // and no hold placed
    expect(deps.orch).toHaveBeenCalledTimes(1)
  })

  it('13. a free user (no subscription, no tokens) cannot access gated intelligence via the API', async () => {
    const guard = new FakeTokenGuard()
    guard.insufficient = true
    const deps = makeDeps({ featureChecker: denyFeature, tokenGuard: guard })
    const r = await runManagedIntelligence(ctxOf(), deps)
    expect(r.denyReason).toBe('token_purchase_required')
    expect(deps.orch).not.toHaveBeenCalled()
  })

  it('14. a commissioner-only surface rejects an unauthorized manager', async () => {
    const deps = makeDeps({ leagueChecker: memberLeague(false) })
    const r = await runManagedIntelligence(ctxOf({ tool: 'commissioner_command_center' }), deps)
    expect(r.denyReason).toBe('commissioner_tier_required')
    expect(deps.orch).not.toHaveBeenCalled()
  })
})

// ── 15–19: token safety & idempotency ────────────────────────────────────────────────────────────────────
describe('token reservation / finalization / reversal', () => {
  const tokenDeps = () => makeDeps({ featureChecker: denyFeature }) // forces token path

  it('15. token-required execution reserves a hold and FINALIZES exactly once after success', async () => {
    const deps = tokenDeps()
    await runManagedIntelligence(ctxOf(), deps)
    expect(deps.tokenGuard.reserveCalls).toBe(1)
    expect(deps.tokenGuard.settledCharges()).toBe(1) // one settled charge
    expect(deps.tokenGuard.releaseCalls).toBe(0)
    expect(deps.tokenGuard.activeHolds()).toBe(0) // no stranded hold
  })

  it('16. a provider failure RELEASES the reservation and NEVER settles a charge', async () => {
    const deps = tokenDeps()
    deps.orch.mockImplementation(async () => providerFailureResult())
    const r = await runManagedIntelligence(ctxOf(), deps)
    expect(r.ok).toBe(false)
    expect(r.failure?.category).toBe('provider_unavailable')
    expect(deps.tokenGuard.reserveCalls).toBe(1) // a hold was placed
    expect(deps.tokenGuard.releaseCalls).toBe(1) // and returned
    expect(deps.tokenGuard.settledCharges()).toBe(0) // NEVER charged on failure
    expect(deps.tokenGuard.activeHolds()).toBe(0)
  })

  it('17. a persistence failure RELEASES the hold and NEVER settles a charge', async () => {
    const store = new InMemoryStore()
    store.failComplete = true
    const deps = makeDeps({ featureChecker: denyFeature, store })
    const r = await runManagedIntelligence(ctxOf(), deps)
    expect(r.failure?.category).toBe('persistence_failure')
    expect(deps.tokenGuard.releaseCalls).toBe(1)
    expect(deps.tokenGuard.settledCharges()).toBe(0) // no charge when persistence fails
  })

  it('18/19. retry / refresh reuse a paid result and never double-charge', async () => {
    const deps = tokenDeps()
    const ctx = ctxOf()
    await runManagedIntelligence(ctx, deps) // pays once (settles one charge)
    expect(deps.tokenGuard.settledCharges()).toBe(1)
    const second = await runManagedIntelligence(ctx, deps) // reuse
    expect(second.cached).toBe(true)
    expect(deps.tokenGuard.settledCharges()).toBe(1) // no second charge
    expect(deps.orch).toHaveBeenCalledTimes(1)
  })
})

// ── 20–23: privacy, isolation, read-only, fallback ───────────────────────────────────────────────────────
describe('privacy, isolation, read-only, fallback', () => {
  it('20. one user cannot retrieve another user’s private result', async () => {
    const deps = makeDeps()
    const ctxA = ctxOf({ userId: 'user-A', packet: packetOf() })
    deps.store.seedSucceeded(ctxA, { userId: 'user-A' })
    // Same league/decision inputs, different authenticated user.
    const ctxB: IntelligenceRequestContext = { ...ctxA, userId: 'user-B' }
    const r = await runManagedIntelligence(ctxB, deps)
    expect(r.cached).toBe(false) // B did not read A's row
    expect(deps.orch).toHaveBeenCalledTimes(1)
    // Direct store isolation: A's key is not readable as user-B.
    const identityA = computeIntelligenceRequestIdentity(ctxA)
    expect(await deps.store.findByIdentity({ identityKey: identityA.identityKey, userId: 'user-B' })).toBeNull()
  })

  it('21. imported-league execution completes read-only (no external write path exists)', async () => {
    const deps = makeDeps()
    const r = await runManagedIntelligence(ctxOf({ isImportedLeague: true }), deps)
    expect(r.status).toBe('succeeded')
    // The deps surface exposes NO league/platform write capability — analysis only.
    expect(Object.keys(deps)).not.toContain('leagueWriter')
  })

  it('22. persisted payloads contain no secrets, credentials, or evidence fingerprint', async () => {
    const deps = makeDeps()
    const ctx = ctxOf()
    await runManagedIntelligence(ctx, deps)
    const row = deps.store.rows.get(computeIntelligenceRequestIdentity(ctx).identityKey)!
    const snapshot = JSON.stringify(row.requestSnapshot)
    expect(snapshot).not.toContain(ctx.packet.evidenceFingerprint)
    expect(snapshot.toLowerCase()).not.toContain('apikey')
    expect(snapshot.toLowerCase()).not.toContain('authorization')
    expect(snapshot).not.toContain('user-1') // minimized model-facing view omits userId
  })

  it('23. a Phase 1.5 fallback synthesis flows through as a valid success', async () => {
    const deps = makeDeps()
    deps.orch.mockImplementation(async () => fallbackResult())
    const r = await runManagedIntelligence(ctxOf(), deps)
    expect(r.ok).toBe(true)
    expect(r.status).toBe('succeeded')
    expect(r.result?.claudeState).toBe('fallback_synthesis')
    expect(r.providerAttribution?.anthropic).toBe('completed')
  })
})

// ── unit-level supports + observability ──────────────────────────────────────────────────────────────────
describe('identity, freshness classifier, observability', () => {
  it('identity is deterministic + tenant-scoped', () => {
    const a = computeIntelligenceRequestIdentity(ctxOf())
    const b = computeIntelligenceRequestIdentity(ctxOf())
    expect(a.identityKey).toBe(b.identityKey)
    expect(computeIntelligenceRequestIdentity(ctxOf({ userId: 'other' })).identityKey).not.toBe(a.identityKey)
    expect(computeIntelligenceRequestIdentity(ctxOf({ packet: packetOf({ factValue: 'x' }) })).identityKey).not.toBe(a.identityKey)
  })

  it('freshness classifier: version mismatch → invalidated; live expired → miss; trade expired → stale', () => {
    const base = baseRecord({ status: 'succeeded' })
    expect(classifyStoredRun({ run: { ...base, versionTag: 'old' }, policy: resolveFreshnessPolicy('trade'), now: NOW, currentVersionTag: intelligenceVersionTag() })).toBe('invalidated')
    const expired = { ...base, expiresAt: new Date(NOW.getTime() - 60_000) }
    expect(classifyStoredRun({ run: expired, policy: resolveFreshnessPolicy('injury'), now: NOW, currentVersionTag: base.versionTag })).toBe('miss')
    expect(classifyStoredRun({ run: expired, policy: resolveFreshnessPolicy('trade'), now: NOW, currentVersionTag: base.versionTag })).toBe('stale')
  })

  it('observability answers reuse / avoided-call / dangling-charge questions', async () => {
    const observer = new CountingObserver()
    const deps = makeDeps({ observer, featureChecker: denyFeature })
    const ctx = ctxOf()
    await runManagedIntelligence(ctx, deps) // miss → orchestration + charge + finalize
    await runManagedIntelligence(ctx, deps) // cache hit → provider call avoided
    const snap = observer.snapshot()
    expect(snap.orchestrationsRun).toBe(1)
    expect(snap.providerCallsAvoided).toBeGreaterThanOrEqual(1)
    expect(snap.tokensReserved).toBe(1)
    expect(snap.tokensFinalized).toBe(1)
    expect(observer.danglingReservations()).toBe(0)
  })
})

// ── Crash-boundary financial safety (Step 7) ─────────────────────────────────────────────────────────────
describe('crash-boundary financial safety', () => {
  it('B1: crash BEFORE reservation (insufficient balance) → no hold, no charge; retry after top-up settles once', async () => {
    const guard = new FakeTokenGuard()
    guard.insufficient = true
    const deps = makeDeps({ featureChecker: denyFeature, tokenGuard: guard })
    const ctx = ctxOf()
    const r1 = await runManagedIntelligence(ctx, deps)
    expect(r1.denyReason).toBe('token_purchase_required')
    expect(guard.settledCharges()).toBe(0)
    expect(guard.activeHolds()).toBe(0)
    expect(deps.orch).not.toHaveBeenCalled()
    // Top up + retry → the failed run is recovered and settles EXACTLY once.
    guard.insufficient = false
    const r2 = await runManagedIntelligence(ctx, deps)
    expect(r2.status).toBe('succeeded')
    expect(guard.settledCharges()).toBe(1)
    expect(guard.activeHolds()).toBe(0)
  })

  it('B2: crash AFTER reservation but BEFORE provider execution → hold released, never charged', async () => {
    const deps = makeDeps({ featureChecker: denyFeature })
    const ctx = ctxOf()
    deps.orch.mockImplementationOnce(() => {
      throw new Error('worker died before provider ran') // synchronous — no provider work occurred
    })
    const r = await runManagedIntelligence(ctx, deps)
    expect(r.ok).toBe(false)
    expect(deps.tokenGuard.reserveCalls).toBe(1) // a hold was placed
    expect(deps.tokenGuard.releaseCalls).toBe(1) // and returned
    expect(deps.tokenGuard.settledCharges()).toBe(0) // never charged
    expect(deps.tokenGuard.activeHolds()).toBe(0)
  })

  it('B3: crash DURING provider execution → hold released, never charged; retry recomputes and settles once', async () => {
    const deps = makeDeps({ featureChecker: denyFeature })
    const ctx = ctxOf()
    deps.orch.mockImplementationOnce(async () => {
      await Promise.resolve()
      throw new Error('provider timeout mid-execution')
    })
    const r1 = await runManagedIntelligence(ctx, deps)
    expect(r1.ok).toBe(false)
    expect(deps.tokenGuard.settledCharges()).toBe(0)
    expect(deps.tokenGuard.releaseCalls).toBe(1)
    const r2 = await runManagedIntelligence(ctx, deps) // retry — provider now succeeds
    expect(r2.status).toBe('succeeded')
    expect(deps.tokenGuard.settledCharges()).toBe(1) // exactly one settled charge total
    expect(deps.orch).toHaveBeenCalledTimes(2) // recompute valid — first result was never persisted
  })

  it('B4: crash AFTER provider success but BEFORE persistence begins → hold released, never charged', async () => {
    // Provider succeeded but the run never persisted (complete rejects at the boundary) → release, no charge.
    const store = new InMemoryStore()
    store.failComplete = true
    const deps = makeDeps({ featureChecker: denyFeature, store })
    const ctx = ctxOf()
    const r = await runManagedIntelligence(ctx, deps)
    expect(r.failure?.category).toBe('persistence_failure')
    expect(deps.tokenGuard.settledCharges()).toBe(0) // no charge for an unpersisted run
    expect(deps.tokenGuard.releaseCalls).toBe(1)
    // No reusable result was stored (retry must recompute, not serve a phantom result).
    expect(store.rows.get(computeIntelligenceRequestIdentity(ctx).identityKey)?.status).not.toBe('succeeded')
  })

  it('B5: crash DURING persistence → hold released, never charged; retry recomputes and settles once', async () => {
    const store = new InMemoryStore()
    store.failComplete = true
    const deps = makeDeps({ featureChecker: denyFeature, store })
    const ctx = ctxOf()
    const r1 = await runManagedIntelligence(ctx, deps)
    expect(r1.failure?.category).toBe('persistence_failure')
    expect(deps.tokenGuard.settledCharges()).toBe(0)
    expect(deps.tokenGuard.releaseCalls).toBe(1)
    store.failComplete = false
    const r2 = await runManagedIntelligence(ctx, deps) // retry
    expect(r2.status).toBe('succeeded')
    expect(deps.tokenGuard.settledCharges()).toBe(1) // financially idempotent
  })

  it('B6: crash AFTER persistence but BEFORE finalization → result delivered, run NOT failed, hold retained', async () => {
    const guard = new FakeTokenGuard()
    guard.finalizeThrows = true // finalize never runs (worker died after persist)
    const deps = makeDeps({ featureChecker: denyFeature, tokenGuard: guard })
    const ctx = ctxOf()
    const r = await runManagedIntelligence(ctx, deps)
    expect(r.status).toBe('succeeded') // persisted result delivered
    expect(guard.releaseCalls).toBe(0) // NOT released (the run succeeded — the charge should stand)
    expect(guard.settledCharges()).toBe(0) // not yet settled — under-bills, never over-bills
    expect(guard.activeHolds()).toBe(1) // hold retained for reconciliation
    // Retry serves the persisted result WITHOUT re-running providers or re-reserving.
    const retry = await runManagedIntelligence(ctx, deps)
    expect(retry.cached).toBe(true)
    expect(deps.orch).toHaveBeenCalledTimes(1) // no duplicate provider execution
    expect(guard.reserveCalls).toBe(1) // no duplicate reservation
  })

  it('B7: crash DURING finalization → reconciliation eventually settles the successful run EXACTLY once', async () => {
    const guard = new FakeTokenGuard()
    guard.finalizeThrows = true // finalize begins and crashes → hold left reserved
    const deps = makeDeps({ featureChecker: denyFeature, tokenGuard: guard })
    const ctx = ctxOf()
    await runManagedIntelligence(ctx, deps)
    expect(guard.activeHolds()).toBe(1)
    expect(guard.settledCharges()).toBe(0)
    // Reconciliation (run persisted as succeeded) settles the retained hold exactly once.
    guard.reconcile(computeIntelligenceRequestIdentity(ctx).identityKey)
    guard.reconcile(computeIntelligenceRequestIdentity(ctx).identityKey) // idempotent second pass
    expect(guard.settledCharges()).toBe(1) // exactly once
    expect(guard.activeHolds()).toBe(0)
  })

  it('B8: retries after every failed state never settle more than one charge and never strand a hold', async () => {
    const deps = makeDeps({ featureChecker: denyFeature })
    const ctx = ctxOf()
    deps.orch.mockImplementation(async () => providerFailureResult()) // always fails
    await runManagedIntelligence(ctx, deps)
    await runManagedIntelligence(ctx, deps)
    await runManagedIntelligence(ctx, deps)
    expect(deps.tokenGuard.settledCharges()).toBe(0) // a perpetually-failing run is NEVER charged
    expect(deps.tokenGuard.activeHolds()).toBe(0) // and never strands a hold
  })
})

// ── Durable refresh — evidence rehydration (Blocker 2) ───────────────────────────────────────────────────
describe('durable refresh — evidence rehydration', () => {
  const rehydrator = (ctx: IntelligenceRequestContext | null, isLive = true): EvidenceRehydrator => ({
    async rehydrate() {
      if (!ctx) return { ok: false, reason: 'evidence_unavailable' }
      return { ok: true, ctx, sourceDataVersion: 'v1', isLiveEvidence: isLive, evidenceLoadedAt: NOW.toISOString() }
    },
  })
  const idOf = (ctx: IntelligenceRequestContext) => computeIntelligenceRequestIdentity(ctx).identityKey

  it('evidence-load failure retains the stale result and does NOT bump freshness', async () => {
    const deps = makeDeps({ evidenceRehydrator: rehydrator(null) })
    const ctx = ctxOf()
    const seeded = deps.store.seedSucceeded(ctx, { expiresAt: new Date(NOW.getTime() - 60_000) })
    const res = await runIntelligenceRefreshJob({ userId: ctx.userId, metadata: { identityKey: idOf(ctx) } }, deps)
    expect(res.status).toBe('failed')
    expect(String(res.message)).toContain('evidence_unavailable')
    expect(deps.orch).not.toHaveBeenCalled()
    expect(deps.store.rows.get(seeded.identityKey)?.expiresAt?.getTime()).toBe(seeded.expiresAt?.getTime())
  })

  it('a live-sensitive decision is NOT refreshed from non-live evidence', async () => {
    const ctx = ctxOf({ packet: packetOf({ decisionType: 'injury_watch' }) })
    const deps = makeDeps({ evidenceRehydrator: rehydrator(ctx, false) })
    deps.store.seedSucceeded(ctx, { expiresAt: new Date(NOW.getTime() - 60_000) })
    const res = await runIntelligenceRefreshJob({ userId: ctx.userId, metadata: { identityKey: idOf(ctx) } }, deps)
    expect(res.status).toBe('failed')
    expect(String(res.message)).toContain('live_requires_live_evidence')
    expect(deps.orch).not.toHaveBeenCalled()
  })

  it('material evidence change creates a NEW canonical run (old run left untouched)', async () => {
    const oldCtx = ctxOf({ packet: packetOf({ factValue: '10' }) })
    const newCtx = ctxOf({ packet: packetOf({ factValue: '99' }) })
    const deps = makeDeps({ evidenceRehydrator: rehydrator(newCtx), runOrchestration: vi.fn(async () => result({ shortAnswer: 'NEW' })) })
    expect(idOf(newCtx)).not.toBe(idOf(oldCtx))
    deps.store.seedSucceeded(oldCtx, { expiresAt: new Date(NOW.getTime() - 60_000) })
    const res = await runIntelligenceRefreshJob({ userId: oldCtx.userId, metadata: { identityKey: idOf(oldCtx) } }, deps)
    expect(res.status).toBe('completed')
    expect((res.metadata as { materialChange?: boolean }).materialChange).toBe(true)
    expect(deps.orch).toHaveBeenCalledTimes(1)
    expect(deps.store.rows.get(idOf(newCtx))?.status).toBe('succeeded')
  })

  it('unchanged evidence reuses the existing result (extends TTL) WITHOUT provider spend', async () => {
    const ctx = ctxOf()
    const deps = makeDeps({ evidenceRehydrator: rehydrator(ctx) })
    const seeded = deps.store.seedSucceeded(ctx, { expiresAt: new Date(NOW.getTime() - 60_000) })
    const res = await runIntelligenceRefreshJob({ userId: ctx.userId, metadata: { identityKey: idOf(ctx) } }, deps)
    expect(res.status).toBe('completed')
    expect((res.metadata as { reusedWithoutProvider?: boolean }).reusedWithoutProvider).toBe(true)
    expect(deps.orch).not.toHaveBeenCalled()
    expect(deps.store.rows.get(seeded.identityKey)!.expiresAt!.getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('reconstructRefreshContext rebuilds an identity-stable context from the persisted snapshot', () => {
    const ctx = ctxOf()
    const store = new InMemoryStore()
    const seeded = store.seedSucceeded(ctx)
    // Seed a snapshot equivalent to the minimized model-facing evidence.
    seeded.requestSnapshot = { sport: 'NFL', signals: [{ id: 'sig-1', kind: 'trade_pending', summary: 'x' }], facts: [{ id: 'fact-1', label: 'v', value: '10' }], freshness: { state: 'fresh' }, missingInformation: [] }
    const rebuilt = reconstructRefreshContext(seeded)
    expect(rebuilt).not.toBeNull()
    expect(rebuilt!.userId).toBe(ctx.userId)
    expect(rebuilt!.packet.decisionType).toBe('trade_review')
  })
})

// ── Identity + ledger length-safety (Blocker 5) ──────────────────────────────────────────────────────────
describe('identity & ledger length-safety', () => {
  it('the canonical identity key stays bounded regardless of userId/league length', () => {
    const key = computeIntelligenceRequestIdentity(ctxOf({ userId: 'u'.repeat(400) })).identityKey
    expect(key.length).toBeLessThan(200) // fits result_key / idempotency_key VarChar(255)
    expect(key.startsWith('intel:')).toBe(true)
  })

  it('ledger identity is a bounded domain-separated digest — deterministic + collision-resistant on shared prefix', () => {
    const a = 'X'.repeat(140) + 'A' // two keys sharing a >128-char prefix
    const b = 'X'.repeat(140) + 'B'
    const ida = intelligenceLedgerIdentity(a)
    expect(ida).toBe(intelligenceLedgerIdentity(a)) // deterministic
    expect(ida.startsWith('dintel:')).toBe(true)
    expect(ida.length).toBe(71) // 'dintel:' (7) + sha256 hex (64) — fits VarChar(128)
    expect(ida).not.toBe(intelligenceLedgerIdentity(b)) // distinct despite the shared 128-char prefix
  })
})

// ── DB-first rehydrator + refresh-support policy (Issue 1) ───────────────────────────────────────────────
describe('DB-first rehydrator + refresh-support policy', () => {
  // Minimal fake db exposing only the league-snapshot delegate the rehydrator reads.
  const fakeDb = (snap: Record<string, unknown> | null) =>
    ({ intelligenceLeagueSnapshot: { findUnique: async () => snap } }) as never
  const snapshot = { updatedAt: NOW, totalEvents: 3, tradeCount: 1, waiverCount: 0, lineupCount: 0, draftCount: 0, scoringCount: 0, governanceCount: 0, openTradeProposals: 0, lastActivityAt: NOW }
  const runRec = (over: Partial<IntelligenceRunRecord> = {}): IntelligenceRunRecord => ({ ...baseRecord({ status: 'succeeded', decisionType: 'trade_review', leagueId: 'league-1' }), ...over })
  const resolver = (opts: { live?: boolean; unavailable?: boolean; ctx?: IntelligenceRequestContext }): CurrentEvidenceResolver => ({
    supports: () => true,
    async resolve() {
      if (opts.unavailable) return { ok: false, reason: 'evidence_unavailable' }
      return { ok: true, ctx: opts.ctx ?? ctxOf(), isLive: opts.live ?? true }
    },
  })

  it('no resolver registered → tool refresh is UNSUPPORTED (honest refuse)', async () => {
    const r = await new DbEvidenceRehydrator([], fakeDb(snapshot)).rehydrate({ run: runRec() })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('refresh_unsupported_tool')
  })

  it('resolver present + current evidence loaded → ok with the CURRENT league source version', async () => {
    const reh = new DbEvidenceRehydrator([resolver({ live: true })], fakeDb(snapshot))
    const r = await reh.rehydrate({ run: runRec() })
    expect(r.ok).toBe(true)
    expect((r as { sourceDataVersion: string }).sourceDataVersion).toContain('v1:') // real league snapshot version
    expect(reh.supports('manager_intelligence', 'trade_review')).toBe(true)
  })

  it('evidence unavailable → refuse (stale not falsely refreshed)', async () => {
    const r = await new DbEvidenceRehydrator([resolver({ unavailable: true })], fakeDb(snapshot)).rehydrate({ run: runRec() })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('evidence_unavailable')
  })

  it('live-sensitive decision with NON-live evidence → refuse', async () => {
    const r = await new DbEvidenceRehydrator([resolver({ live: false })], fakeDb(snapshot)).rehydrate({ run: runRec({ decisionType: 'injury_watch' }) })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('live_evidence_stale_or_unavailable')
  })

  it('an UNSUPPORTED tool serves stale WITHOUT enqueuing a refresh (no 10-min retry churn)', async () => {
    const scheduler = new FakeRefreshScheduler()
    const deps = makeDeps({ refreshScheduler: scheduler, refreshSupported: () => false }) // unsupported
    const ctx = ctxOf({ packet: packetOf({ decisionType: 'trade_review' }) })
    deps.store.seedSucceeded(ctx, { expiresAt: new Date(NOW.getTime() - 60_000) })
    const r = await runManagedIntelligence(ctx, deps)
    expect(r.freshness).toBe('stale') // stale still served
    expect(r.refreshInProgress).toBe(false) // honest: no refresh in progress
    expect(scheduler.enqueues).toBe(0) // never enqueued → never retries every 10 min
  })
})
