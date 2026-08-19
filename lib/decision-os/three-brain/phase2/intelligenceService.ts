/**
 * Phase 2 managed-intelligence service — the DB-first flow that wraps the Phase 1.5 orchestration:
 *
 *   authenticate → validate league access + entitlement → canonical identity → DB-first reuse (fresh returns
 *   immediately, no provider call) → single-flight claim (coalesce duplicates) → reserve tokens if required →
 *   run Phase 1.5 orchestration → validate → persist → finalize token ONLY after a persisted success → return
 *   with freshness + source metadata. Any failure releases (refunds) the reservation and is never stored as a
 *   reusable success.
 *
 * STANDALONE — not wired to the live Decision OS routes or Chimmy (Phase 3/4). Every boundary (store, token
 * guard, entitlement checkers, orchestration, clock, scheduler) is injected, so the whole flow is exercised in
 * tests with an in-memory store, fake gates, and mocked providers — no DB, no real charges, no paid calls.
 */
import { toModelFacingEvidence } from '../evidencePacket'
import { aggregateExecutionSettlement, type OwnerExecutionSettlement, type ProviderRequestOutcome } from '../orchestrator'
import type { DecisionOSEvidencePacket, ThreeBrainDecisionResult } from '../types'
import { computeIntelligenceRequestIdentity } from './requestIdentity'
import { classifyStoredRun, computeExpiry, resolveFreshnessPolicy } from './freshnessPolicy'
import { classifyError, classifyOrchestrationOutcome } from './failureClassification'
import {
  resolveIntelligenceAccess,
  type FeatureAccessChecker,
  type LeagueAccessChecker,
} from './entitlementPolicy'
import type { IntelligenceResultStore } from './resultStore'
import type { IntelligenceRefreshScheduler, IntelligenceTokenGuard, TokenReservation } from './tokenGuard'
import type { EvidenceRehydrator } from './evidenceRehydration'
import { noopObserver, type IntelligenceEvent, type IntelligenceObserver } from './observability'
import type {
  EntitlementMode,
  FreshnessClass,
  IntelligenceDenyReason,
  IntelligenceFailureCategory,
  IntelligenceRequestContext,
  IntelligenceRunRecord,
  ManagedIntelligenceResponse,
} from './types'

const DEFAULT_LEASE_MS = 60_000
const DEFAULT_MAX_ATTEMPTS = 3

export type ManagedIntelligenceDeps = {
  store: IntelligenceResultStore
  tokenGuard: IntelligenceTokenGuard
  featureChecker: FeatureAccessChecker
  leagueChecker: LeagueAccessChecker
  /** The Phase 1.5 orchestration (mocked in tests via a getProvider-bound closure). An optional `AbortSignal` is
   *  passed on the durable-refresh path so a provider call can be cancelled if the maintenance lease is lost or a
   *  hard execution deadline fires; signal-unaware impls simply ignore it (the race still abandons the result). */
  runOrchestration: (
    packet: DecisionOSEvidencePacket,
    opts?: { signal?: AbortSignal; onProviderRequest?: (outcome: ProviderRequestOutcome) => void },
  ) => Promise<ThreeBrainDecisionResult>
  observer?: IntelligenceObserver
  clock?: () => Date
  newOwnerToken?: () => string
  leaseMs?: number
  maxAttempts?: number
  /** Bounded coalescing wait for a busy owner. maxWaitMs=0 → waiters return a controlled "running" at once. */
  waiter?: { pollMs: number; maxWaitMs: number }
  sleep?: (ms: number) => Promise<void>
  /** Durable refresh scheduler for stale-while-revalidate. When absent, stale results are served WITHOUT a
   *  refresh (never a fire-and-forget promise). The production impl is repository-job-backed (see realAdapters). */
  refreshScheduler?: IntelligenceRefreshScheduler
  /** Resolves CURRENT evidence for a deferred refresh. Defaults to `noLiveSourceRehydrator` (refuses to refresh
   *  from an old snapshot). See ./evidenceRehydration. */
  evidenceRehydrator?: EvidenceRehydrator
  /** Whether a stale result may ENQUEUE an executable refresh for this tool/decision/scope. When false (the
   *  default), the stale result is served WITHOUT enqueuing (so an unsupported tool/scope never retries every 10
   *  minutes). `connectedGroupId` is included because Phase 2 supports single-league refresh only — a
   *  connected-group request is unsupported until Phase 3 can rebuild complete multi-league evidence. */
  refreshSupported?: (tool: string, decisionType: string, connectedGroupId?: string | null) => boolean
}

let _ownerSeq = 0

/** Thrown when execution is aborted (lease lost or hard deadline) before a result is persisted. Carries the
 *  AGGREGATE provider settlement so the owner records the honest outcome — a CONFIRMED cancellation (safe retry)
 *  vs an UNKNOWN outcome (block automatic re-execution). Defaults to `confirmed_cancelled` (nothing was issued). */
export class IntelligenceAbortedError extends Error {
  constructor(readonly settlement: OwnerExecutionSettlement = 'confirmed_cancelled') {
    super('intelligence_execution_aborted')
    this.name = 'IntelligenceAbortedError'
  }
}

function makeEmit(ctx: IntelligenceRequestContext, observer: IntelligenceObserver) {
  return (e: Partial<IntelligenceEvent> & { type: IntelligenceEvent['type'] }) =>
    observer.emit({
      tool: ctx.tool,
      decisionType: ctx.packet.decisionType,
      userId: ctx.userId || undefined,
      correlationId: ctx.correlationId ?? null,
      ...e,
    })
}

/**
 * Re-run an intelligence request on the SAME canonical inputs and persist the replacement result. NON-billable
 * (reuse already stood on a prior charge) and NON-recursive (it claims + executes directly; it never enters
 * the stale-check path, so it can never enqueue another refresh). Used by the durable refresh job runner and
 * by the in-request stale-refresh enqueue. `deps.runOrchestration` must be able to produce a fresh result.
 */
export async function runIntelligenceRefresh(
  ctx: IntelligenceRequestContext,
  deps: ManagedIntelligenceDeps,
  opts?: { signal?: AbortSignal },
): Promise<{ refreshed: boolean; status: string }> {
  const observer = deps.observer ?? noopObserver
  const clock = deps.clock ?? (() => new Date())
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const newOwnerToken = deps.newOwnerToken ?? (() => `refresh-${clock().getTime()}-${++_ownerSeq}`)
  const emit = makeEmit(ctx, observer)
  const identity = computeIntelligenceRequestIdentity(ctx)
  const policy = resolveFreshnessPolicy(ctx.packet.decisionType)
  const ownerToken = newOwnerToken()
  const claim = await deps.store.claim({
    identity,
    tool: ctx.tool,
    decisionType: ctx.packet.decisionType,
    sport: ctx.packet.sport ?? null,
    platform: ctx.packet.platform ?? null,
    connectedGroupId: ctx.connectedGroupId ?? null,
    ownerToken,
    leaseMs,
    now: clock(),
    maxAttempts,
  })
  if (claim.outcome !== 'owner') return { refreshed: false, status: claim.outcome }
  const r = await executeAsOwner({
    ctx,
    identity,
    policy,
    ownerToken,
    entitlementMode: 'free_reuse',
    deps,
    clock,
    orchestrationVersion: identity.versionTag,
    emit,
    billable: false,
    signal: opts?.signal,
  })
  // Surface a durable UNKNOWN outcome distinctly so the parent refresh job can enter a reconciliation-required
  // terminal state (never "successfully refreshed", never a churned retry) instead of an ordinary failure.
  const isUnknown =
    r.status === 'failed' &&
    (r.failure?.category === 'provider_outcome_unknown' || r.failure?.category === 'provider_completed_unsettled')
  return { refreshed: r.status === 'succeeded', status: isUnknown ? 'unknown' : r.status }
}

export async function runManagedIntelligence(
  ctx: IntelligenceRequestContext,
  deps: ManagedIntelligenceDeps,
): Promise<ManagedIntelligenceResponse> {
  const observer = deps.observer ?? noopObserver
  const clock = deps.clock ?? (() => new Date())
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const newOwnerToken = deps.newOwnerToken ?? (() => `owner-${clock().getTime()}-${++_ownerSeq}`)
  const orchestrationVersion = computeIntelligenceRequestIdentity(ctx).versionTag
  const emit = makeEmit(ctx, observer)

  // 0) Authentication (defense — the access resolver also enforces this).
  if (!ctx.userId || !ctx.userId.trim()) {
    emit({ type: 'entitlement_denied', denyReason: 'authentication_required' })
    return deniedResponse('authentication_required', orchestrationVersion)
  }

  // 1) Access — entitlement + league membership. NO provider/token activity happens on denial.
  const access = await resolveIntelligenceAccess({
    ctx,
    featureChecker: deps.featureChecker,
    leagueChecker: deps.leagueChecker,
  })
  if (!access.ok) {
    emit({ type: 'entitlement_denied', denyReason: access.denyReason })
    return deniedResponse(access.denyReason, orchestrationVersion)
  }

  // 2) Canonical identity + freshness policy.
  const identity = computeIntelligenceRequestIdentity(ctx)
  const policy = resolveFreshnessPolicy(ctx.packet.decisionType)
  const now = clock()

  // 3) DB-first reuse.
  const existing = await deps.store.findByIdentity({ identityKey: identity.identityKey, userId: ctx.userId })
  const freshness = classifyStoredRun({ run: existing, policy, now, currentVersionTag: identity.versionTag })

  if (freshness === 'fresh' && existing) {
    await deps.store.touch({ identityKey: identity.identityKey, userId: ctx.userId, now }).catch(() => {})
    emit({ type: 'cache_hit' })
    return reusedResponse(existing, 'fresh', false, orchestrationVersion)
  }

  if (freshness === 'stale' && existing) {
    // Serve stale (clearly marked); enqueue exactly one DURABLE background refresh (repository-job-backed). The
    // response never depends on the refresh promise — durability comes from the persisted job, not a
    // fire-and-forget await.
    const refreshInProgress = await enqueueStaleRefresh(ctx, identity, deps)
    emit({ type: 'stale_hit' })
    return reusedResponse(existing, 'stale', refreshInProgress, orchestrationVersion)
  }

  if (freshness === 'failed_terminal' && existing) {
    emit({ type: 'failure', failureCategory: existing.failureCategory ?? 'internal' })
    return failureResponse(
      existing.id,
      (existing.failureCategory as IntelligenceFailureCategory) ?? 'internal',
      false,
      existing.lastError ?? 'Prior run failed terminally.',
      orchestrationVersion,
    )
  }

  if (freshness === 'invalidated') emit({ type: 'invalidated' })

  // 4) Single-flight claim (atomic, durable, cross-instance).
  const ownerToken = newOwnerToken()
  const claim = await deps.store.claim({
    identity,
    tool: ctx.tool,
    decisionType: ctx.packet.decisionType,
    sport: ctx.packet.sport ?? null,
    platform: ctx.packet.platform ?? null,
    connectedGroupId: ctx.connectedGroupId ?? null,
    ownerToken,
    leaseMs,
    now: clock(),
    maxAttempts,
  })

  if (claim.outcome === 'exists') {
    if (claim.run.status === 'succeeded') {
      emit({ type: 'cache_hit' })
      return reusedResponse(claim.run, 'fresh', false, orchestrationVersion)
    }
    emit({ type: 'failure', failureCategory: claim.run.failureCategory ?? 'internal' })
    return failureResponse(
      claim.run.id,
      (claim.run.failureCategory as IntelligenceFailureCategory) ?? 'internal',
      claim.run.retryable,
      claim.run.lastError ?? 'Prior run failed.',
      orchestrationVersion,
    )
  }

  if (claim.outcome === 'busy') {
    // Coalesce — never call providers. Bounded wait, then return the persisted result or a controlled running.
    const settled = await waitForCompletion(deps, identity.identityKey, ctx.userId, clock)
    emit({ type: 'coalesced_waiter' })
    if (settled && settled.status === 'succeeded') {
      return reusedResponse(settled, 'fresh', false, orchestrationVersion)
    }
    return runningResponse(claim.run.id, orchestrationVersion)
  }

  // claim.outcome === 'owner' — we execute.
  if (claim.run.attemptCount > 1) emit({ type: 'stuck_recovery', meta: { attempt: claim.run.attemptCount } })

  return executeAsOwner({
    ctx,
    identity,
    policy,
    ownerToken,
    intelligenceRunId: claim.run.id,
    entitlementMode: access.entitlementMode,
    tokenRuleCode: access.entitlementMode === 'tokens' ? access.tokenRuleCode : undefined,
    deps,
    clock,
    orchestrationVersion,
    emit,
    billable: true,
  })
}

// ── Owner execution (miss path + background refresh share this) ────────────────────────────────────────────
async function executeAsOwner(args: {
  ctx: IntelligenceRequestContext
  identity: ReturnType<typeof computeIntelligenceRequestIdentity>
  policy: ReturnType<typeof resolveFreshnessPolicy>
  ownerToken: string
  intelligenceRunId?: string
  entitlementMode: EntitlementMode
  tokenRuleCode?: string
  deps: ManagedIntelligenceDeps
  clock: () => Date
  orchestrationVersion: string
  emit: (e: Partial<IntelligenceEvent> & { type: IntelligenceEvent['type'] }) => void
  billable: boolean
  /** Durable-refresh cancellation — fires when the maintenance lease is lost or a hard deadline elapses. */
  signal?: AbortSignal
}): Promise<ManagedIntelligenceResponse> {
  const { ctx, identity, policy, ownerToken, deps, clock, orchestrationVersion, emit, signal } = args

  // 5) Reserve tokens (only now, as owner, about to spend). Non-billable refresh never charges.
  let reservation: TokenReservation | null = null
  if (args.billable) {
    const auth = await deps.tokenGuard.reserve({
      userId: ctx.userId,
      userEmail: ctx.userEmail,
      entitlementMode: args.entitlementMode === 'tokens' ? 'tokens' : 'subscription',
      tokenRuleCode: args.tokenRuleCode,
      reservationKey: identity.identityKey, // idempotency key — dedupes concurrent/retry reservations
      intelligenceRunId: args.intelligenceRunId ?? null,
      sourceType: 'decision_os_intelligence',
      sourceId: identity.identityKey,
      description: `Decision OS intelligence — ${ctx.tool}/${ctx.packet.decisionType}`,
      metadata: { tool: ctx.tool, decisionType: ctx.packet.decisionType, versionTag: identity.versionTag },
    })
    if (!auth.ok) {
      await deps.store
        .fail({
          identityKey: identity.identityKey,
          userId: ctx.userId,
          ownerToken,
          category: 'insufficient_tokens',
          retryable: true, // a token top-up makes a retry viable — not a terminal failure
          message: 'Insufficient token balance for this request.',
          now: clock(),
        })
        .catch(() => {})
      emit({ type: 'entitlement_denied', denyReason: 'token_purchase_required' })
      return deniedResponse('token_purchase_required', orchestrationVersion)
    }
    reservation = auth.reservation
    emit({ type: 'token_reserved', charged: reservation.charged, tokenCost: reservation.tokenCost })
  }

  // 6) Execute → validate → persist → finalize (release on any failure).
  let result: ThreeBrainDecisionResult
  let persisted: IntelligenceRunRecord
  // The COMPLETE provider execution history for this attempt — one entry per issued request, whether it settled
  // before, during, or after an abort. Folded via `aggregateExecutionSettlement`: a stage that COMPLETED before the
  // abort is never forgotten, so a full re-run can never silently duplicate a completed (billable) provider stage.
  const providerHistory: ProviderRequestOutcome[] = []
  try {
    if (signal?.aborted) throw new IntelligenceAbortedError('confirmed_cancelled') // lost before we issued anything
    const start = clock().getTime()
    // Durably mark that an EXTERNAL provider request is about to begin. If THIS process crashes before a
    // confirmed settlement clears it, a takeover sees the marker and moves the run to 'unknown' (no auto re-exec).
    await deps.store.markProviderExecStarted({ identityKey: identity.identityKey, userId: ctx.userId, ownerToken, now: clock() })
    // AWAIT the orchestration to fully SETTLE, recording EVERY provider request's disposition (not just the ones in
    // flight at the abort). On abort the signal cancels in-flight requests and no new stage starts; the orchestration
    // returns once cancellations settle (bounded by the per-provider timeout + cancel grace) — but "returned" ≠
    // "wholly cancelled", so we classify the ENTIRE attempt's history below.
    result = await deps.runOrchestration(ctx.packet, { signal, onProviderRequest: (o) => providerHistory.push(o) })
    emit({ type: 'orchestration', durationMs: clock().getTime() - start, ok: true })
    // lease lost during the call → classify the WHOLE attempt (any completed stage ⇒ UNKNOWN); do not persist
    if (signal?.aborted) throw new IntelligenceAbortedError(aggregateExecutionSettlement(providerHistory))

    const outcome = classifyOrchestrationOutcome(result)
    if (!outcome.success) {
      await deps.store
        .fail({
          identityKey: identity.identityKey,
          userId: ctx.userId,
          ownerToken,
          category: outcome.category,
          retryable: outcome.retryable,
          message: outcome.message,
          now: clock(),
        })
        .catch(() => {})
      await releaseReservation(deps, ctx, reservation, outcome.category, emit)
      emit({ type: 'failure', failureCategory: outcome.category })
      return failureResponse(null, outcome.category, outcome.retryable, outcome.message, orchestrationVersion)
    }

    // Success → persist BEFORE finalizing the charge. A persistence failure here throws → the catch below
    // RELEASES the hold (never a charge for an unpersisted run).
    persisted = await deps.store.complete({
      identityKey: identity.identityKey,
      userId: ctx.userId,
      ownerToken,
      result,
      requestSnapshot: toModelFacingEvidence(ctx.packet), // minimized — no userId/fingerprint/secrets
      providerParticipation: result.specialistStatus,
      entitlementMode: args.entitlementMode,
      tokenLedgerId: reservation?.ledgerId ?? null,
      tokenReservationKey: reservation?.reservationKey ?? null,
      expiresAt: computeExpiry(policy, clock()),
      now: clock(),
    })
  } catch (err) {
    // ── OWNER CANCELLATION (lease lost / deadline), THIS process alive ─────────────────────────────────────────
    // The marker's fate depends on the PROVEN provider settlement, not merely on the bounded wait returning. A
    // HARD CRASH would skip this entirely — the marker stays set and a takeover moves the run to 'unknown'.
    const abortSettlement: OwnerExecutionSettlement | null =
      err instanceof IntelligenceAbortedError ? err.settlement
      : signal?.aborted ? aggregateExecutionSettlement(providerHistory) // aborted, but surfaced as a raw throw
      : null
    if (abortSettlement) {
      return await settleAbortedExecution({
        settlement: abortSettlement,
        deps, ctx, identity, ownerToken, reservation, clock, emit, orchestrationVersion,
      })
    }
    const cls = classifyError(err)
    await deps.store
      .fail({
        identityKey: identity.identityKey,
        userId: ctx.userId,
        ownerToken,
        category: cls.category,
        retryable: cls.retryable,
        message: cls.message,
        now: clock(),
      })
      .catch(() => {})
    await releaseReservation(deps, ctx, reservation, cls.category, emit)
    emit({ type: 'failure', failureCategory: cls.category })
    return failureResponse(null, cls.category, cls.retryable, cls.message, orchestrationVersion)
  }

  // The result is PERSISTED. Finalize the charge OUTSIDE the try: a finalize error must NOT fail the run or
  // release the (successful) charge — the hold remains for the reconciliation sweep to settle or expire, so a
  // finalize crash under-bills (user-favorable) but never over-bills and never loses the delivered result.
  if (reservation) {
    try {
      await deps.tokenGuard.finalize({ userId: ctx.userId, userEmail: ctx.userEmail, reservation })
      emit({ type: 'token_finalized', charged: reservation.charged, tokenCost: reservation.tokenCost })
    } catch {
      // A finalize crash must NOT fail the persisted run or release the (successful) hold — the hold stays for
      // the reconciliation sweep to settle or expire. Surfaced as non-sensitive telemetry only.
      emit({ type: 'failure', failureCategory: 'internal', meta: { stage: 'finalize_deferred' } })
    }
  }
  emit({ type: 'success' })
  return successResponse(persisted, result, args.entitlementMode, orchestrationVersion)
}

/**
 * Settle an owner-cancelled execution (lease lost / deadline) according to the PROVEN provider settlement. Only a
 * CONFIRMED cancellation is safe to auto-retry; everything else is durable UNKNOWN. In all three cases the token
 * HOLD is released (never charged) and no result/freshness is persisted.
 *
 *   • confirmed_cancelled — every issued request confirmed cancellation (or none issued) → fail-RETRYABLE, marker
 *     cleared. A successor may safely re-execute.
 *   • confirmed_completed — a request completed but this (superseded) owner cannot settle it → UNKNOWN (no
 *     duplicate re-execution). We have no "completed-but-unsettled" reconcilable state, so record UNKNOWN.
 *   • unknown             — a request hung past the cancel grace or rejected ambiguously → UNKNOWN.
 *
 * UNKNOWN is retryable=false and the marker is PRESERVED; a finite lease/claim expiry can never convert it into
 * permission to re-execute (store.claim short-circuits `status:'unknown'`). If this owner was already superseded,
 * `markUnknown` is fenced (recorded=false) and the successor's takeover guard records UNKNOWN instead.
 */
async function settleAbortedExecution(a: {
  settlement: OwnerExecutionSettlement
  deps: ManagedIntelligenceDeps
  ctx: IntelligenceRequestContext
  identity: ReturnType<typeof computeIntelligenceRequestIdentity>
  ownerToken: string
  reservation: TokenReservation | null
  clock: () => Date
  emit: (e: Partial<IntelligenceEvent> & { type: IntelligenceEvent['type'] }) => void
  orchestrationVersion: string
}): Promise<ManagedIntelligenceResponse> {
  const { settlement, deps, ctx, identity, ownerToken, reservation, clock, emit, orchestrationVersion } = a

  if (settlement === 'confirmed_cancelled') {
    await deps.store
      .fail({
        identityKey: identity.identityKey,
        userId: ctx.userId,
        ownerToken,
        category: 'confirmed_cancellation',
        retryable: true, // KNOWN-safe: no billable request survived → a successor may re-execute
        message: 'Execution aborted — every provider request confirmed cancelled (or none issued); safe to retry.',
        now: clock(),
      })
      .catch(() => {})
    await releaseReservation(deps, ctx, reservation, 'aborted_confirmed_cancellation', emit)
    emit({ type: 'failure', failureCategory: 'confirmed_cancellation', meta: { stage: 'aborted_confirmed_cancellation' } })
    return failureResponse(null, 'confirmed_cancellation', true, 'Execution aborted; provider requests confirmed cancelled — retryable.', orchestrationVersion)
  }

  // confirmed_completed | unknown → durable UNKNOWN: no automatic re-execution, no freshness, hold released.
  const category: IntelligenceFailureCategory =
    settlement === 'confirmed_completed' ? 'provider_completed_unsettled' : 'provider_outcome_unknown'
  const message =
    settlement === 'confirmed_completed'
      ? 'A provider request completed but this owner could not settle it; recorded UNKNOWN to avoid a duplicate billable call.'
      : 'Provider cancellation could not be confirmed (unsettled or ambiguous); recorded UNKNOWN to avoid a duplicate provider call.'
  await deps.store
    .markUnknown({ identityKey: identity.identityKey, userId: ctx.userId, ownerToken, failureCategory: category, now: clock() })
    .catch(() => {})
  await releaseReservation(deps, ctx, reservation, `aborted_${settlement}`, emit)
  emit({ type: 'failure', failureCategory: category, meta: { stage: `aborted_${settlement}` } })
  return failureResponse(null, category, false, message, orchestrationVersion)
}

async function releaseReservation(
  deps: ManagedIntelligenceDeps,
  ctx: IntelligenceRequestContext,
  reservation: TokenReservation | null,
  reason: string,
  emit: (e: Partial<IntelligenceEvent> & { type: IntelligenceEvent['type'] }) => void,
): Promise<void> {
  if (!reservation) return
  await deps.tokenGuard
    .release({ userId: ctx.userId, userEmail: ctx.userEmail, reservation, reason })
    .catch(() => {})
  emit({ type: 'token_released', charged: reservation.charged, tokenCost: reservation.tokenCost })
}

/** Enqueue at most one DURABLE background refresh for a stale result. Returns whether a refresh is in progress.
 *  With no durable scheduler, the stale result is served WITHOUT a refresh (we never fire-and-forget). */
async function enqueueStaleRefresh(
  ctx: IntelligenceRequestContext,
  identity: ReturnType<typeof computeIntelligenceRequestIdentity>,
  deps: ManagedIntelligenceDeps,
): Promise<boolean> {
  if (!deps.refreshScheduler) return false
  // Refresh is UNSUPPORTED for this tool/scope (no current-evidence resolver, or a connected-group request that
  // Phase 2 cannot fully rebuild) → do NOT enqueue an executable refresh, so it never churns a retry every 10
  // minutes. The stale result is still served (honest: refreshInProgress=false; freshness is NOT bumped).
  if (!(deps.refreshSupported?.(ctx.tool, ctx.packet.decisionType, ctx.connectedGroupId) ?? false)) return false
  const { refreshInProgress } = await deps.refreshScheduler.enqueue({
    identityKey: identity.identityKey,
    tool: ctx.tool,
    decisionType: ctx.packet.decisionType,
    userId: ctx.userId,
    leagueId: identity.scopeLeagueId,
    // The refresh claims the run (durable single-flight) and recomputes, NON-billable + NON-recursive.
    // Invoked at most once per key by the durable job runner.
    run: () => runIntelligenceRefresh(ctx, deps).then(() => undefined),
  })
  return refreshInProgress
}

/** Bounded coalescing wait — polls the durable store, never calls providers. */
async function waitForCompletion(
  deps: ManagedIntelligenceDeps,
  identityKey: string,
  userId: string,
  clock: () => Date,
): Promise<IntelligenceRunRecord | null> {
  const waiter = deps.waiter ?? { pollMs: 50, maxWaitMs: 0 }
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const deadline = clock().getTime() + Math.max(0, waiter.maxWaitMs)
  // Always check once; loop only while there is time budget left.
  for (;;) {
    const run = await deps.store.findByIdentity({ identityKey, userId })
    if (run && (run.status === 'succeeded' || run.status === 'failed')) return run
    if (clock().getTime() >= deadline) return run
    await sleep(Math.max(1, waiter.pollMs))
  }
}

// ── Response builders ──────────────────────────────────────────────────────────────────────────────────────
function deniedResponse(reason: IntelligenceDenyReason, version: string): ManagedIntelligenceResponse {
  return {
    ok: false,
    resultId: null,
    status: 'denied',
    result: null,
    cached: false,
    freshness: 'miss',
    refreshInProgress: false,
    generatedAt: null,
    expiresAt: null,
    orchestrationVersion: version,
    providerAttribution: null,
    entitlementMode: null,
    denyReason: reason,
    failure: null,
  }
}

function reusedResponse(
  run: IntelligenceRunRecord,
  freshness: FreshnessClass,
  refreshInProgress: boolean,
  version: string,
): ManagedIntelligenceResponse {
  return {
    ok: true,
    resultId: run.id,
    status: 'succeeded',
    result: run.resultJson,
    cached: true,
    freshness,
    refreshInProgress,
    generatedAt: (run.completedAt ?? run.createdAt).toISOString(),
    expiresAt: run.expiresAt ? run.expiresAt.toISOString() : null,
    orchestrationVersion: version,
    providerAttribution: run.providerParticipation,
    entitlementMode: (run.entitlementMode as EntitlementMode) ?? 'free_reuse',
    denyReason: null,
    failure: null,
  }
}

function successResponse(
  run: IntelligenceRunRecord,
  result: ThreeBrainDecisionResult,
  entitlementMode: EntitlementMode,
  version: string,
): ManagedIntelligenceResponse {
  return {
    ok: true,
    resultId: run.id,
    status: 'succeeded',
    result,
    cached: false,
    freshness: 'fresh',
    refreshInProgress: false,
    generatedAt: (run.completedAt ?? run.createdAt).toISOString(),
    expiresAt: run.expiresAt ? run.expiresAt.toISOString() : null,
    orchestrationVersion: version,
    providerAttribution: result.specialistStatus,
    entitlementMode,
    denyReason: null,
    failure: null,
  }
}

function runningResponse(resultId: string | null, version: string): ManagedIntelligenceResponse {
  return {
    ok: true,
    resultId,
    status: 'running',
    result: null,
    cached: false,
    freshness: 'running',
    refreshInProgress: true,
    generatedAt: null,
    expiresAt: null,
    orchestrationVersion: version,
    providerAttribution: null,
    entitlementMode: null,
    denyReason: null,
    failure: null,
  }
}

function failureResponse(
  resultId: string | null,
  category: IntelligenceFailureCategory,
  retryable: boolean,
  message: string,
  version: string,
): ManagedIntelligenceResponse {
  return {
    ok: false,
    resultId,
    status: 'failed',
    result: null,
    cached: false,
    freshness: 'miss',
    refreshInProgress: false,
    generatedAt: null,
    expiresAt: null,
    orchestrationVersion: version,
    providerAttribution: null,
    entitlementMode: null,
    denyReason: null,
    failure: { category, retryable, message },
  }
}
