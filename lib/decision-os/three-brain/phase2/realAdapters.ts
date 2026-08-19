/**
 * Production adapters wiring the Phase 2 contracts to the REAL repo systems — Prisma (`DecisionIntelligenceRun`
 * + `TokenReservation`), `TokenReservationService` (true reserve/finalize/release), `FeatureGateService`,
 * `resolveLeagueAccess`, and the durable `AutomationJob` engine for stale refreshes. NOT wired into any live
 * route yet (Phase 3) — Phase 3 calls `createManagedIntelligenceDeps()`.
 *
 * These use the TYPED Prisma delegates (`prisma.decisionIntelligenceRun`, `prisma.tokenReservation`,
 * `prisma.automationJob`) — the generated client is produced by `prisma generate`, so there is NO `(prisma as
 * any)` in this financial + tenant-scoped layer. Every adapter accepts an injected client so integration tests
 * can point at a proven-isolated database.
 */
import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { resolveLeagueAccess } from '@/lib/league-access'
import { TokenInsufficientBalanceError, TokenSpendRuleNotFoundError } from '@/lib/tokens/TokenSpendService'
import { TokenReservationService } from '@/lib/tokens/TokenReservationService'
import { resolveTokenChargeDecisionForUser } from '@/lib/tokens/subscription-policy'
import { DbEvidenceRehydrator, type CurrentEvidenceResolver } from './dbEvidenceRehydration'
import { LeagueEvidenceResolver } from './leagueEvidenceResolver'
import { runThreeBrainAnalysis, type RunThreeBrainOptions } from '../orchestrator'
import type { DecisionOSEvidencePacket, ThreeBrainDecisionResult } from '../types'
import type { FeatureAccessChecker, LeagueAccessChecker } from './entitlementPolicy'
import type { ClaimInput, ClaimResult, CompleteInput, FailInput, IntelligenceResultStore } from './resultStore'
import type { IntelligenceRefreshScheduler, IntelligenceTokenGuard, TokenReservation } from './tokenGuard'
import type { IntelligenceRunRecord, IntelligenceRunStatus } from './types'
import type { ManagedIntelligenceDeps } from './intelligenceService'

type PrismaLike = typeof defaultPrisma

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}
const asJson = (v: unknown): Prisma.InputJsonValue => v as unknown as Prisma.InputJsonValue

function mapRow(row: NonNullable<Awaited<ReturnType<PrismaLike['decisionIntelligenceRun']['findUnique']>>>): IntelligenceRunRecord {
  return {
    id: row.id,
    identityKey: row.resultKey,
    inputHash: row.inputHash,
    tool: row.tool,
    decisionType: row.decisionType,
    userId: row.userId,
    leagueId: row.leagueId,
    connectedGroupId: row.connectedGroupId,
    sport: row.sport,
    platform: row.platform,
    entitlementMode: row.entitlementMode,
    status: row.status as IntelligenceRunStatus,
    versionTag: row.versionTag,
    agreementState: row.agreementState,
    claudeState: row.claudeState,
    providerParticipation: (row.providerParticipation ?? null) as Record<string, string> | null,
    resultJson: (row.resultJson ?? null) as ThreeBrainDecisionResult | null,
    requestSnapshot: (row.requestSnapshot ?? null) as Record<string, unknown> | null,
    failureCategory: row.failureCategory,
    retryable: row.retryable,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    ownerToken: row.ownerToken,
    leaseExpiresAt: row.leaseExpiresAt,
    providerExecStartedAt: row.providerExecStartedAt,
    tokenLedgerId: row.tokenLedgerId,
    tokenReservationKey: row.tokenReservationKey,
    correlationId: row.correlationId,
    lastError: row.lastError,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
    lastAccessedAt: row.lastAccessedAt,
  }
}

/** Prisma-backed durable store. Single-flight uses the `result_key` unique constraint + optimistic takeover. */
export class PrismaIntelligenceResultStore implements IntelligenceResultStore {
  constructor(private readonly db: PrismaLike = defaultPrisma) {}

  async findByIdentity(input: { identityKey: string; userId: string }): Promise<IntelligenceRunRecord | null> {
    const row = await this.db.decisionIntelligenceRun.findFirst({
      where: { resultKey: input.identityKey, userId: input.userId }, // tenant-scoped read
    })
    return row ? mapRow(row) : null
  }

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const { identity, ownerToken, now, leaseMs } = input
    const leaseExpiresAt = new Date(now.getTime() + leaseMs)
    try {
      const created = await this.db.decisionIntelligenceRun.create({
        data: {
          resultKey: identity.identityKey,
          inputHash: identity.inputHash,
          tool: input.tool,
          decisionType: input.decisionType,
          userId: identity.scopeUserId,
          leagueId: identity.scopeLeagueId,
          connectedGroupId: input.connectedGroupId,
          sport: input.sport,
          platform: input.platform,
          status: 'running',
          versionTag: identity.versionTag,
          attemptCount: 1,
          maxAttempts: input.maxAttempts,
          ownerToken,
          leaseExpiresAt,
          startedAt: now,
        },
      })
      return { outcome: 'owner', run: mapRow(created), ownerToken }
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
    }

    const existing = await this.db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    if (!existing) return this.claim(input) // extremely rare delete race — retry once
    const run = mapRow(existing)

    // UNKNOWN is terminal for automatic execution — a finite lease/claim expiry MUST NOT permit re-execution.
    if (run.status === 'unknown') return { outcome: 'exists', run }

    const versionMismatch = run.versionTag !== identity.versionTag
    const notExpired = !run.expiresAt || run.expiresAt.getTime() > now.getTime()
    if (!versionMismatch) {
      if (run.status === 'succeeded' && notExpired) return { outcome: 'exists', run }
      const leaseLive = run.leaseExpiresAt != null && run.leaseExpiresAt.getTime() > now.getTime()
      if (run.status === 'running' && leaseLive) return { outcome: 'busy', run }
      if (run.status === 'failed' && (!run.retryable || run.attemptCount >= run.maxAttempts)) {
        return { outcome: 'exists', run }
      }
    }

    // HARD-CRASH GUARD: an expired 'running' run whose `providerExecStartedAt` was never cleared means the prior
    // owner crashed while an EXTERNAL provider request was in flight — the outcome is UNKNOWN. Transition to
    // 'unknown' (atomically, attemptCount-gated) and REFUSE re-execution; only reconciliation may resolve it.
    if (run.status === 'running' && run.providerExecStartedAt != null) {
      const marked = await this.db.decisionIntelligenceRun.updateMany({
        where: { resultKey: identity.identityKey, attemptCount: run.attemptCount, status: 'running' },
        data: { status: 'unknown', failureCategory: 'provider_outcome_unknown', retryable: false, completedAt: now },
      })
      if (marked.count !== 1) return { outcome: 'busy', run } // another worker got there first
      const reread = await this.db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
      return { outcome: 'exists', run: mapRow(reread!) }
    }

    // Atomic takeover of a stuck/expired/retryable/version-stale run — gated on prior attemptCount so one wins.
    // Clears any stale provider-exec marker for the NEW owner (a fresh execution starts clean).
    const takeover = await this.db.decisionIntelligenceRun.updateMany({
      where: { resultKey: identity.identityKey, attemptCount: run.attemptCount },
      data: {
        status: 'running',
        ownerToken,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
        startedAt: now,
        providerExecStartedAt: null,
        failureCategory: null,
        lastError: null,
        versionTag: identity.versionTag,
      },
    })
    if (takeover.count !== 1) return { outcome: 'busy', run }
    const reread = await this.db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    return { outcome: 'owner', run: mapRow(reread!), ownerToken }
  }

  async markProviderExecStarted(input: { identityKey: string; userId: string; ownerToken: string; now: Date }): Promise<void> {
    await this.db.decisionIntelligenceRun.updateMany({
      where: { resultKey: input.identityKey, ownerToken: input.ownerToken, userId: input.userId, status: 'running' },
      data: { providerExecStartedAt: input.now },
    })
  }

  async complete(input: CompleteInput): Promise<IntelligenceRunRecord> {
    const res = await this.db.decisionIntelligenceRun.updateMany({
      // status:'running' fences a LATE result from a crashed owner whose run was already moved to 'unknown'
      // (or superseded) — it can never resurrect an UNKNOWN into a persisted success.
      where: { resultKey: input.identityKey, ownerToken: input.ownerToken, userId: input.userId, status: 'running' },
      data: {
        status: 'succeeded',
        resultJson: asJson(input.result),
        requestSnapshot: asJson(input.requestSnapshot),
        providerParticipation: asJson(input.providerParticipation),
        agreementState: input.result.agreementState,
        claudeState: input.result.claudeState,
        entitlementMode: input.entitlementMode,
        tokenLedgerId: input.tokenLedgerId,
        tokenReservationKey: input.tokenReservationKey,
        expiresAt: input.expiresAt,
        completedAt: input.now,
        lastAccessedAt: input.now,
        providerExecStartedAt: null, // confirmed completion — clear the in-flight marker
        failureCategory: null,
        retryable: false,
        lastError: null,
      },
    })
    const row = await this.db.decisionIntelligenceRun.findUnique({ where: { resultKey: input.identityKey } })
    if (!row) throw new Error('intelligence run row vanished during complete')
    // count 0 → superseded owner / no-longer-running: do NOT refund; return whatever is now persisted.
    void res
    return mapRow(row)
  }

  async fail(input: FailInput): Promise<void> {
    await this.db.decisionIntelligenceRun.updateMany({
      // status:'running' → a late failure from a crashed owner cannot overwrite an already-'unknown' run.
      where: { resultKey: input.identityKey, ownerToken: input.ownerToken, userId: input.userId, status: 'running' },
      data: {
        status: 'failed',
        failureCategory: input.category,
        retryable: input.retryable,
        lastError: input.message.slice(0, 500),
        completedAt: input.now,
        providerExecStartedAt: null, // confirmed settlement (failure / graceful cancellation) — clear the marker
      },
    })
  }

  async markUnknown(input: { identityKey: string; userId: string; ownerToken: string; failureCategory: string; now: Date }): Promise<{ recorded: boolean }> {
    // Owner-token + status:'running' gated: a superseded owner (a successor already took over / marked UNKNOWN) is
    // fenced (count 0). The provider-exec marker is intentionally NOT cleared — it records that a provider request
    // was in flight when the outcome became unknowable. `unknown` is terminal for automatic execution.
    const res = await this.db.decisionIntelligenceRun.updateMany({
      where: { resultKey: input.identityKey, ownerToken: input.ownerToken, userId: input.userId, status: 'running' },
      data: { status: 'unknown', failureCategory: input.failureCategory, retryable: false, completedAt: input.now },
    })
    return { recorded: res.count === 1 }
  }

  async touch(input: { identityKey: string; userId: string; now: Date }): Promise<void> {
    await this.db.decisionIntelligenceRun
      .updateMany({ where: { resultKey: input.identityKey, userId: input.userId }, data: { lastAccessedAt: input.now } })
      .catch(() => {})
  }

  async extendFreshness(input: { identityKey: string; userId: string; expiresAt: Date | null; now: Date }): Promise<boolean> {
    const res = await this.db.decisionIntelligenceRun.updateMany({
      where: { resultKey: input.identityKey, userId: input.userId, status: 'succeeded' },
      data: { expiresAt: input.expiresAt, lastAccessedAt: input.now },
    })
    return res.count === 1
  }
}

/** Resolves the effective (discount-applied) token cost for a rule. Default reads the rule cost via the store
 *  client + applies the user's subscription discount; injectable so integration tests avoid entitlement I/O. */
export type IntelligenceCostResolver = (input: {
  userId: string
  ruleCode: string
  userEmail?: string | null
}) => Promise<number>

/** Token guard mapping reserve→hold, finalize→settle, release→return-hold via the true reservation service. */
export class ReservationTokenGuard implements IntelligenceTokenGuard {
  private readonly svc: TokenReservationService
  constructor(private readonly db: PrismaLike = defaultPrisma, private readonly costResolver?: IntelligenceCostResolver) {
    this.svc = new TokenReservationService(db)
  }

  private async resolveCost(input: { userId: string; ruleCode: string; userEmail?: string | null }): Promise<number> {
    if (this.costResolver) return this.costResolver(input)
    const rule = await this.db.tokenSpendRule.findUnique({
      where: { code: input.ruleCode },
      select: { tokenCost: true, isActive: true },
    })
    if (!rule || !rule.isActive) throw new TokenSpendRuleNotFoundError(input.ruleCode)
    const base = Math.max(1, Number(rule.tokenCost || 1))
    const decision = await resolveTokenChargeDecisionForUser({ userId: input.userId, ruleCode: input.ruleCode, baseTokenCost: base })
    return Math.max(1, Number(decision.effectiveTokenCost || base))
  }

  async reserve(input: Parameters<IntelligenceTokenGuard['reserve']>[0]) {
    if (input.entitlementMode === 'subscription' || !input.tokenRuleCode) {
      return {
        ok: true as const,
        reservation: { reservationKey: input.reservationKey, ledgerId: null, charged: false, tokenCost: 0 },
      }
    }
    try {
      const amount = await this.resolveCost({ userId: input.userId, ruleCode: input.tokenRuleCode, userEmail: input.userEmail })
      const res = await this.svc.reserve({
        userId: input.userId,
        amount,
        idempotencyKey: input.reservationKey,
        spendRuleCode: input.tokenRuleCode,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        intelligenceRunId: input.intelligenceRunId,
        userEmail: input.userEmail,
      })
      return {
        ok: true as const,
        reservation: { reservationKey: input.reservationKey, ledgerId: res.ledgerId, charged: res.amount > 0, tokenCost: res.amount },
      }
    } catch (err) {
      if (err instanceof TokenInsufficientBalanceError) {
        return { ok: false as const, denyReason: 'token_purchase_required' as const }
      }
      throw err
    }
  }

  async finalize(input: { userId: string; userEmail?: string | null; reservation: TokenReservation }): Promise<void> {
    if (!input.reservation.charged) return
    await this.svc.finalize({ userId: input.userId, idempotencyKey: input.reservation.reservationKey, userEmail: input.userEmail })
  }

  async release(input: { userId: string; userEmail?: string | null; reservation: TokenReservation; reason: string }): Promise<void> {
    if (!input.reservation.charged) return
    await this.svc.release({
      userId: input.userId,
      idempotencyKey: input.reservation.reservationKey,
      reason: input.reason,
      userEmail: input.userEmail,
    })
  }
}

/**
 * Durable stale-refresh scheduler backed by the repository's `AutomationJob` engine. Enqueues at most ONE
 * refresh per canonical key (unique `idempotencyKey`), persists the intent durably, and returns immediately —
 * it does NOT run providers inline (no blocking, no fire-and-forget promise). A Phase-3 drain executes pending
 * jobs, recovers abandoned ones (attempt-bounded), and the persisted row survives a crash.
 */
export function createDurableRefreshScheduler(db: PrismaLike = defaultPrisma): IntelligenceRefreshScheduler {
  return {
    async enqueue(task) {
      const idempotencyKey = `intel_refresh:${task.identityKey}`
      const metadata: Prisma.InputJsonValue = {
        identityKey: task.identityKey,
        tool: task.tool,
        decisionType: task.decisionType,
        kind: 'decision_os_intelligence_refresh',
      }
      try {
        await db.automationJob.create({
          data: {
            idempotencyKey,
            jobType: 'decision_os.intelligence_refresh',
            status: 'pending',
            userId: task.userId,
            leagueId: task.leagueId ?? undefined,
            maxAttempts: 2,
            metadata,
          },
        })
        return { refreshInProgress: true } // newly enqueued
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
        const existing = await db.automationJob.findUnique({ where: { idempotencyKey } })
        return { refreshInProgress: existing ? existing.status === 'pending' || existing.status === 'running' : false }
      }
    },
  }
}

export const realFeatureChecker: FeatureAccessChecker = {
  async check(input) {
    const decision = await new FeatureGateService().evaluateUserFeatureAccess(input.userId, input.featureId, input.userEmail)
    return { allowed: decision.allowed, requiredPlan: decision.requiredPlan }
  },
}

export const realLeagueChecker: LeagueAccessChecker = {
  async check(input) {
    const access = await resolveLeagueAccess(input.leagueId, input.userId)
    if (!access) return null
    return { isMember: access.isMember, isCommissioner: access.isCommissioner }
  },
}

/** Assemble production dependencies for Phase 3 wiring. Optionally inject a client (integration tests) + an
 *  orchestration options bag (userId-bound telemetry / timeout). */
export function createManagedIntelligenceDeps(
  overrides?: Partial<ManagedIntelligenceDeps> & {
    prisma?: PrismaLike
    orchestrationOptions?: RunThreeBrainOptions
    /** Per-tool current-evidence resolvers. Default: the real DB-backed `LeagueEvidenceResolver` (manager
     *  intelligence). Pass `[]` to force every tool refresh-unsupported (used by tests). */
    evidenceResolvers?: CurrentEvidenceResolver[]
  },
): ManagedIntelligenceDeps {
  const db = overrides?.prisma ?? defaultPrisma
  const orchestrationOptions = overrides?.orchestrationOptions
  // Provider-execution claim invariant: the run's single-flight lease MUST outlast the longest possible provider
  // call, so a successor's claim returns `busy` while owner A's request is unresolved (even if A crashed and its
  // signal never fired) — preventing a DUPLICATE provider request. leaseMs ≥ 2× the per-provider timeout.
  const providerTimeoutMs = orchestrationOptions?.perProviderTimeoutMs ?? 25_000
  const runLeaseMs = Math.max(overrides?.leaseMs ?? 60_000, providerTimeoutMs * 2 + 5_000)
  // DB-first rehydrator wired with the REAL production resolver(s) so at least one tool has a functional refresh
  // path (evidence rebuilt from persisted league state). Tests can override with `evidenceResolvers: []`.
  const resolvers = overrides?.evidenceResolvers ?? [new LeagueEvidenceResolver({ db })]
  const rehydrator = overrides?.evidenceRehydrator ?? new DbEvidenceRehydrator(resolvers, db)
  return {
    store: overrides?.store ?? new PrismaIntelligenceResultStore(db),
    tokenGuard: overrides?.tokenGuard ?? new ReservationTokenGuard(db),
    featureChecker: overrides?.featureChecker ?? realFeatureChecker,
    leagueChecker: overrides?.leagueChecker ?? realLeagueChecker,
    runOrchestration:
      overrides?.runOrchestration ??
      // Forward the Phase 2 lease-loss / deadline signal into the orchestration so it reaches the provider
      // network clients (Anthropic/OpenAI/DeepSeek/Grok) and cancels in-flight requests, AND forward the
      // per-request execution-history callback so the owner classifies an aborted attempt (confirmed-cancelled vs
      // UNKNOWN) from the COMPLETE proven history — every issued request, not just those in flight at the abort.
      ((packet: DecisionOSEvidencePacket, callOpts?: { signal?: AbortSignal; onProviderRequest?: RunThreeBrainOptions['onProviderRequest'] }) =>
        runThreeBrainAnalysis(packet, { ...orchestrationOptions, signal: callOpts?.signal, onProviderRequest: callOpts?.onProviderRequest })),
    observer: overrides?.observer,
    clock: overrides?.clock,
    newOwnerToken: overrides?.newOwnerToken,
    leaseMs: runLeaseMs, // ≥ 2× provider timeout — the durable provider-execution claim window (see above)
    maxAttempts: overrides?.maxAttempts,
    waiter: overrides?.waiter,
    sleep: overrides?.sleep,
    refreshScheduler: overrides?.refreshScheduler ?? createDurableRefreshScheduler(db),
    evidenceRehydrator: rehydrator,
    refreshSupported:
      overrides?.refreshSupported ??
      ((tool, decisionType, connectedGroupId) =>
        rehydrator instanceof DbEvidenceRehydrator && rehydrator.supports(tool, decisionType, connectedGroupId)),
  }
}
