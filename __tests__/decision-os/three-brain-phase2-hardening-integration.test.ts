// @vitest-environment node
import './_noopDbEnv' // MUST be first — lets the Prisma singleton init under node env when no DB is configured
/**
 * Phase 2 FINAL hardening — REAL-adapter integration against the proven-isolated cool-lab sandbox. Exercises
 * the ACTUAL FeatureGateService + resolveLeagueAccess (Blocker 1), the durable refresh worker (Blocker 2),
 * automatic reconciliation (Blocker 3), and global reserved-balance enforcement / token concurrency (Blocker 5).
 * The real access adapters use the module Prisma singleton, so this file is run with DATABASE_URL pointed at
 * the sandbox (never production); gated on TEST_DATABASE_URL and skipped otherwise. Providers are mocked.
 */
import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { buildEvidencePacket } from '@/lib/decision-os/three-brain/evidencePacket'
import {
  PrismaIntelligenceResultStore,
  ReservationTokenGuard,
  createDurableRefreshScheduler,
  createManagedIntelligenceDeps,
  realFeatureChecker,
  realLeagueChecker,
} from '@/lib/decision-os/three-brain/phase2/realAdapters'
import { runManagedIntelligence, runIntelligenceRefresh } from '@/lib/decision-os/three-brain/phase2/intelligenceService'
import { drainIntelligenceRefreshJobs, reconstructRefreshContext, runIntelligenceRefreshJob } from '@/lib/decision-os/three-brain/phase2/refreshJob'
import { buildLeagueIntelligenceEvidence, LeagueEvidenceResolver } from '@/lib/decision-os/three-brain/phase2/leagueEvidenceResolver'
import { runThreeBrainAnalysis, type ProviderRequestOutcome } from '@/lib/decision-os/three-brain/orchestrator'
import type { ThreeBrainProviderClient, ThreeBrainProviderGetter } from '@/lib/decision-os/three-brain/providerClient'
import { reconcileReservations } from '@/lib/decision-os/three-brain/phase2/reconciliationJob'
import { runIntelligenceMaintenance, INTELLIGENCE_MAINTENANCE_LOCK_KEY } from '@/lib/decision-os/three-brain/phase2/maintenanceRunner'
import { acquireAutomationLock, releaseAutomationLock, renewAutomationLock } from '@/lib/automation/locks'
import { DbEvidenceRehydrator, loadLeagueSourceVersion } from '@/lib/decision-os/three-brain/phase2/dbEvidenceRehydration'
import type { EvidenceRehydrator } from '@/lib/decision-os/three-brain/phase2/evidenceRehydration'
import type { IntelligenceRunRecord } from '@/lib/decision-os/three-brain/phase2/types'
import { computeIntelligenceRequestIdentity } from '@/lib/decision-os/three-brain/phase2/requestIdentity'
import { TokenReservationService, intelligenceLedgerIdentity } from '@/lib/tokens/TokenReservationService'
import { TokenSpendService, TokenInsufficientBalanceError } from '@/lib/tokens/TokenSpendService'
import type { IntelligenceRequestContext, IntelligenceTool } from '@/lib/decision-os/three-brain/phase2/types'
import type { ThreeBrainDecisionResult } from '@/lib/decision-os/three-brain/types'

const URL = process.env.TEST_DATABASE_URL
const RUN = !!URL
const suite = RUN ? describe : describe.skip
const NS = `p2h_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`
const db = RUN ? new PrismaClient({ datasourceUrl: URL }) : (null as unknown as PrismaClient)

const okResult = (short = 'OK'): ThreeBrainDecisionResult => ({
  schemaVersion: '1', decisionType: 'trade_review', shortAnswer: short, whatDataSays: '', whatItMeans: '',
  recommendedAction: 'accept', alternatives: [], caveats: [], evidenceIds: ['sig-1'], agreementState: 'consensus',
  specialistStatus: { deepseek: 'completed', grok: 'completed', openai: 'completed', anthropic: 'not_requested' },
  claudeState: 'not_requested', confidencePct: 70, freshness: { state: 'fresh' }, missingInformation: [],
})

let uidSeq = 0
async function seedUser(balance = 0): Promise<string> {
  const userId = `${NS}_u${++uidSeq}_${randomUUID().slice(0, 6)}`
  await db.appUser.create({ data: { id: userId, email: `${userId}@ex.test`, username: userId, updatedAt: new Date() } })
  if (balance > 0) await db.userTokenBalance.create({ data: { userId, balance, reservedBalance: 0 } })
  return userId
}
async function seedLeague(ownerUserId: string): Promise<string> {
  const leagueId = `${NS}_lg_${randomUUID().slice(0, 8)}`
  await db.league.create({
    data: { id: leagueId, userId: ownerUserId, platform: 'sleeper', platformLeagueId: leagueId, sport: 'NFL', updatedAt: new Date() },
  })
  return leagueId
}
async function seedRosterMember(leagueId: string, userId: string) {
  await db.roster.create({ data: { id: `${NS}_r_${randomUUID().slice(0, 8)}`, leagueId, platformUserId: userId, playerData: {}, updatedAt: new Date() } })
}
async function seedSupremeSubscription(userId: string) {
  const plan = await db.subscriptionPlan.upsert({
    where: { code: 'supreme' },
    update: {},
    create: { id: `${NS}_plan_supreme`, code: 'supreme', name: 'AF Supreme', updatedAt: new Date() },
  })
  await db.userSubscription.create({
    data: { id: `${NS}_sub_${randomUUID().slice(0, 8)}`, userId, subscriptionPlanId: plan.id, status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000), updatedAt: new Date() },
  })
}

function packetFor(userId: string, leagueId: string | null, over: { decisionType?: string; factValue?: string } = {}) {
  return buildEvidencePacket({
    userId, sport: 'NFL', decisionType: over.decisionType ?? 'trade_review',
    mode: leagueId ? 'league' : 'global', canonicalLeagueId: leagueId ?? undefined,
    signals: [{ id: 'sig-1', kind: 'trade_pending', summary: 'x' }],
    facts: [{ id: 'fact-1', label: 'v', value: over.factValue ?? '10' }],
    freshness: { state: 'fresh' }, requestId: 'req', generatedAt: new Date('2026-07-28T12:00:00Z').toISOString(),
  })
}
const ctxFor = (userId: string, leagueId: string | null, tool: IntelligenceTool = 'manager_intelligence', over = {}): IntelligenceRequestContext =>
  ({ tool, userId, packet: packetFor(userId, leagueId, over) })

function baseDeps(over: Record<string, unknown> = {}) {
  return createManagedIntelligenceDeps({
    prisma: db,
    tokenGuard: new ReservationTokenGuard(db, async () => 7), // fixed cost avoids entitlement I/O in cost calc
    runOrchestration: (over.runOrchestration as never) ?? (async () => okResult()),
    refreshScheduler: { async enqueue() { return { refreshInProgress: false } } },
    ...over,
  })
}

beforeAll(async () => { if (RUN) await db.$connect() })
afterAll(async () => { if (RUN) await db.$disconnect() })

// ── Blocker 1: real access-control adapters ──────────────────────────────────────────────────────────────
suite('Blocker 1 — real FeatureGate + league-access adapters', () => {
  it('1. unauthenticated → zero claims, zero reservations, zero provider calls', async () => {
    const orch = vi.fn(async () => okResult())
    const r = await runManagedIntelligence(ctxFor('', null), baseDeps({ runOrchestration: orch }))
    expect(r.denyReason).toBe('authentication_required')
    expect(orch).not.toHaveBeenCalled()
  })

  it('2. real resolveLeagueAccess denies a non-member → no reservation/provider/result exposure', async () => {
    const owner = await seedUser()
    const leagueId = await seedLeague(owner)
    const stranger = await seedUser(100)
    const orch = vi.fn(async () => okResult())
    const r = await runManagedIntelligence(ctxFor(stranger, leagueId), baseDeps({ runOrchestration: orch }))
    expect(r.denyReason).toBe('league_access_denied')
    expect(r.result).toBeNull()
    expect(orch).not.toHaveBeenCalled()
    // real checker directly
    expect(await realLeagueChecker.check({ leagueId, userId: stranger })).toBeNull()
  })

  it('3. real FeatureGate denies a free (no-subscription) user; with no tokens → token_purchase_required', async () => {
    const owner = await seedUser()
    const leagueId = await seedLeague(owner)
    const free = await seedUser(0) // member, no subscription, no tokens
    await seedRosterMember(leagueId, free)
    const decision = await realFeatureChecker.check({ userId: free, featureId: 'ai_team_managers' })
    expect(decision.allowed).toBe(false) // real gate: no subscription
    const orch = vi.fn(async () => okResult())
    const r = await runManagedIntelligence(ctxFor(free, leagueId), baseDeps({ runOrchestration: orch }))
    expect(r.denyReason).toBe('token_purchase_required')
    expect(orch).not.toHaveBeenCalled()
  })

  it('4. a manager (member, not commissioner) is rejected from a commissioner-only tool', async () => {
    const owner = await seedUser()
    const leagueId = await seedLeague(owner)
    const manager = await seedUser(100)
    await seedRosterMember(leagueId, manager)
    const access = await realLeagueChecker.check({ leagueId, userId: manager })
    expect(access).toEqual({ isMember: true, isCommissioner: false })
    const orch = vi.fn(async () => okResult())
    const r = await runManagedIntelligence(ctxFor(manager, leagueId, 'commissioner_command_center'), baseDeps({ runOrchestration: orch }))
    expect(r.denyReason).toBe('commissioner_tier_required')
    expect(orch).not.toHaveBeenCalled()
  })

  it('5. a commissioner (league owner) retains manager-tool capability', async () => {
    const commish = await seedUser(0)
    const leagueId = await seedLeague(commish) // owner ⇒ commissioner
    await seedSupremeSubscription(commish)
    const access = await realLeagueChecker.check({ leagueId, userId: commish })
    expect(access?.isCommissioner).toBe(true)
    const orch = vi.fn(async () => okResult('COMMISH_MGR'))
    const r = await runManagedIntelligence(ctxFor(commish, leagueId, 'manager_intelligence'), baseDeps({ runOrchestration: orch }))
    expect(r.status).toBe('succeeded') // NOT rejected from the manager tool
    expect(orch).toHaveBeenCalledTimes(1)
  })

  it('6. a subscription-covered user executes WITHOUT a token reservation/charge', async () => {
    const user = await seedUser(0)
    const leagueId = await seedLeague(await seedUser())
    await seedRosterMember(leagueId, user)
    await seedSupremeSubscription(user)
    expect((await realFeatureChecker.check({ userId: user, featureId: 'ai_team_managers' })).allowed).toBe(true)
    const r = await runManagedIntelligence(ctxFor(user, leagueId), baseDeps())
    expect(r.status).toBe('succeeded')
    expect(r.entitlementMode).toBe('subscription')
    // No reservation row was created for this run.
    const identity = computeIntelligenceRequestIdentity(ctxFor(user, leagueId))
    expect(await db.tokenReservation.findUnique({ where: { idempotencyKey: identity.identityKey } })).toBeNull()
  })

  it('7. token-mode cost comes from the repository rule (default resolver reads DB)', async () => {
    const user = await seedUser(500)
    const leagueId = await seedLeague(await seedUser())
    await seedRosterMember(leagueId, user)
    const guard = new ReservationTokenGuard(db) // DEFAULT resolver → reads token_spend_rules from DB
    const r = await runManagedIntelligence(ctxFor(user, leagueId), baseDeps({ tokenGuard: guard }))
    expect(r.status).toBe('succeeded')
    expect(r.entitlementMode).toBe('tokens')
    const identity = computeIntelligenceRequestIdentity(ctxFor(user, leagueId))
    const res = await db.tokenReservation.findUnique({ where: { idempotencyKey: identity.identityKey } })
    expect(res?.amount).toBeGreaterThan(0) // repository-authoritative cost, not client-supplied
  })

  it('8/9. client cannot bypass gating; a free user never receives another user’s cached premium result', async () => {
    const owner = await seedUser()
    const leagueId = await seedLeague(owner)
    const paid = await seedUser(0)
    await seedRosterMember(leagueId, paid)
    await seedSupremeSubscription(paid)
    const paidRun = await runManagedIntelligence(ctxFor(paid, leagueId, 'manager_intelligence', { factValue: 'shared' }), baseDeps())
    expect(paidRun.status).toBe('succeeded')

    // A free non-member requests the SAME canonical content — gated out; never sees the paid result.
    const free = await seedUser(0)
    const orch = vi.fn(async () => okResult())
    const r = await runManagedIntelligence(ctxFor(free, leagueId, 'manager_intelligence', { factValue: 'shared' }), baseDeps({ runOrchestration: orch }))
    expect(r.ok).toBe(false)
    expect(r.resultId).not.toBe(paidRun.resultId)
    expect(orch).not.toHaveBeenCalled()
  })
})

// A rehydrator that reconstructs the SAME evidence from the run's snapshot (unchanged → identity-stable).
const unchangedEvidenceRehydrator: EvidenceRehydrator = {
  async rehydrate({ run }: { run: IntelligenceRunRecord }) {
    const ctx = reconstructRefreshContext(run)
    if (!ctx) return { ok: false, reason: 'cannot_reconstruct' }
    return { ok: true, ctx, sourceDataVersion: 'v', isLiveEvidence: true, evidenceLoadedAt: new Date().toISOString() }
  },
}

// ── Blocker 2: durable refresh worker (evidence rehydration) ─────────────────────────────────────────────
suite('Blocker 2 — durable refresh worker', () => {
  it('duplicate stale requests create ONE job; the durable runner executes it and safely refreshes freshness', async () => {
    const user = await seedUser(0)
    const leagueId = await seedLeague(await seedUser())
    await seedRosterMember(leagueId, user)
    await seedSupremeSubscription(user)
    const ctx = ctxFor(user, leagueId, 'manager_intelligence', { decisionType: 'trade_review', factValue: 'refresh' })
    const identity = computeIntelligenceRequestIdentity(ctx)

    const scheduler = createDurableRefreshScheduler(db)
    // refreshSupported:true models a Phase-3-registered resolver so the enqueue side arms a durable refresh.
    const deps = baseDeps({ refreshScheduler: scheduler, evidenceRehydrator: unchangedEvidenceRehydrator, refreshSupported: () => true })
    await runManagedIntelligence(ctx, deps) // fresh miss → persists
    await db.decisionIntelligenceRun.update({ where: { resultKey: identity.identityKey }, data: { expiresAt: new Date(Date.now() - 60_000) } })

    const s1 = await runManagedIntelligence(ctx, deps)
    const s2 = await runManagedIntelligence(ctx, deps)
    expect(s1.freshness).toBe('stale')
    expect(s2.freshness).toBe('stale')
    const jobs = await db.automationJob.count({ where: { idempotencyKey: `intel_refresh:${identity.identityKey}` } })
    expect(jobs).toBe(1) // exactly one durable job across duplicate stale requests

    // The durable runner executes it → unchanged evidence → freshness extended (no false re-run).
    const drained = await drainIntelligenceRefreshJobs(deps, { db })
    expect(drained.completed).toBeGreaterThanOrEqual(1)
    const job = await db.automationJob.findUnique({ where: { idempotencyKey: `intel_refresh:${identity.identityKey}` } })
    expect(job?.status).toBe('completed')
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.expiresAt && run.expiresAt.getTime() > Date.now()).toBe(true) // TTL restored to fresh
  })

  it('with NO live evidence source (default rehydrator) the drain refuses and does NOT bump stale freshness', async () => {
    const user = await seedUser(0)
    const leagueId = await seedLeague(await seedUser())
    await seedRosterMember(leagueId, user)
    await seedSupremeSubscription(user)
    const ctx = ctxFor(user, leagueId, 'manager_intelligence', { decisionType: 'trade_review', factValue: 'noevd' })
    const identity = computeIntelligenceRequestIdentity(ctx)
    const deps = baseDeps() // default (noLiveSourceRehydrator)
    await runManagedIntelligence(ctx, deps)
    const staleExpiry = new Date(Date.now() - 60_000)
    await db.decisionIntelligenceRun.update({ where: { resultKey: identity.identityKey }, data: { expiresAt: staleExpiry } })
    await db.automationJob.create({ data: { idempotencyKey: `intel_refresh:${identity.identityKey}`, jobType: 'decision_os.intelligence_refresh', status: 'pending', userId: user, metadata: { identityKey: identity.identityKey }, maxAttempts: 2 } })
    const drained = await drainIntelligenceRefreshJobs(deps, { db })
    expect(drained.failed).toBeGreaterThanOrEqual(1) // refused — evidence unavailable
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.expiresAt?.getTime()).toBe(staleExpiry.getTime()) // stale NOT falsely refreshed
  })

  it('an abandoned (stale-running) refresh job is recovered on the next drain', async () => {
    const user = await seedUser(0)
    const leagueId = await seedLeague(await seedUser())
    await seedRosterMember(leagueId, user)
    await seedSupremeSubscription(user)
    const ctx = ctxFor(user, leagueId, 'manager_intelligence', { decisionType: 'trade_review', factValue: 'abandon' })
    const identity = computeIntelligenceRequestIdentity(ctx)
    const deps = baseDeps({ evidenceRehydrator: unchangedEvidenceRehydrator })
    await runManagedIntelligence(ctx, deps)
    // A stuck 'running' job started long ago (worker crashed).
    await db.automationJob.create({
      data: { idempotencyKey: `intel_refresh:${identity.identityKey}`, jobType: 'decision_os.intelligence_refresh', status: 'running', userId: user, startedAt: new Date(Date.now() - 30 * 60_000), metadata: { identityKey: identity.identityKey }, maxAttempts: 2 },
    })
    const drained = await drainIntelligenceRefreshJobs(deps, { db, staleRunningMs: 5 * 60_000 })
    expect(drained.processed).toBeGreaterThanOrEqual(1) // recovered the abandoned job
  })
})

// ── Blocker 1b: the registered maintenance RUNNER invokes both drains ─────────────────────────────────────
suite('Blocker 1 — maintenance runner invokes both durable drains', () => {
  it('runIntelligenceMaintenance (the runner, not a direct handler call) drains refresh + reconciles', async () => {
    // A stranded expired reservation for a succeeded run → reconciliation should settle it.
    const user = await seedUser()
    const k = `${NS}_runner_${randomUUID()}`
    await db.decisionIntelligenceRun.create({ data: { resultKey: k, inputHash: 'h', tool: 'manager_intelligence', decisionType: 'trade_review', userId: user, status: 'succeeded', versionTag: 'v', resultJson: okResult() as never, attemptCount: 1, maxAttempts: 3 } })
    const bal = await db.userTokenBalance.upsert({ where: { userId: user }, update: { balance: 100, reservedBalance: 5 }, create: { userId: user, balance: 100, reservedBalance: 5 }, select: { id: true } })
    await db.tokenReservation.create({ data: { userId: user, userTokenBalanceId: bal.id, amount: 5, status: 'reserved', idempotencyKey: k, reservedAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() - 60_000) } })

    const tickId = `test_${randomUUID().slice(0, 8)}`
    const out = await runIntelligenceMaintenance({ tickId, deps: baseDeps({ evidenceRehydrator: unchangedEvidenceRehydrator }), db })
    expect(out.status).toBe('completed')
    // The runner discovered + invoked BOTH registered handlers.
    expect(out.results).toHaveProperty('intelligence_refresh_drain')
    expect(out.results).toHaveProperty('reservation_reconcile')
    // Reconciliation ran without any user request and settled the stranded hold exactly once.
    expect((await db.tokenReservation.findUnique({ where: { idempotencyKey: k } }))?.status).toBe('finalized')
    expect((await db.userTokenBalance.findUnique({ where: { userId: user } }))?.balance).toBe(95)
    // The global maintenance lease was acquired for this tick and RELEASED on completion (no lingering lock,
    // and certainly not still owned by this tick).
    const lockAfter = await db.automationLock.findUnique({ where: { lockKey: INTELLIGENCE_MAINTENANCE_LOCK_KEY } })
    expect(lockAfter?.owner === `tick:${tickId}`).toBe(false)
  })

  // Issue 2 — TRUE global overlap lease. A per-tick idempotency key would let different tick ids overlap; the
  // shared DB lease does not. Proven deterministically (foreign-held lock blocks a tick), by expiry recovery
  // (crashed owner), and by exactly-once downstream settlement under real concurrency.
  it('a foreign-held global lease BLOCKS a different-tick run — it skips, and no drains execute', async () => {
    const user = await seedUser()
    const k = `${NS}_lease_block_${randomUUID()}`
    await db.decisionIntelligenceRun.create({ data: { resultKey: k, inputHash: 'h', tool: 'manager_intelligence', decisionType: 'trade_review', userId: user, status: 'succeeded', versionTag: 'v', resultJson: okResult() as never, attemptCount: 1, maxAttempts: 3 } })
    const bal = await db.userTokenBalance.upsert({ where: { userId: user }, update: { balance: 100, reservedBalance: 5 }, create: { userId: user, balance: 100, reservedBalance: 5 }, select: { id: true } })
    await db.tokenReservation.create({ data: { userId: user, userTokenBalanceId: bal.id, amount: 5, status: 'reserved', idempotencyKey: k, reservedAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() - 60_000) } })
    // A DIFFERENT owner (another tick id) already holds the ONE global maintenance lease.
    const foreign = `tick:other_${randomUUID().slice(0, 6)}`
    const held = await acquireAutomationLock(INTELLIGENCE_MAINTENANCE_LOCK_KEY, { owner: foreign, ttlMs: 60_000 }, db)
    expect(held.ok).toBe(true)
    try {
      const out = await runIntelligenceMaintenance({ tickId: `t_${randomUUID().slice(0, 6)}`, deps: baseDeps(), db })
      expect(out.status).toBe('skipped') // locked out — the drains never ran
      // The stranded hold is UNTOUCHED (proves the reconcile drain did not execute concurrently).
      expect((await db.tokenReservation.findUnique({ where: { idempotencyKey: k } }))?.status).toBe('reserved')
    } finally {
      await releaseAutomationLock(INTELLIGENCE_MAINTENANCE_LOCK_KEY, foreign, db)
    }
  })

  it('an EXPIRED global lease (crashed owner) is reclaimed by the next tick, which then runs', async () => {
    const user = await seedUser()
    const k = `${NS}_lease_expire_${randomUUID()}`
    await db.decisionIntelligenceRun.create({ data: { resultKey: k, inputHash: 'h', tool: 'manager_intelligence', decisionType: 'trade_review', userId: user, status: 'succeeded', versionTag: 'v', resultJson: okResult() as never, attemptCount: 1, maxAttempts: 3 } })
    const bal = await db.userTokenBalance.upsert({ where: { userId: user }, update: { balance: 100, reservedBalance: 5 }, create: { userId: user, balance: 100, reservedBalance: 5 }, select: { id: true } })
    await db.tokenReservation.create({ data: { userId: user, userTokenBalanceId: bal.id, amount: 5, status: 'reserved', idempotencyKey: k, reservedAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() - 60_000) } })
    // A crashed owner left an EXPIRED lease behind.
    await db.automationLock.upsert({
      where: { lockKey: INTELLIGENCE_MAINTENANCE_LOCK_KEY },
      update: { owner: 'crashed_owner', expiresAt: new Date(Date.now() - 60_000) },
      create: { lockKey: INTELLIGENCE_MAINTENANCE_LOCK_KEY, owner: 'crashed_owner', expiresAt: new Date(Date.now() - 60_000) },
    })
    const out = await runIntelligenceMaintenance({ tickId: `t_${randomUUID().slice(0, 6)}`, deps: baseDeps({ evidenceRehydrator: unchangedEvidenceRehydrator }), db })
    expect(out.status).toBe('completed') // reclaimed the abandoned lease and ran
    expect((await db.tokenReservation.findUnique({ where: { idempotencyKey: k } }))?.status).toBe('finalized')
  })

  it('concurrent different-tick runs settle a reservation EXACTLY once (exactly-once downstream)', async () => {
    const user = await seedUser()
    const k = `${NS}_runnerCC_${randomUUID()}`
    await db.decisionIntelligenceRun.create({ data: { resultKey: k, inputHash: 'h', tool: 'manager_intelligence', decisionType: 'trade_review', userId: user, status: 'succeeded', versionTag: 'v', resultJson: okResult() as never, attemptCount: 1, maxAttempts: 3 } })
    const bal = await db.userTokenBalance.upsert({ where: { userId: user }, update: { balance: 100, reservedBalance: 5 }, create: { userId: user, balance: 100, reservedBalance: 5 }, select: { id: true } })
    await db.tokenReservation.create({ data: { userId: user, userTokenBalanceId: bal.id, amount: 5, status: 'reserved', idempotencyKey: k, reservedAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() - 60_000) } })
    // Two overlapping ticks (different tick ids) race the global lease; the loser skips, but even if the lease
    // were bypassed the status-gated reconcile is idempotent — so settlement is exactly once either way.
    const [a, b] = await Promise.all([
      runIntelligenceMaintenance({ tickId: `t1_${randomUUID().slice(0, 6)}`, deps: baseDeps(), db, config: { leaseMs: 60_000 } }),
      runIntelligenceMaintenance({ tickId: `t2_${randomUUID().slice(0, 6)}`, deps: baseDeps(), db, config: { leaseMs: 60_000 } }),
    ])
    expect([a.status, b.status].filter((s) => s === 'completed').length).toBeGreaterThanOrEqual(1) // at least one ran
    const ledger = await db.tokenLedger.count({ where: { userId: user, entryType: 'spend' } })
    expect(ledger).toBe(1) // settled exactly once despite overlapping ticks
    expect((await db.userTokenBalance.findUnique({ where: { userId: user } }))?.balance).toBe(95) // debited once
  })
})

// ── Blocker 3: automatic reconciliation ──────────────────────────────────────────────────────────────────
suite('Blocker 3 — automatic reservation reconciliation', () => {
  async function seedRun(userId: string, status: string, withResult: boolean, resultKey: string) {
    await db.decisionIntelligenceRun.create({
      data: {
        resultKey, inputHash: 'h', tool: 'manager_intelligence', decisionType: 'trade_review', userId,
        status, versionTag: 'v', resultJson: withResult ? (okResult() as never) : undefined,
        attemptCount: 1, maxAttempts: 3,
      },
    })
  }
  async function seedHold(userId: string, resultKey: string, expired: boolean, amount = 6) {
    const bal = await db.userTokenBalance.upsert({ where: { userId }, update: {}, create: { userId }, select: { id: true } })
    await db.userTokenBalance.update({ where: { id: bal.id }, data: { balance: 100, reservedBalance: amount } })
    await db.tokenReservation.create({
      data: {
        userId, userTokenBalanceId: bal.id, amount, status: 'reserved', idempotencyKey: resultKey,
        reservedAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() + (expired ? -60_000 : 60_000)),
      },
    })
  }

  it('succeeded run → finalize once (debits); failed/missing → release once; running-lease → left alone', async () => {
    const uS = await seedUser(); const kS = `${NS}_recS_${randomUUID()}`
    await seedRun(uS, 'succeeded', true, kS); await seedHold(uS, kS, true)
    const uF = await seedUser(); const kF = `${NS}_recF_${randomUUID()}`
    await seedRun(uF, 'failed', false, kF); await seedHold(uF, kF, true)
    const uR = await seedUser(); const kR = `${NS}_recR_${randomUUID()}`
    await db.decisionIntelligenceRun.create({ data: { resultKey: kR, inputHash: 'h', tool: 'manager_intelligence', decisionType: 'trade_review', userId: uR, status: 'running', versionTag: 'v', leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: 1, maxAttempts: 3 } })
    await seedHold(uR, kR, true)

    const summary = await reconcileReservations({ db })
    expect(summary.finalized).toBeGreaterThanOrEqual(1)
    expect(summary.released).toBeGreaterThanOrEqual(1)
    // succeeded hold settled: balance debited, reservation finalized.
    expect((await db.tokenReservation.findUnique({ where: { idempotencyKey: kS } }))?.status).toBe('finalized')
    expect((await db.userTokenBalance.findUnique({ where: { userId: uS } }))?.balance).toBe(94)
    // failed hold released: reservation released, balance untouched.
    expect((await db.tokenReservation.findUnique({ where: { idempotencyKey: kF } }))?.status).toBe('released')
    expect((await db.userTokenBalance.findUnique({ where: { userId: uF } }))?.balance).toBe(100)
    // active running lease: hold left reserved.
    expect((await db.tokenReservation.findUnique({ where: { idempotencyKey: kR } }))?.status).toBe('reserved')
  })

  it('concurrent reconciliation workers finalize a succeeded run exactly once (idempotent)', async () => {
    const u = await seedUser(); const k = `${NS}_recCC_${randomUUID()}`
    await seedRun(u, 'succeeded', true, k); await seedHold(u, k, true)
    await Promise.all([reconcileReservations({ db }), reconcileReservations({ db }), reconcileReservations({ db })])
    const ledgerCount = await db.tokenLedger.count({ where: { userId: u, entryType: 'spend' } })
    expect(ledgerCount).toBe(1) // settled exactly once despite concurrent workers
    expect((await db.userTokenBalance.findUnique({ where: { userId: u } }))?.balance).toBe(94)
  })
})

// ── Blocker 5: global reserved-balance enforcement / token concurrency ───────────────────────────────────
suite('Blocker 5 — reserved balance respected by ordinary spend', () => {
  const RULE = 'ai_weekly_planning_session'
  it('an ordinary spend cannot consume reserved tokens (reservation vs spend)', async () => {
    const user = await seedUser(10)
    const svc = new TokenReservationService(db)
    await svc.reserve({ userId: user, amount: 8, idempotencyKey: `${NS}_b5_${randomUUID()}`, expiresInMs: 60_000 }) // hold 8 → spendable 2
    const spend = new TokenSpendService()
    // Rule cost ≥ 1; a spend needs ≤ 2 spendable. If the rule costs > 2 it must be refused, never dipping into the hold.
    const rule = await db.tokenSpendRule.findUnique({ where: { code: RULE }, select: { tokenCost: true } })
    if ((rule?.tokenCost ?? 99) > 2) {
      await expect(spend.spendTokensForRule({ userId: user, ruleCode: RULE, confirmed: true, sourceType: 'test', idempotencyKey: `${NS}_sp_${randomUUID()}` }))
        .rejects.toBeInstanceOf(TokenInsufficientBalanceError)
    }
    const bal = await db.userTokenBalance.findUnique({ where: { userId: user } })
    expect(bal!.balance).toBe(10) // hold never consumed by the spend
    expect(bal!.reservedBalance).toBe(8)
  })

  it('finalization cannot make balance negative and preserves the invariant', async () => {
    const user = await seedUser(5)
    const svc = new TokenReservationService(db)
    const key = `${NS}_b5f_${randomUUID()}`
    await svc.reserve({ userId: user, amount: 5, idempotencyKey: key, expiresInMs: 60_000 })
    await svc.finalize({ userId: user, idempotencyKey: key })
    const bal = await db.userTokenBalance.findUnique({ where: { userId: user } })
    expect(bal!.balance).toBe(0)
    expect(bal!.reservedBalance).toBe(0)
    expect(bal!.balance).toBeGreaterThanOrEqual(0)
  })
})

// ── Issue 3: finalize / release are ONE atomic transaction — fault injection proves full rollback ─────────
suite('Issue 3 — atomic token finalization (transaction boundary)', () => {
  // A Prisma client that THROWS when a chosen model.operation runs INSIDE the finalize/release transaction, so
  // we can prove a failure at ANY statement rolls back the ENTIRE transaction (no committed torn state). The
  // query extension applies to the tx client derived from this.db, so it fires within $transaction.
  const faultyAt = (model: string, op: string): PrismaClient => {
    const query = { [model]: { [op]: () => { throw new Error(`injected fault: ${model}.${op}`) } } }
    return db.$extends({ query } as never) as unknown as PrismaClient
  }

  async function seedReserved(amount = 5, startBalance = 20) {
    const user = await seedUser(startBalance)
    const key = `${NS}_atomic_${randomUUID()}`
    await new TokenReservationService(db).reserve({ userId: user, amount, idempotencyKey: key, expiresInMs: 60_000 })
    return { user, key, amount, startBalance }
  }
  // No committed state may contain: finalized-without-debit/ledger, debit-without-finalized, negative spendable,
  // or a duplicate ledger. After a rolled-back finalize the ONLY legal committed state is the clean pre-state.
  async function assertCleanPreState(user: string, key: string, amount: number, startBalance: number) {
    const res = await db.tokenReservation.findUnique({ where: { idempotencyKey: key } })
    expect(res?.status).toBe('reserved')          // claim rolled back — NOT finalized-without-ledger
    expect(res?.finalizedLedgerId ?? null).toBeNull()
    const bal = await db.userTokenBalance.findUnique({ where: { userId: user } })
    expect(bal!.balance).toBe(startBalance)        // NOT debited — no debit-without-finalized
    expect(bal!.reservedBalance).toBe(amount)      // hold intact
    expect(Number(bal!.balance) - Number(bal!.reservedBalance)).toBeGreaterThanOrEqual(0) // spendable >= 0
    const ledger = await db.tokenLedger.count({ where: { idempotencyKey: intelligenceLedgerIdentity(key) } })
    expect(ledger).toBe(0)                         // NO spend ledger
  }

  it('fault at the balance-debit statement -> full rollback (still reserved, no debit, no ledger)', async () => {
    const { user, key, amount, startBalance } = await seedReserved()
    await expect(new TokenReservationService(faultyAt('userTokenBalance', 'update')).finalize({ userId: user, idempotencyKey: key }))
      .rejects.toThrow(/injected fault/)
    await assertCleanPreState(user, key, amount, startBalance)
  })

  it('fault at the SPEND-ledger create (AFTER claim + debit) -> full rollback: no finalized-without-ledger', async () => {
    const { user, key, amount, startBalance } = await seedReserved()
    await expect(new TokenReservationService(faultyAt('tokenLedger', 'create')).finalize({ userId: user, idempotencyKey: key }))
      .rejects.toThrow(/injected fault/)
    await assertCleanPreState(user, key, amount, startBalance) // the claim + debit are rolled back with the failed insert
  })

  it('fault at the final reservation-link update (AFTER ledger create) -> full rollback: no ledger-without-finalized', async () => {
    const { user, key, amount, startBalance } = await seedReserved()
    await expect(new TokenReservationService(faultyAt('tokenReservation', 'update')).finalize({ userId: user, idempotencyKey: key }))
      .rejects.toThrow(/injected fault/)
    await assertCleanPreState(user, key, amount, startBalance) // the in-tx ledger row is rolled back -> none committed
  })

  it('release is atomic: a fault mid-release rolls back -> hold is NOT lost (still reserved)', async () => {
    const { user, key, amount } = await seedReserved()
    await expect(new TokenReservationService(faultyAt('userTokenBalance', 'update')).release({ userId: user, idempotencyKey: key, reason: 'test' }))
      .rejects.toThrow(/injected fault/)
    const res = await db.tokenReservation.findUnique({ where: { idempotencyKey: key } })
    expect(res?.status).toBe('reserved')      // release claim rolled back — not released-still-in-reserved
    const bal = await db.userTokenBalance.findUnique({ where: { userId: user } })
    expect(bal!.reservedBalance).toBe(amount) // hold intact
  })

  it('release: a fault AFTER the reserved->released status transition, DURING reserved_balance reduction, rolls back the WHOLE release; a clean retry releases EXACTLY once', async () => {
    const { user, key, amount, startBalance } = await seedReserved(5, 20)
    // The fault fires on userTokenBalance.update — i.e. after the atomic status claim (reserved->released) and
    // during the reserved_balance decrement. The entire transaction must roll back.
    await expect(new TokenReservationService(faultyAt('userTokenBalance', 'update')).release({ userId: user, idempotencyKey: key, reason: 'lost' }))
      .rejects.toThrow(/injected fault/)
    const res1 = await db.tokenReservation.findUnique({ where: { idempotencyKey: key } })
    expect(res1?.status).toBe('reserved')       // status claim rolled back — no released-without-refund state
    const bal1 = await db.userTokenBalance.findUnique({ where: { userId: user } })
    expect(bal1!.reservedBalance).toBe(amount)  // hold NOT reduced
    expect(bal1!.balance).toBe(startBalance)    // release never debits balance
    // Clean retry + idempotent duplicate → the hold is returned exactly once, balance untouched.
    await new TokenReservationService(db).release({ userId: user, idempotencyKey: key, reason: 'lost' })
    await new TokenReservationService(db).release({ userId: user, idempotencyKey: key, reason: 'lost' })
    const bal2 = await db.userTokenBalance.findUnique({ where: { userId: user } })
    expect(bal2!.reservedBalance).toBe(0)       // hold returned once (no double refund)
    expect(bal2!.balance).toBe(startBalance)    // balance still untouched
    expect((await db.tokenReservation.findUnique({ where: { idempotencyKey: key } }))?.status).toBe('released')
  })

  it('a clean RETRY after a rolled-back finalize settles EXACTLY once (fault + retry + duplicate call => one charge)', async () => {
    const { user, key, startBalance } = await seedReserved(5, 20)
    await expect(new TokenReservationService(faultyAt('tokenLedger', 'create')).finalize({ userId: user, idempotencyKey: key })).rejects.toThrow()
    await new TokenReservationService(db).finalize({ userId: user, idempotencyKey: key }) // clean retry -> settles
    await new TokenReservationService(db).finalize({ userId: user, idempotencyKey: key }) // idempotent duplicate
    const bal = await db.userTokenBalance.findUnique({ where: { userId: user } })
    expect(bal!.balance).toBe(startBalance - 5) // debited once
    expect(bal!.reservedBalance).toBe(0)
    const ledger = await db.tokenLedger.count({ where: { idempotencyKey: intelligenceLedgerIdentity(key) } })
    expect(ledger).toBe(1) // exactly ONE spend — no duplicate ledger despite the fault + retry + duplicate call
  })

  it('reconciliation-style repair of a pre-existing stranded hold finalizes once, then a second sweep does NOT double-charge', async () => {
    const { user, key, startBalance } = await seedReserved(6, 30)
    // Make the hold LOOK stranded (expired) with a succeeded run, as a pre-existing partial state would appear.
    await db.tokenReservation.update({ where: { idempotencyKey: key }, data: { expiresAt: new Date(Date.now() - 60_000) } })
    await db.decisionIntelligenceRun.create({ data: { resultKey: key, inputHash: 'h', tool: 'manager_intelligence', decisionType: 'trade_review', userId: user, status: 'succeeded', versionTag: 'v', resultJson: okResult() as never, attemptCount: 1, maxAttempts: 3 } })
    await reconcileReservations({ db, limit: 50, hardAbandonMs: 0 }) // first sweep repairs it
    await reconcileReservations({ db, limit: 50, hardAbandonMs: 0 }) // second sweep must be a no-op
    const bal = await db.userTokenBalance.findUnique({ where: { userId: user } })
    expect(bal!.balance).toBe(startBalance - 6)  // debited exactly once
    const ledger = await db.tokenLedger.count({ where: { idempotencyKey: intelligenceLedgerIdentity(key) } })
    expect(ledger).toBe(1)                        // one SPEND ledger across two sweeps
  })
})

// ── Issue 1: the REAL DB-first rehydrator reads authoritative persisted state (no live provider) ──────────
suite('Issue 1 — DB-first evidence rehydrator (real snapshot source)', () => {
  it('loadLeagueSourceVersion derives a CURRENT version from the persisted IntelligenceLeagueSnapshot', async () => {
    const owner = await seedUser()
    const leagueId = await seedLeague(owner)
    await db.intelligenceLeagueSnapshot.create({
      data: { leagueId, totalEvents: 4, tradeCount: 2, waiverCount: 1, lineupCount: 1, scoringCount: 0, governanceCount: 0, openTradeProposals: 1, lastActivityAt: new Date('2026-07-27T00:00:00Z') },
    })
    const v1 = await loadLeagueSourceVersion(db, leagueId)
    expect(v1?.version).toMatch(/^v1:/)
    expect(v1?.version).toContain(':4:2:1:1:') // event/trade/waiver/lineup counts encoded

    // A new trade bumps the snapshot -> a DIFFERENT (materially-changed) version.
    await db.intelligenceLeagueSnapshot.update({ where: { leagueId }, data: { totalEvents: 5, tradeCount: 3 } })
    const v2 = await loadLeagueSourceVersion(db, leagueId)
    expect(v2?.version).not.toBe(v1?.version) // material change -> new identity signal
  })

  it('DbEvidenceRehydrator: unsupported (no resolver) refuses; a registered resolver rehydrates on current evidence', async () => {
    const owner = await seedUser()
    const leagueId = await seedLeague(owner)
    await db.intelligenceLeagueSnapshot.create({ data: { leagueId, totalEvents: 2, tradeCount: 1, openTradeProposals: 0, lastActivityAt: new Date() } })
    const run = { tool: 'manager_intelligence', decisionType: 'trade_review', leagueId } as unknown as IntelligenceRunRecord

    // No resolver registered -> refresh unsupported (honest refuse; enqueue side will not arm a refresh).
    const none = await new DbEvidenceRehydrator([], db).rehydrate({ run })
    expect(none.ok).toBe(false)
    expect((none as { reason: string }).reason).toBe('refresh_unsupported_tool')

    // A registered resolver rebuilds the CURRENT context and receives the real league source version.
    let sawVersion: string | null = null
    const resolver = {
      supports: () => true,
      async resolve({ sourceDataVersion }: { sourceDataVersion: string | null }) {
        sawVersion = sourceDataVersion
        return { ok: true as const, ctx: ctxFor(owner, leagueId), isLive: true }
      },
    }
    const ok = await new DbEvidenceRehydrator([resolver], db).rehydrate({ run })
    expect(ok.ok).toBe(true)
    expect(sawVersion).toMatch(/^v1:/) // the resolver rebuilt against the current persisted version, not the old snapshot
  })
})

// ── Blocker 1: the REAL production resolver completes the ENTIRE durable refresh cycle (manager_intelligence) ─
suite('Blocker 1 — registered production resolver: end-to-end durable refresh cycle', () => {
  async function seedManagerLeague(opts?: { trades?: number; events?: number; syncStatus?: string }) {
    const owner = await seedUser()
    const user = await seedUser() // the requesting manager (member, supreme)
    const leagueId = await seedLeague(owner)
    await seedRosterMember(leagueId, user)
    await seedSupremeSubscription(user)
    await db.roster.create({ data: { id: `${NS}_r2_${randomUUID().slice(0, 8)}`, leagueId, platformUserId: owner, playerData: {}, updatedAt: new Date() } })
    if (opts?.syncStatus) await db.league.update({ where: { id: leagueId }, data: { syncStatus: opts.syncStatus } })
    await db.intelligenceLeagueSnapshot.create({
      data: { leagueId, totalEvents: opts?.events ?? 5, tradeCount: opts?.trades ?? 2, waiverCount: 1, lineupCount: 1, draftCount: 0, scoringCount: 0, governanceCount: 0, openTradeProposals: 1, lastActivityAt: new Date('2026-07-27T00:00:00Z') },
    })
    return { user, leagueId }
  }
  const ctxOf = (b: Awaited<ReturnType<typeof buildLeagueIntelligenceEvidence>>) => (b as { ctx: IntelligenceRequestContext }).ctx
  const keyOf = (b: Awaited<ReturnType<typeof buildLeagueIntelligenceEvidence>>) => computeIntelligenceRequestIdentity(ctxOf(b)).identityKey

  it('stale → enqueue → maintenance runner → current DB evidence → recanonicalize (UNCHANGED) → reuse WITHOUT a provider call; freshness restored', async () => {
    const { user, leagueId } = await seedManagerLeague()
    const orch = vi.fn(async () => okResult())
    const deps = baseDeps({ runOrchestration: orch, refreshScheduler: createDurableRefreshScheduler(db) }) // REAL default resolver + REAL durable scheduler

    const built = await buildLeagueIntelligenceEvidence({ db, leagueId, userId: user, tool: 'manager_intelligence', decisionType: 'trade' })
    expect(built.ok).toBe(true)
    const ctx = ctxOf(built)
    const identity = computeIntelligenceRequestIdentity(ctx)

    const first = await runManagedIntelligence(ctx, deps) // fresh miss → provider executes once
    expect(first.ok).toBe(true)
    expect(orch).toHaveBeenCalledTimes(1)

    await db.decisionIntelligenceRun.update({ where: { resultKey: identity.identityKey }, data: { expiresAt: new Date(Date.now() - 60_000) } })
    const staleServe = await runManagedIntelligence(ctx, deps) // serves stale + enqueues durable refresh
    expect(staleServe.freshness).toBe('stale')
    expect(await db.automationJob.count({ where: { idempotencyKey: `intel_refresh:${identity.identityKey}` } })).toBe(1)

    const out = await runIntelligenceMaintenance({ tickId: `t_${randomUUID().slice(0, 6)}`, deps, db })
    expect(out.status).toBe('completed')
    expect(orch).toHaveBeenCalledTimes(1) // UNCHANGED current evidence → reused WITHOUT a second provider call
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.expiresAt && run.expiresAt.getTime() > Date.now()).toBe(true) // freshness restored by the runner
  })

  it('material evidence change → refresh runs under a NEW canonical identity → provider executes → replacement result persisted', async () => {
    const { user, leagueId } = await seedManagerLeague()
    const orch = vi.fn(async () => okResult())
    const deps = baseDeps({ runOrchestration: orch, refreshScheduler: createDurableRefreshScheduler(db) })

    const built = await buildLeagueIntelligenceEvidence({ db, leagueId, userId: user, tool: 'manager_intelligence', decisionType: 'trade' })
    const ctx = ctxOf(built)
    const oldIdentity = computeIntelligenceRequestIdentity(ctx)
    await runManagedIntelligence(ctx, deps) // persist original
    expect(orch).toHaveBeenCalledTimes(1)

    // A REAL new trade lands (persisted).
    await db.intelligenceLeagueSnapshot.update({ where: { leagueId }, data: { tradeCount: { increment: 1 }, totalEvents: { increment: 1 }, lastActivityAt: new Date() } })

    // Refresh the OLD run: the resolver rebuilds from CURRENT DB → different identity → material-change branch.
    const res = await runIntelligenceRefreshJob({ userId: user, metadata: { identityKey: oldIdentity.identityKey } }, deps)
    expect(res.status).toBe('completed')
    expect((res.metadata as { materialChange?: boolean })?.materialChange).toBe(true)
    expect(orch).toHaveBeenCalledTimes(2) // provider executed for the changed evidence

    // Replacement result persisted under the NEW identity.
    const changedKey = keyOf(await buildLeagueIntelligenceEvidence({ db, leagueId, userId: user, tool: 'manager_intelligence', decisionType: 'trade' }))
    expect(changedKey).not.toBe(oldIdentity.identityKey)
    expect((await db.decisionIntelligenceRun.findUnique({ where: { resultKey: changedKey } }))?.status).toBe('succeeded')
  })

  it('unchanged evidence is identity-STABLE (reuse path); any real activity change is not', async () => {
    const { user, leagueId } = await seedManagerLeague()
    const run = { tool: 'manager_intelligence', decisionType: 'trade', leagueId, userId: user, connectedGroupId: null } as unknown as IntelligenceRunRecord
    const reh = new DbEvidenceRehydrator([new LeagueEvidenceResolver({ db })], db)
    const a = await reh.rehydrate({ run })
    const b = await reh.rehydrate({ run })
    expect(a.ok && b.ok).toBe(true)
    const idA = computeIntelligenceRequestIdentity((a as { ctx: IntelligenceRequestContext }).ctx).identityKey
    expect(computeIntelligenceRequestIdentity((b as { ctx: IntelligenceRequestContext }).ctx).identityKey).toBe(idA) // stable across reloads
    await db.intelligenceLeagueSnapshot.update({ where: { leagueId }, data: { waiverCount: { increment: 1 }, totalEvents: { increment: 1 }, lastActivityAt: new Date() } })
    const c = await reh.rehydrate({ run })
    expect(computeIntelligenceRequestIdentity((c as { ctx: IntelligenceRequestContext }).ctx).identityKey).not.toBe(idA) // changed
  })

  it('missing persisted evidence → resolver refuses honestly (evidence_unavailable)', async () => {
    const owner = await seedUser()
    const user = await seedUser()
    const leagueId = await seedLeague(owner) // NO IntelligenceLeagueSnapshot seeded
    const run = { tool: 'manager_intelligence', decisionType: 'trade', leagueId, userId: user } as unknown as IntelligenceRunRecord
    const r = await new DbEvidenceRehydrator([new LeagueEvidenceResolver({ db })], db).rehydrate({ run })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('evidence_unavailable')
  })

  it('a CONNECTED-group request is refresh-UNSUPPORTED: builder + resolver refuse, and a stale connected result neither enqueues nor bumps freshness', async () => {
    const { user, leagueId } = await seedManagerLeague()
    // The canonical builder refuses connected scope — it never passes ONE league's evidence off as connected-group evidence.
    const connectedBuild = await buildLeagueIntelligenceEvidence({ db, leagueId, userId: user, tool: 'manager_intelligence', decisionType: 'trade', connectedGroupId: 'grp-x' })
    expect(connectedBuild.ok).toBe(false)
    expect((connectedBuild as { reason: string }).reason).toBe('connected_group_refresh_unsupported')

    // supports() is scope-aware: unsupported WITH a group, supported for a single league; a connected run refuses at drain.
    const reh = new DbEvidenceRehydrator([new LeagueEvidenceResolver({ db })], db)
    expect(reh.supports('manager_intelligence', 'trade', 'grp-x')).toBe(false)
    expect(reh.supports('manager_intelligence', 'trade', null)).toBe(true)
    const connectedRun = { tool: 'manager_intelligence', decisionType: 'trade', leagueId, userId: user, connectedGroupId: 'grp-x' } as unknown as IntelligenceRunRecord
    const refused = await reh.rehydrate({ run: connectedRun })
    expect(refused.ok).toBe(false)
    // No resolver supports the connected scope → the drain refuses as unsupported (never bumps freshness).
    expect((refused as { reason: string }).reason).toBe('refresh_unsupported_tool')

    // Durable path: a stale connected-scope result serves stale but enqueues NOTHING and its freshness is NOT bumped.
    const deps = baseDeps({ runOrchestration: async () => okResult(), refreshScheduler: createDurableRefreshScheduler(db) })
    const solo = await buildLeagueIntelligenceEvidence({ db, leagueId, userId: user, tool: 'manager_intelligence', decisionType: 'trade' })
    const ctx = { ...ctxOf(solo), connectedGroupId: 'grp-x' } as IntelligenceRequestContext
    const identity = computeIntelligenceRequestIdentity(ctx)
    await runManagedIntelligence(ctx, deps) // persist under the connected-scoped identity
    const staleExpiry = new Date(Date.now() - 60_000)
    await db.decisionIntelligenceRun.update({ where: { resultKey: identity.identityKey }, data: { expiresAt: staleExpiry } })
    const staleServe = await runManagedIntelligence(ctx, deps)
    expect(staleServe.freshness).toBe('stale')
    expect(staleServe.refreshInProgress).toBe(false) // honest — no refresh armed for connected scope
    expect(await db.automationJob.count({ where: { idempotencyKey: `intel_refresh:${identity.identityKey}` } })).toBe(0) // NO enqueue
    expect((await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } }))?.expiresAt?.getTime()).toBe(staleExpiry.getTime()) // freshness NOT bumped
  })

  it('live-sensitive decision cannot refresh from persisted (non-live) evidence → refused', async () => {
    const { user, leagueId } = await seedManagerLeague()
    const run = { tool: 'manager_intelligence', decisionType: 'injury', leagueId, userId: user } as unknown as IntelligenceRunRecord
    const r = await new DbEvidenceRehydrator([new LeagueEvidenceResolver({ db })], db).rehydrate({ run })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('live_evidence_stale_or_unavailable')
  })

  it('an UNSUPPORTED tool stays unsupported under the real resolver (no enqueue path)', async () => {
    const reh = new DbEvidenceRehydrator([new LeagueEvidenceResolver({ db })], db)
    expect(reh.supports('manager_intelligence', 'trade')).toBe(true) // the one supported tool
    expect(reh.supports('commissioner_command_center', 'commissioner')).toBe(false) // explicitly not yet supported
    expect(reh.supports('user_os', 'static')).toBe(false)
    expect(reh.supports('mission_control', 'matchup')).toBe(false)
  })
})

// ── Blocker 2: lease heartbeat + fencing keeps a long run safe after lease expiry ────────────────────────
suite('Blocker 2 — lease heartbeat / fencing (renewAutomationLock)', () => {
  async function seedStranded(amount = 5) {
    const user = await seedUser()
    const k = `${NS}_fence_${randomUUID()}`
    await db.decisionIntelligenceRun.create({ data: { resultKey: k, inputHash: 'h', tool: 'manager_intelligence', decisionType: 'trade_review', userId: user, status: 'succeeded', versionTag: 'v', resultJson: okResult() as never, attemptCount: 1, maxAttempts: 3 } })
    const bal = await db.userTokenBalance.upsert({ where: { userId: user }, update: { balance: 100, reservedBalance: amount }, create: { userId: user, balance: 100, reservedBalance: amount }, select: { id: true } })
    await db.tokenReservation.create({ data: { userId: user, userTokenBalanceId: bal.id, amount, status: 'reserved', idempotencyKey: k, reservedAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() - 60_000) } })
    return { user, k }
  }

  it('heartbeat: an owner renews and EXTENDS its lease (a run lasting longer than the original TTL stays alive); a former owner cannot renew or release a successor lease', async () => {
    const key = `${NS}_ren_${randomUUID().slice(0, 6)}`
    const A = 'tick:A', B = 'tick:B'
    expect((await acquireAutomationLock(key, { owner: A, ttlMs: 1_000 }, db)).ok).toBe(true) // short original TTL
    const row1 = await db.automationLock.findUnique({ where: { lockKey: key } })
    // Heartbeat renew → expiry pushed well beyond the original 1s TTL, so a long run does NOT expire mid-flight.
    expect((await renewAutomationLock(key, { owner: A, ttlMs: 5 * 60_000 }, db)).ok).toBe(true)
    const row2 = await db.automationLock.findUnique({ where: { lockKey: key } })
    expect(row2!.expiresAt.getTime()).toBeGreaterThan(row1!.expiresAt.getTime())

    // Simulate A losing the lease: force-expire it and let successor B acquire.
    await db.automationLock.update({ where: { lockKey: key }, data: { expiresAt: new Date(Date.now() - 1_000) } })
    expect((await acquireAutomationLock(key, { owner: B, ttlMs: 60_000 }, db)).ok).toBe(true)
    // Former owner A can NEITHER renew NOR release B's lease (owner is the fencing token).
    expect((await renewAutomationLock(key, { owner: A, ttlMs: 60_000 }, db)).ok).toBe(false)
    await releaseAutomationLock(key, A, db)
    expect((await db.automationLock.findUnique({ where: { lockKey: key } }))?.owner).toBe(B) // still B's
    // An expired lease with no successor also cannot be renewed by its old owner (must re-acquire, never assume).
    await db.automationLock.update({ where: { lockKey: key }, data: { owner: 'tick:C', expiresAt: new Date(Date.now() - 1_000) } })
    expect((await renewAutomationLock(key, { owner: 'tick:C', ttlMs: 60_000 }, db)).ok).toBe(false)
    await releaseAutomationLock(key, 'tick:C', db)
  })

  it('a fenced-out stale owner settles NOTHING; a successor recovers and settles the reservation EXACTLY once', async () => {
    const { user, k } = await seedStranded()
    // The stale owner A runs its fn (pass-through lease, as if it had acquired earlier), but the REAL fence
    // (owner tick:A) fails because successor B already holds the global maintenance lease.
    expect((await acquireAutomationLock(INTELLIGENCE_MAINTENANCE_LOCK_KEY, { owner: 'tick:B', ttlMs: 60_000 }, db)).ok).toBe(true)
    const passThrough = async <T>(_o: string, _t: number, fn: () => Promise<T>) => ({ ok: true as const, value: await fn() })
    const outA = await runIntelligenceMaintenance({ tickId: 'A', deps: baseDeps(), db, config: { lease: passThrough } })
    expect(outA.status).toBe('completed') // its fn ran…
    expect(outA.results.reservation_reconcile?.fenced).toBeGreaterThanOrEqual(1) // …but the fence stopped settlement
    expect((await db.tokenReservation.findUnique({ where: { idempotencyKey: k } }))?.status).toBe('reserved') // A settled NOTHING

    // Successor path: release B, then a real tick reclaims and settles the hold exactly once.
    await releaseAutomationLock(INTELLIGENCE_MAINTENANCE_LOCK_KEY, 'tick:B', db)
    const outB = await runIntelligenceMaintenance({ tickId: `Bp_${randomUUID().slice(0, 6)}`, deps: baseDeps(), db })
    expect(outB.status).toBe('completed')
    expect((await db.tokenReservation.findUnique({ where: { idempotencyKey: k } }))?.status).toBe('finalized')
    expect((await db.userTokenBalance.findUnique({ where: { userId: user } }))?.balance).toBe(95) // debited once
    const ledger = await db.tokenLedger.count({ where: { userId: user, entryType: 'spend' } })
    expect(ledger).toBe(1) // EXACTLY once across the fenced-out owner + the successor
  })

  it('an injected fence=false stops the sweep before any settlement (fail-safe)', async () => {
    const { k } = await seedStranded()
    // Even holding a (real) lease, if the fence reports loss the sweep must persist nothing.
    const out = await runIntelligenceMaintenance({ tickId: `F_${randomUUID().slice(0, 6)}`, deps: baseDeps(), db, config: { fence: async () => false } })
    expect(out.status).toBe('completed')
    expect((await db.tokenReservation.findUnique({ where: { idempotencyKey: k } }))?.status).toBe('reserved') // untouched
  })
})

// ── Correction 2: lease heartbeat + deadline + AbortSignal keep a long provider call safe ─────────────────
suite('Correction 2 — lease-safe long provider execution', () => {
  function deferred<T = void>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  async function pollUntil<T>(read: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 4000): Promise<T> {
    const start = Date.now()
    for (;;) {
      const v = await read()
      if (pred(v)) return v
      if (Date.now() - start > timeoutMs) throw new Error('pollUntil timed out')
      await sleep(15)
    }
  }
  const changedKeyFor = async (leagueId: string, user: string) =>
    computeIntelligenceRequestIdentity(((await buildLeagueIntelligenceEvidence({ db, leagueId, userId: user, tool: 'manager_intelligence', decisionType: 'trade' })) as { ctx: IntelligenceRequestContext }).ctx).identityKey

  // Seed a manager league whose evidence has MATERIALLY CHANGED, plus a pending refresh job for the old identity,
  // so a drain will run the provider under the NEW identity.
  async function seedMaterialChangeJob() {
    // The drain processes EVERY pending refresh job; clear leftovers so this test's provider-call count is exact.
    await db.automationJob.deleteMany({ where: { jobType: 'decision_os.intelligence_refresh' } })
    const owner = await seedUser()
    const user = await seedUser()
    const leagueId = await seedLeague(owner)
    await seedRosterMember(leagueId, user)
    await seedSupremeSubscription(user)
    await db.intelligenceLeagueSnapshot.create({ data: { leagueId, totalEvents: 5, tradeCount: 2, waiverCount: 1, lineupCount: 1, draftCount: 0, scoringCount: 0, governanceCount: 0, openTradeProposals: 1, lastActivityAt: new Date('2026-07-27T00:00:00Z') } })
    const built = await buildLeagueIntelligenceEvidence({ db, leagueId, userId: user, tool: 'manager_intelligence', decisionType: 'trade' })
    const ctx = (built as { ctx: IntelligenceRequestContext }).ctx
    const oldIdentity = computeIntelligenceRequestIdentity(ctx)
    await runManagedIntelligence(ctx, baseDeps({ runOrchestration: async () => okResult() })) // persist original
    await db.intelligenceLeagueSnapshot.update({ where: { leagueId }, data: { tradeCount: { increment: 1 }, totalEvents: { increment: 1 }, lastActivityAt: new Date() } }) // material change
    await db.automationJob.create({ data: { idempotencyKey: `intel_refresh:${oldIdentity.identityKey}`, jobType: 'decision_os.intelligence_refresh', status: 'pending', userId: user, metadata: { identityKey: oldIdentity.identityKey }, maxAttempts: 3 } })
    return { user, leagueId, oldIdentity }
  }

  it('ABORT propagation: aborting the signal DURING a provider call stops execution and persists nothing', async () => {
    const { user, leagueId } = await seedMaterialChangeJob()
    const controller = new AbortController()
    const barrier = deferred()
    let calls = 0
    // Mirror the real orchestration: it RETURNS on abort (its provider calls are cancelled + settle), so the
    // fake settles when EITHER the barrier resolves OR the signal aborts — executeAsOwner then sees signal.aborted.
    const deps = baseDeps({
      runOrchestration: async (_p: DecisionOSEvidencePacket, opts?: { signal?: AbortSignal }) => {
        calls++
        await new Promise<void>((resolve) => {
          if (opts?.signal?.aborted) return resolve()
          opts?.signal?.addEventListener('abort', () => resolve(), { once: true })
          barrier.promise.then(() => resolve())
        })
        return okResult()
      },
    })
    const changed = (await buildLeagueIntelligenceEvidence({ db, leagueId, userId: user, tool: 'manager_intelligence', decisionType: 'trade' })) as { ctx: IntelligenceRequestContext }
    const p = runIntelligenceRefresh(changed.ctx, deps, { signal: controller.signal })
    await pollUntil(async () => calls, (c) => c >= 1) // now inside the provider call
    controller.abort() // lease lost mid-call
    const r = await p
    expect(r.refreshed).toBe(false) // aborted → not a successful refresh
    const key = computeIntelligenceRequestIdentity(changed.ctx).identityKey
    expect((await db.decisionIntelligenceRun.findUnique({ where: { resultKey: key } }))?.status).not.toBe('succeeded') // NOT persisted
    barrier.resolve() // cleanup — the discarded result is never used (no unhandled promise)
  })

  it('a pre-aborted signal short-circuits the refresh job — no provider call, no persist', async () => {
    const { user, oldIdentity } = await seedMaterialChangeJob()
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const deps = baseDeps({ runOrchestration: async () => { calls++; return okResult() } })
    const res = await runIntelligenceRefreshJob({ userId: user, metadata: { identityKey: oldIdentity.identityKey } }, deps, { signal: controller.signal })
    expect(res.status).toBe('failed')
    expect(res.message).toBe('refresh_aborted_lease_lost')
    expect(calls).toBe(0) // provider never called
  })

  it('HEARTBEAT keeps the lease alive across a sweep whose provider call outlives the ORIGINAL lease (renewed)', async () => {
    const { user, leagueId } = await seedMaterialChangeJob()
    const barrier = deferred()
    let calls = 0
    const deps = baseDeps({ runOrchestration: async () => { calls++; await barrier.promise; return okResult() } })
    const runP = runIntelligenceMaintenance({ tickId: `hb_${randomUUID().slice(0, 6)}`, deps, db, config: { leaseMs: 400, heartbeatMs: 60, deadlineMs: 360, refreshBatch: 5 } })
    const held = await pollUntil(async () => db.automationLock.findUnique({ where: { lockKey: INTELLIGENCE_MAINTENANCE_LOCK_KEY } }), (r) => !!r && r.owner.startsWith('tick:hb_') && calls >= 1)
    const originalExpiry = held!.expiresAt.getTime()
    // The heartbeat renews the lease beyond its ORIGINAL expiry while the provider call is still blocked — the
    // call legitimately outlives the original lease because BOTH lease and (renewable) deadline were renewed.
    await pollUntil(async () => db.automationLock.findUnique({ where: { lockKey: INTELLIGENCE_MAINTENANCE_LOCK_KEY } }), (r) => !!r && r.expiresAt.getTime() > originalExpiry)
    barrier.resolve()
    const out = await runP
    expect(out.status).toBe('completed')
    expect(calls).toBe(1)
    expect((await db.decisionIntelligenceRun.findUnique({ where: { resultKey: await changedKeyFor(leagueId, user) } }))?.status).toBe('succeeded')
  })

  it('RENEWABLE DEADLINE contract: every heartbeat advances the deadline AND keeps it strictly before the renewed lease expiry', async () => {
    const { user, leagueId } = await seedMaterialChangeJob()
    const barrier = deferred()
    const deps = baseDeps({ runOrchestration: async () => { await barrier.promise; return okResult() } })
    const beats: Array<{ at: number; renewedLeaseExpiryAt: number; deadlineAt: number }> = []
    const runP = runIntelligenceMaintenance({
      tickId: `rd_${randomUUID().slice(0, 6)}`, deps, db,
      config: { leaseMs: 1_000, heartbeatMs: 80, deadlineMs: 700, refreshBatch: 5, onHeartbeat: (e) => beats.push(e) },
    })
    await pollUntil(async () => beats.length, (n) => n >= 3) // let several renewals happen while the provider blocks
    barrier.resolve()
    await runP
    expect(beats.length).toBeGreaterThanOrEqual(3)
    // Direct timestamp assertions: the active deadline is ALWAYS strictly before the renewed lease expiry…
    for (const b of beats) expect(b.deadlineAt).toBeLessThan(b.renewedLeaseExpiryAt)
    // …and each successful renewal ADVANCES both the lease expiry and the deadline (monotonic).
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].renewedLeaseExpiryAt).toBeGreaterThan(beats[i - 1].renewedLeaseExpiryAt)
      expect(beats[i].deadlineAt).toBeGreaterThan(beats[i - 1].deadlineAt)
    }
  })

  it('GRACEFUL LEASE LOSS during the provider call → owner A cancels + confirm-settles → run failed-RETRYABLE (marker cleared), A cannot remove B lease; a successor safely completes EXACTLY once', async () => {
    const { user, leagueId, oldIdentity } = await seedMaterialChangeJob()
    const changedKey = await changedKeyFor(leagueId, user)
    const barrierA = deferred()
    let aCalls = 0
    // Fake mirrors the real orchestration: RETURNS on abort (cancelled providers settle), so executeAsOwner's
    // await completes and it then sees signal.aborted → holds the claim.
    const depsA = baseDeps({
      runOrchestration: async (_p: DecisionOSEvidencePacket, opts?: { signal?: AbortSignal }) => {
        aCalls++
        await new Promise<void>((resolve) => {
          if (opts?.signal?.aborted) return resolve()
          opts?.signal?.addEventListener('abort', () => resolve(), { once: true })
          barrierA.promise.then(() => resolve())
        })
        return okResult()
      },
    })
    const runA = runIntelligenceMaintenance({ tickId: 'A', deps: depsA, db, config: { leaseMs: 500, heartbeatMs: 40, deadlineMs: 450, refreshBatch: 5 } })
    await pollUntil(async () => aCalls, (c) => c >= 1)
    // Successor B forcibly takes the global lease (A's row replaced) → A's heartbeat renew fails → A aborts.
    await db.automationLock.update({ where: { lockKey: INTELLIGENCE_MAINTENANCE_LOCK_KEY }, data: { owner: 'tick:B', expiresAt: new Date(Date.now() + 60_000) } })
    // A is ALIVE and aborts gracefully: it AWAITED the orchestration (requests confirmed cancelled + settled), so
    // this is a CONFIRMED CANCELLATION → the run becomes failed-RETRYABLE with the provider-exec marker CLEARED
    // (not UNKNOWN, not a held claim). A safe retry may proceed.
    await runA
    const afterA = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: changedKey } })
    expect(afterA?.status).toBe('failed')
    expect(afterA?.retryable).toBe(true)
    expect(afterA?.providerExecStartedAt ?? null).toBeNull()          // marker cleared → confirmed cancellation
    expect((await db.decisionIntelligenceRun.count({ where: { resultKey: changedKey, status: 'succeeded' } }))).toBe(0) // A persisted nothing
    expect((await db.automationLock.findUnique({ where: { lockKey: INTELLIGENCE_MAINTENANCE_LOCK_KEY } }))?.owner).toBe('tick:B') // A did not remove B's lease
    barrierA.resolve() // A's provider returned (already cancelled) — discarded

    // A successor safely retries the confirmed-cancelled execution EXACTLY once.
    await releaseAutomationLock(INTELLIGENCE_MAINTENANCE_LOCK_KEY, 'tick:B', db)
    await db.automationJob.updateMany({ where: { idempotencyKey: `intel_refresh:${oldIdentity.identityKey}` }, data: { status: 'pending', startedAt: null, finishedAt: null } })
    let bCalls = 0
    const depsB = baseDeps({ runOrchestration: async () => { bCalls++; return okResult() } })
    await runIntelligenceMaintenance({ tickId: `Bp_${randomUUID().slice(0, 6)}`, deps: depsB, db, config: { leaseMs: 60_000, refreshBatch: 5 } })
    expect(bCalls).toBe(1)
    expect((await db.decisionIntelligenceRun.count({ where: { resultKey: changedKey, status: 'succeeded' } }))).toBe(1) // exactly one result
  })

  it('the refresh-job claim is leased: a RECENT running job is not re-executed; only a STALE one is recovered', async () => {
    const { user, oldIdentity } = await seedMaterialChangeJob()
    // Mark the job as freshly running (a live owner is executing it).
    await db.automationJob.updateMany({ where: { idempotencyKey: `intel_refresh:${oldIdentity.identityKey}` }, data: { status: 'running', startedAt: new Date() } })
    let calls = 0
    const deps = baseDeps({ runOrchestration: async () => { calls++; return okResult() } })
    const drainedRecent = await drainIntelligenceRefreshJobs(deps, { db, staleRunningMs: 5 * 60_000 })
    expect(drainedRecent.processed).toBe(0) // a recent running job is claimed → NOT re-executed by a successor
    expect(calls).toBe(0)
    // Age it past the stale threshold → recoverable.
    await db.automationJob.updateMany({ where: { idempotencyKey: `intel_refresh:${oldIdentity.identityKey}` }, data: { startedAt: new Date(Date.now() - 30 * 60_000) } })
    const drainedStale = await drainIntelligenceRefreshJobs(deps, { db, staleRunningMs: 5 * 60_000 })
    expect(drainedStale.processed).toBeGreaterThanOrEqual(1) // abandoned job recovered
  })
})

// ── Provider cancellation: prove lease-loss / deadline actually TERMINATES the external provider request ───
suite('Provider cancellation (real AbortSignal reaches the network client)', () => {
  function deferred2<T = void>() {
    let resolve!: (v: T) => void; let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
  const sleep2 = (ms: number) => new Promise((r) => setTimeout(r, ms))
  async function poll2<T>(read: () => Promise<T> | T, pred: (v: T) => boolean, timeoutMs = 4000): Promise<T> {
    const start = Date.now()
    for (;;) { const v = await read(); if (pred(v)) return v; if (Date.now() - start > timeoutMs) throw new Error('poll2 timeout'); await sleep2(15) }
  }

  /** A fake provider client that behaves like a real network client: records request start, stays in flight,
   *  listens to the AbortSignal, records abort RECEIPT, and rejects only after cancellation is processed.
   *  `honorsSignal:false` models an adapter that IGNORES cancellation (keeps running until its own resolution). */
  function abortAwareProvider(opts: { barrier: { promise: Promise<void> }; honorsSignal?: boolean }) {
    const stats = { started: 0, aborted: 0, completed: 0, inFlight: 0, maxConcurrent: 0 }
    const honors = opts.honorsSignal !== false
    const client: ThreeBrainProviderClient = {
      isAvailable: () => true,
      chat: async (_request, chatOpts) => {
        stats.started += 1; stats.inFlight += 1; stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.inFlight)
        try {
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => { stats.aborted += 1; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) }
            if (honors && chatOpts?.signal) {
              if (chatOpts.signal.aborted) return onAbort()
              chatOpts.signal.addEventListener('abort', onAbort, { once: true })
            }
            opts.barrier.promise.then(
              () => { if (honors) chatOpts?.signal?.removeEventListener('abort', onAbort); resolve() },
              () => {},
            )
          })
          stats.completed += 1
          return { text: '', model: 'fake', provider: 'openai' as never, status: 'failed' as const }
        } finally { stats.inFlight -= 1 }
      },
    }
    return { getProvider: (() => client) as ThreeBrainProviderGetter, stats }
  }
  const packet = () => packetFor(`u_${randomUUID().slice(0, 6)}`, `lg_${randomUUID().slice(0, 6)}`, { decisionType: 'trade' })

  it('A — the external signal reaches the provider network client and CANCELS the in-flight request', async () => {
    const barrier = deferred2()
    const { getProvider, stats } = abortAwareProvider({ barrier })
    const controller = new AbortController()
    const p = runThreeBrainAnalysis(packet(), { getProvider, signal: controller.signal, perProviderTimeoutMs: 60_000 })
    await poll2(() => stats.started, (n) => n >= 1) // provider request(s) in flight
    controller.abort() // lease-loss / deadline
    await p
    expect(stats.aborted).toBeGreaterThanOrEqual(1) // the provider RECEIVED + processed the cancellation
    expect(stats.completed).toBe(0)                  // the request did not complete
    expect(stats.maxConcurrent).toBeLessThanOrEqual(2) // only the two parallel specialists of ONE execution
    barrier.resolve()
  })

  it('B — the per-provider timeout terminates a hung request (no external signal needed)', async () => {
    const barrier = deferred2() // never resolved → a hung provider
    const { getProvider, stats } = abortAwareProvider({ barrier })
    await runThreeBrainAnalysis(packet(), { getProvider, perProviderTimeoutMs: 80 }) // short per-provider deadline
    expect(stats.aborted).toBeGreaterThanOrEqual(1) // the per-provider timeout cancelled the request
    expect(stats.completed).toBe(0)
    barrier.resolve()
  })

  it('C — the PRODUCTION default runOrchestration (realAdapters) forwards the signal to the provider', async () => {
    // No runOrchestration override → the real default calls runThreeBrainAnalysis with the forwarded signal.
    const barrier = deferred2()
    const { getProvider, stats } = abortAwareProvider({ barrier })
    const owner = await seedUser(); const usr = await seedUser()
    const leagueId = await seedLeague(owner); await seedRosterMember(leagueId, usr); await seedSupremeSubscription(usr)
    await db.intelligenceLeagueSnapshot.create({ data: { leagueId, totalEvents: 3, tradeCount: 1, waiverCount: 0, lineupCount: 0, draftCount: 0, scoringCount: 0, governanceCount: 0, openTradeProposals: 0, lastActivityAt: new Date() } })
    const ctx = ((await buildLeagueIntelligenceEvidence({ db, leagueId, userId: usr, tool: 'manager_intelligence', decisionType: 'trade' })) as { ctx: IntelligenceRequestContext }).ctx
    // Use the REAL default runOrchestration (NOT baseDeps, which forces okResult) so the production forwarding path
    // (createManagedIntelligenceDeps → runThreeBrainAnalysis) is exercised end to end.
    const deps = createManagedIntelligenceDeps({ prisma: db, tokenGuard: new ReservationTokenGuard(db, async () => 7), refreshScheduler: { async enqueue() { return { refreshInProgress: false } } }, orchestrationOptions: { getProvider, perProviderTimeoutMs: 60_000 } })
    const controller = new AbortController()
    const p = runIntelligenceRefresh(ctx, deps, { signal: controller.signal })
    await poll2(() => stats.started, (n) => n >= 1)
    controller.abort()
    await p
    expect(stats.aborted).toBeGreaterThanOrEqual(1) // production path forwarded the signal → provider cancelled
    barrier.resolve()
  })

  it('D — lease loss: A cancels its provider, HOLDS its claim; a successor issues NO overlapping request; exactly one execution completes', async () => {
    // Seed a material-change refresh job (real path).
    await db.automationJob.deleteMany({ where: { jobType: 'decision_os.intelligence_refresh' } })
    const owner = await seedUser(); const usr = await seedUser()
    const leagueId = await seedLeague(owner); await seedRosterMember(leagueId, usr); await seedSupremeSubscription(usr)
    await db.intelligenceLeagueSnapshot.create({ data: { leagueId, totalEvents: 5, tradeCount: 2, waiverCount: 1, lineupCount: 1, draftCount: 0, scoringCount: 0, governanceCount: 0, openTradeProposals: 1, lastActivityAt: new Date('2026-07-27T00:00:00Z') } })
    const built = await buildLeagueIntelligenceEvidence({ db, leagueId, userId: usr, tool: 'manager_intelligence', decisionType: 'trade' })
    const ctx = (built as { ctx: IntelligenceRequestContext }).ctx
    const oldIdentity = computeIntelligenceRequestIdentity(ctx)
    await runManagedIntelligence(ctx, baseDeps({ runOrchestration: async () => okResult() }))
    await db.intelligenceLeagueSnapshot.update({ where: { leagueId }, data: { tradeCount: { increment: 1 }, totalEvents: { increment: 1 }, lastActivityAt: new Date() } })
    await db.automationJob.create({ data: { idempotencyKey: `intel_refresh:${oldIdentity.identityKey}`, jobType: 'decision_os.intelligence_refresh', status: 'pending', userId: usr, metadata: { identityKey: oldIdentity.identityKey }, maxAttempts: 3 } })
    const changedKey = computeIntelligenceRequestIdentity(((await buildLeagueIntelligenceEvidence({ db, leagueId, userId: usr, tool: 'manager_intelligence', decisionType: 'trade' })) as { ctx: IntelligenceRequestContext }).ctx).identityKey

    // Execution-level concurrency counter that ALSO exercises real provider cancellation (forwards the signal).
    const barrier = deferred2()
    const { getProvider, stats } = abortAwareProvider({ barrier })
    let execInFlight = 0, execMax = 0, execStarted = 0
    const runOrchestration = async (p: DecisionOSEvidencePacket, callOpts?: { signal?: AbortSignal }) => {
      execStarted += 1; execInFlight += 1; execMax = Math.max(execMax, execInFlight)
      try { return await runThreeBrainAnalysis(p, { getProvider, perProviderTimeoutMs: 60_000, signal: callOpts?.signal }) }
      finally { execInFlight -= 1 }
    }
    const depsA = baseDeps({ runOrchestration })
    const runA = runIntelligenceMaintenance({ tickId: 'A', deps: depsA, db, config: { leaseMs: 600, heartbeatMs: 40, deadlineMs: 540, refreshBatch: 5 } })
    await poll2(() => stats.started, (n) => n >= 1) // A's provider request(s) in flight

    await db.automationLock.update({ where: { lockKey: INTELLIGENCE_MAINTENANCE_LOCK_KEY }, data: { owner: 'tick:B', expiresAt: new Date(Date.now() + 60_000) } }) // B takes the maintenance lease
    await runA
    expect(stats.aborted).toBeGreaterThanOrEqual(1)  // A's in-flight provider request was CANCELLED
    expect(execMax).toBe(1)                            // never more than ONE execution in flight
    const afterA = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: changedKey } })
    expect(afterA?.status).toBe('failed')              // confirmed cancellation (awaited settlement) → retryable
    expect(afterA?.retryable).toBe(true)
    expect(afterA?.providerExecStartedAt ?? null).toBeNull() // marker cleared → not UNKNOWN
    barrier.resolve()

    // A successor safely retries the confirmed-cancelled execution EXACTLY once; executions never overlap.
    await releaseAutomationLock(INTELLIGENCE_MAINTENANCE_LOCK_KEY, 'tick:B', db)
    await db.automationJob.updateMany({ where: { idempotencyKey: `intel_refresh:${oldIdentity.identityKey}` }, data: { status: 'pending', startedAt: null, finishedAt: null } })
    const okBarrier = deferred2(); okBarrier.resolve() // successor's provider completes immediately
    const okProvider = abortAwareProvider({ barrier: okBarrier })
    const runOrchestration2 = (p: DecisionOSEvidencePacket, callOpts?: { signal?: AbortSignal }) => {
      execInFlight += 1; execMax = Math.max(execMax, execInFlight)
      return runThreeBrainAnalysis(p, { getProvider: okProvider.getProvider, perProviderTimeoutMs: 60_000, signal: callOpts?.signal }).finally(() => { execInFlight -= 1 })
    }
    await runIntelligenceMaintenance({ tickId: `Bok_${randomUUID().slice(0, 6)}`, deps: baseDeps({ runOrchestration: runOrchestration2 }), db, config: { leaseMs: 60_000, refreshBatch: 5 } })
    const finalRun = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: changedKey } })
    expect(finalRun?.status === 'succeeded' || finalRun?.status === 'failed').toBe(true) // resolved exactly once by the successor
    expect(execMax).toBe(1) // across the whole lifecycle, executions NEVER overlapped
  })

  it('E — HARD CRASH mid-request → UNKNOWN blocks automatic re-execution: a successor starts ZERO provider requests, no new freshness, and the late remote result cannot persist', async () => {
    await db.automationJob.deleteMany({ where: { jobType: 'decision_os.intelligence_refresh' } })
    const owner = await seedUser(); const usr = await seedUser()
    const leagueId = await seedLeague(owner); await seedRosterMember(leagueId, usr); await seedSupremeSubscription(usr)
    await db.intelligenceLeagueSnapshot.create({ data: { leagueId, totalEvents: 4, tradeCount: 2, waiverCount: 1, lineupCount: 0, draftCount: 0, scoringCount: 0, governanceCount: 0, openTradeProposals: 0, lastActivityAt: new Date() } })
    const built = await buildLeagueIntelligenceEvidence({ db, leagueId, userId: usr, tool: 'manager_intelligence', decisionType: 'trade' })
    const ctx = (built as { ctx: IntelligenceRequestContext }).ctx
    const identity = computeIntelligenceRequestIdentity(ctx)
    const key = identity.identityKey

    // Simulate owner A: claimed + STARTED a provider request (marker set), then the PROCESS DISAPPEARED without
    // any graceful abort cleanup — run stuck 'running', lease expired, provider-exec marker NEVER cleared, and A's
    // external (non-cancellable) request deliberately remains unresolved.
    await db.decisionIntelligenceRun.create({ data: {
      resultKey: key, inputHash: 'h', tool: 'manager_intelligence', decisionType: 'trade', userId: usr,
      status: 'running', versionTag: identity.versionTag, ownerToken: 'crashedA',
      leaseExpiresAt: new Date(Date.now() - 60_000), providerExecStartedAt: new Date(Date.now() - 120_000),
      attemptCount: 1, maxAttempts: 3, updatedAt: new Date(),
    } })
    const stillInFlight = deferred2() // A's remote request — never released until the end

    // Owner B runs stale-work recovery for the same canonical execution (a counting, cancellable provider).
    let execStarted = 0
    const provider = abortAwareProvider({ barrier: stillInFlight })
    const runOrchestration = (p: DecisionOSEvidencePacket, callOpts?: { signal?: AbortSignal }) => { execStarted += 1; return runThreeBrainAnalysis(p, { getProvider: provider.getProvider, perProviderTimeoutMs: 800, cancelGraceMs: 200, signal: callOpts?.signal }) }
    const r = await runIntelligenceRefresh(ctx, baseDeps({ runOrchestration }))

    expect(r.refreshed).toBe(false)                    // B did NOT execute
    expect(execStarted).toBe(0)                        // B issued ZERO provider requests
    expect(provider.stats.started).toBe(0)             // maximum overlapping executions = 1 (only crashed A's)
    const afterB = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: key } })
    expect(afterB?.status).toBe('unknown')             // recovery recorded UNKNOWN (finite claim expiry did NOT permit re-exec)
    expect(afterB?.failureCategory).toBe('provider_outcome_unknown')
    expect(afterB?.expiresAt ?? null).toBeNull()       // NO new freshness timestamp
    expect(afterB?.retryable).toBe(false)

    // A's late remote result arrives AFTER B's recovery → it cannot persist / resurrect UNKNOWN (status-gated complete).
    stillInFlight.resolve()
    const store = new PrismaIntelligenceResultStore(db)
    await store.complete({ identityKey: key, userId: usr, ownerToken: 'crashedA', result: okResult(), requestSnapshot: {}, providerParticipation: {}, entitlementMode: 'subscription', tokenLedgerId: null, tokenReservationKey: null, expiresAt: new Date(Date.now() + 60_000), now: new Date() })
    const afterLate = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: key } })
    expect(afterLate?.status).toBe('unknown')          // late result did NOT change UNKNOWN
    expect((await db.decisionIntelligenceRun.count({ where: { resultKey: key, status: 'succeeded' } }))).toBe(0) // no duplicate settlement
  })

  // ── Cancellation-grace settlement classification: a bounded wait returning is NOT proof of cancellation ──────
  // Only a CONFIRMED_CANCELLED settlement (the provider promise rejected with a recognized cancellation) is safe
  // to auto-retry. A completed, hung-past-grace, or ambiguously-rejected request is UNKNOWN and blocks re-execution.
  const okChat = () => ({ text: 'ok', model: 'fake', provider: 'openai' as never, status: 'ok' as const })
  /** A provider whose settlement is deterministically controlled:
   *   cancel    → on abort, REJECT with a recognized cancellation (name:'AbortError') → 'cancelled'
   *   ambiguous → on abort, REJECT with a non-cancellation transport error           → 'indeterminate'
   *   complete  → on abort, RESOLVE successfully (a response was produced)            → 'completed'
   *   hang      → IGNORE the abort and never settle (barrier unresolved)              → grace-expiry 'indeterminate' */
  function settlementProvider(mode: 'cancel' | 'ambiguous' | 'complete' | 'hang', barrier: { promise: Promise<void> }) {
    const stats = { started: 0, aborted: 0, completed: 0 }
    const client: ThreeBrainProviderClient = {
      isAvailable: () => true,
      chat: (_req, chatOpts) => {
        stats.started += 1
        return new Promise((resolve, reject) => {
          let done = false
          const once = (fn: () => void) => { if (done) return; done = true; fn() }
          const sig = chatOpts?.signal
          const onAbort = () => {
            if (mode === 'cancel') once(() => { stats.aborted += 1; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
            else if (mode === 'ambiguous') once(() => { stats.aborted += 1; reject(Object.assign(new Error('socket hang up'), { name: 'Error' })) })
            else if (mode === 'complete') once(() => { stats.completed += 1; resolve(okChat()) })
            // 'hang' → do nothing; the request stays in flight past the grace
          }
          if (mode !== 'hang' && sig) {
            if (sig.aborted) return onAbort()
            sig.addEventListener('abort', onAbort, { once: true })
          }
          barrier.promise.then(() => once(() => { stats.completed += 1; resolve(okChat()) }), () => {})
        })
      },
    }
    return { getProvider: (() => client) as ThreeBrainProviderGetter, stats }
  }
  async function seedManagerCtx(decisionType = 'trade') {
    const owner = await seedUser(); const usr = await seedUser()
    const leagueId = await seedLeague(owner); await seedRosterMember(leagueId, usr); await seedSupremeSubscription(usr)
    await db.intelligenceLeagueSnapshot.create({ data: { leagueId, totalEvents: 4, tradeCount: 2, waiverCount: 1, lineupCount: 0, draftCount: 0, scoringCount: 0, governanceCount: 0, openTradeProposals: 0, lastActivityAt: new Date() } })
    const ctx = ((await buildLeagueIntelligenceEvidence({ db, leagueId, userId: usr, tool: 'manager_intelligence', decisionType })) as { ctx: IntelligenceRequestContext }).ctx
    return { usr, leagueId, ctx, identity: computeIntelligenceRequestIdentity(ctx) }
  }
  // REAL default deps (createManagedIntelligenceDeps) so the production signal + settlement-callback forwarding is
  // exercised end to end; the provider is the only injected fake.
  const realDeps = (getProvider: ThreeBrainProviderGetter, over: { cancelGraceMs?: number; perProviderTimeoutMs?: number } = {}) =>
    createManagedIntelligenceDeps({
      prisma: db,
      tokenGuard: new ReservationTokenGuard(db, async () => 7),
      refreshScheduler: { async enqueue() { return { refreshInProgress: false } } },
      orchestrationOptions: { getProvider, perProviderTimeoutMs: over.perProviderTimeoutMs ?? 60_000, cancelGraceMs: over.cancelGraceMs ?? 300 },
    })

  it('SETTLEMENT A — confirmed cancellation (provider rejects with a recognized cancellation within grace) → failed-RETRYABLE, marker cleared, a successor may re-execute', async () => {
    const { ctx, identity } = await seedManagerCtx()
    const barrier = deferred2()
    const provider = settlementProvider('cancel', barrier)
    const controller = new AbortController()
    const p = runIntelligenceRefresh(ctx, realDeps(provider.getProvider), { signal: controller.signal })
    await poll2(() => provider.stats.started, (n) => n >= 1)
    controller.abort()
    const r = await p
    expect(r.status).toBe('failed') // confirmed cancellation is a RETRYABLE failure, NOT 'unknown'
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.status).toBe('failed')
    expect(run?.retryable).toBe(true)
    expect(run?.failureCategory).toBe('confirmed_cancellation')
    expect(run?.providerExecStartedAt ?? null).toBeNull() // marker CLEARED — known-safe
    expect((await db.decisionIntelligenceRun.count({ where: { resultKey: identity.identityKey, status: 'succeeded' } }))).toBe(0)
    barrier.resolve()

    // A successor safely RE-EXECUTES the confirmed-cancelled run (retryable).
    const okBarrier = deferred2(); okBarrier.resolve()
    const successor = settlementProvider('complete', okBarrier)
    await runIntelligenceRefresh(ctx, realDeps(successor.getProvider))
    expect(successor.stats.started).toBeGreaterThanOrEqual(1) // re-execution was permitted
  })

  it('SETTLEMENT B — cancellation grace expires (provider never settles) → UNKNOWN (retryable=false, marker preserved); a successor starts ZERO provider requests even past lease + claim expiry', async () => {
    const { ctx, identity } = await seedManagerCtx()
    const barrier = deferred2() // never resolved → the provider hangs past the grace
    const provider = settlementProvider('hang', barrier)
    const controller = new AbortController()
    // A non-cancellable provider: the request is bounded by the per-provider timeout, and STILL does not settle
    // within the subsequent cancel grace → its remote outcome is UNKNOWN (not a false confirmed-cancellation).
    const p = runIntelligenceRefresh(ctx, realDeps(provider.getProvider, { perProviderTimeoutMs: 250, cancelGraceMs: 120 }), { signal: controller.signal })
    await poll2(() => provider.stats.started, (n) => n >= 1)
    controller.abort() // lease loss; provider ignores it and stays unresolved beyond the timeout + grace
    const r = await p
    expect(r.status).toBe('unknown') // NOT an ordinary retryable failure
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.status).toBe('unknown')
    expect(run?.retryable).toBe(false)
    expect(run?.failureCategory).toBe('provider_outcome_unknown')
    expect(run?.providerExecStartedAt ?? null).not.toBeNull() // marker PRESERVED — not cleared into a retryable state
    expect(run?.expiresAt ?? null).toBeNull()                 // NO new freshness
    expect((await db.decisionIntelligenceRun.count({ where: { resultKey: identity.identityKey, status: 'succeeded' } }))).toBe(0)

    // Advance BEYOND the lease + claim expiry, then run a successor — a finite expiry must NOT permit re-execution.
    await db.decisionIntelligenceRun.update({ where: { resultKey: identity.identityKey }, data: { leaseExpiresAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() - 60_000) } })
    const succBarrier = deferred2(); succBarrier.resolve()
    const successor = settlementProvider('complete', succBarrier)
    const r2 = await runIntelligenceRefresh(ctx, realDeps(successor.getProvider))
    expect(successor.stats.started).toBe(0)   // ZERO provider requests — UNKNOWN blocked automatic re-execution
    expect(r2.refreshed).toBe(false)
    const after = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(after?.status).toBe('unknown')     // still UNKNOWN — never resurrected by expiry (max orchestration overlap = 1)
    barrier.resolve()
  })

  it('SETTLEMENT C — provider completes during the abort race → not falsely recorded as cancelled; stale owner cannot persist; a successor issues no duplicate provider call', async () => {
    const { ctx, identity } = await seedManagerCtx()
    const barrier = deferred2()
    const provider = settlementProvider('complete', barrier) // on abort, RESOLVES successfully
    const controller = new AbortController()
    const p = runIntelligenceRefresh(ctx, realDeps(provider.getProvider), { signal: controller.signal })
    await poll2(() => provider.stats.started, (n) => n >= 1)
    controller.abort()
    const r = await p
    expect(r.status).toBe('unknown') // completed-but-unsettled → UNKNOWN (never labelled a cancellation)
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.status).toBe('unknown')
    expect(run?.retryable).toBe(false)
    expect(run?.failureCategory).toBe('provider_completed_unsettled') // classified as COMPLETED, not cancelled
    expect((await db.decisionIntelligenceRun.count({ where: { resultKey: identity.identityKey, status: 'succeeded' } }))).toBe(0) // stale owner did NOT persist
    barrier.resolve()

    const succBarrier = deferred2(); succBarrier.resolve()
    const successor = settlementProvider('complete', succBarrier)
    await runIntelligenceRefresh(ctx, realDeps(successor.getProvider))
    expect(successor.stats.started).toBe(0) // no automatic duplicate provider call
  })

  it('SETTLEMENT D — ambiguous transport rejection after abort (not a recognized cancellation) → UNKNOWN, no automatic retry', async () => {
    const { ctx, identity } = await seedManagerCtx()
    const barrier = deferred2()
    const provider = settlementProvider('ambiguous', barrier) // on abort, REJECTS with a non-cancellation error
    const controller = new AbortController()
    const p = runIntelligenceRefresh(ctx, realDeps(provider.getProvider), { signal: controller.signal })
    await poll2(() => provider.stats.started, (n) => n >= 1)
    controller.abort()
    const r = await p
    expect(r.status).toBe('unknown')
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.status).toBe('unknown')
    expect(run?.retryable).toBe(false)
    expect(run?.failureCategory).toBe('provider_outcome_unknown') // ambiguous → indeterminate → UNKNOWN
    barrier.resolve()

    const succBarrier = deferred2(); succBarrier.resolve()
    const successor = settlementProvider('complete', succBarrier)
    await runIntelligenceRefresh(ctx, realDeps(successor.getProvider))
    expect(successor.stats.started).toBe(0) // UNKNOWN → no automatic provider re-execution
  })

  it('PARENT JOB — a refresh whose provider outcome is UNKNOWN → TERMINAL reconciliation-required job (not "completed", mints no freshness, blocks re-execution, not a cache hit)', async () => {
    await db.automationJob.deleteMany({ where: { jobType: 'decision_os.intelligence_refresh' } })
    const owner = await seedUser(); const usr = await seedUser()
    const leagueId = await seedLeague(owner); await seedRosterMember(leagueId, usr); await seedSupremeSubscription(usr)
    await db.intelligenceLeagueSnapshot.create({ data: { leagueId, totalEvents: 5, tradeCount: 2, waiverCount: 1, lineupCount: 1, draftCount: 0, scoringCount: 0, governanceCount: 0, openTradeProposals: 1, lastActivityAt: new Date('2026-07-27T00:00:00Z') } })
    const ctx = ((await buildLeagueIntelligenceEvidence({ db, leagueId, userId: usr, tool: 'manager_intelligence', decisionType: 'trade' })) as { ctx: IntelligenceRequestContext }).ctx
    const oldIdentity = computeIntelligenceRequestIdentity(ctx)
    await runManagedIntelligence(ctx, baseDeps({ runOrchestration: async () => okResult() })) // seed a succeeded run
    // Material change so the refresh recomputes a NEW canonical identity (the run that will go UNKNOWN).
    await db.intelligenceLeagueSnapshot.update({ where: { leagueId }, data: { tradeCount: { increment: 1 }, totalEvents: { increment: 1 }, lastActivityAt: new Date() } })
    const changedKey = computeIntelligenceRequestIdentity(((await buildLeagueIntelligenceEvidence({ db, leagueId, userId: usr, tool: 'manager_intelligence', decisionType: 'trade' })) as { ctx: IntelligenceRequestContext }).ctx).identityKey

    // Orchestration that reports an INDETERMINATE provider settlement, then loses its lease → owner records UNKNOWN.
    const controller = new AbortController()
    const runOrchestration = async (_p: DecisionOSEvidencePacket, o?: { signal?: AbortSignal; onProviderRequest?: (r: ProviderRequestOutcome) => void }) => {
      o?.onProviderRequest?.({ role: 'deepseek', classification: 'indeterminate', usableResponse: false, incorporated: false, startedAtMs: 0, settledAtMs: 0 })
      controller.abort()
      return okResult()
    }
    const res = await runIntelligenceRefreshJob({ userId: usr, metadata: { identityKey: oldIdentity.identityKey } }, baseDeps({ runOrchestration }), { signal: controller.signal })

    expect(res.status).toBe('failed') // TERMINAL failure — a returned 'failed' is not re-picked by the drain (no churn)
    expect(res.message).toBe('refresh_provider_outcome_unknown_reconcile_required')
    expect((res.metadata as { unknownOutcome?: boolean }).unknownOutcome).toBe(true)
    expect((res.metadata as { requiresReconciliation?: boolean }).requiresReconciliation).toBe(true)
    const changed = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: changedKey } })
    expect(changed?.status).toBe('unknown') // durable UNKNOWN — blocks re-execution, not concealed as a cache hit
    expect(changed?.expiresAt ?? null).toBeNull() // no freshness minted
    expect(changed?.retryable).toBe(false)
  })

  // ── Partial-completion history: a provider stage that COMPLETED before the abort must not be forgotten ───────
  // The whole-run settlement folds the COMPLETE execution history; any usable completed response forbids a
  // wholesale CONFIRMED_CANCELLED (which would let a successor re-run — and re-bill — that completed stage).
  const resolved2 = () => { const b = deferred2(); b.resolve(); return b }
  // Role-appropriate VALID output so a completing specialist/synthesis passes validation and the real orchestration
  // proceeds to the next stage (an invalid response would short-circuit to deterministic_only before synthesis).
  const validResponseFor = (role: string) => {
    const json = role === 'openai' || role === 'anthropic'
      ? { shortAnswer: 'x', whatDataSays: '', whatItMeans: '', alternatives: [], caveats: [], evidenceIds: [] }
      : { findings: [], caveats: [] }
    return { text: JSON.stringify(json), json, model: 'fake', provider: 'openai' as never, status: 'ok' as const, tokensPrompt: 1, tokensCompletion: 1 }
  }
  /** Per-ROLE provider: each orchestration role (deepseek/grok/openai/anthropic) gets its own mode + barrier, so a
   *  test can make one specialist COMPLETE while another is CANCELLED. Unspecified roles complete immediately. */
  function multiStageProvider(spec: Record<string, { mode: 'complete' | 'cancel' | 'ambiguous' | 'hang'; barrier: { promise: Promise<void> } }>) {
    const stats: Record<string, { started: number; completed: number; cancelled: number }> = {}
    const ensure = (role: string) => (stats[role] ??= { started: 0, completed: 0, cancelled: 0 })
    const clientFor = (role: string): ThreeBrainProviderClient => {
      const s = spec[role] ?? { mode: 'complete' as const, barrier: resolved2() }
      const st = ensure(role)
      return {
        isAvailable: () => true,
        chat: (_r, opts) => {
          st.started += 1
          return new Promise((resolve, reject) => {
            let done = false
            const once = (fn: () => void) => { if (done) return; done = true; fn() }
            const sig = opts?.signal
            const onAbort = () => {
              if (s.mode === 'cancel') once(() => { st.cancelled += 1; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
              else if (s.mode === 'ambiguous') once(() => { st.cancelled += 1; reject(Object.assign(new Error('socket hang up'), { name: 'Error' })) })
              else if (s.mode === 'complete') once(() => { st.completed += 1; resolve(validResponseFor(role)) })
              // 'hang' → ignore the abort
            }
            if (s.mode !== 'hang' && sig) { if (sig.aborted) return onAbort(); sig.addEventListener('abort', onAbort, { once: true }) }
            s.barrier.promise.then(() => once(() => { st.completed += 1; resolve(validResponseFor(role)) }), () => {})
          })
        },
      }
    }
    return { getProvider: ((role) => clientFor(role)) as ThreeBrainProviderGetter, stats }
  }

  it('PARTIAL A — a specialist that COMPLETED before the abort is not forgotten: completed A + cancelled B → UNKNOWN (not CONFIRMED_CANCELLED); the successor never re-invokes A; no post-abort synthesis', async () => {
    const { ctx, identity } = await seedManagerCtx()
    const bHang = deferred2()
    const provider = multiStageProvider({ deepseek: { mode: 'complete', barrier: resolved2() }, grok: { mode: 'cancel', barrier: bHang } })
    const controller = new AbortController()
    const p = runIntelligenceRefresh(ctx, realDeps(provider.getProvider), { signal: controller.signal })
    await poll2(() => provider.stats.deepseek?.completed ?? 0, (n) => n >= 1) // A COMPLETED (one usable response, recorded)
    controller.abort() // lease loss while B is still in flight
    const r = await p
    expect(r.status).toBe('unknown') // a completed stage ⇒ the whole run is NOT wholly cancelled
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.status).toBe('unknown')
    expect(run?.failureCategory).toBe('provider_completed_unsettled')
    expect(run?.retryable).toBe(false)
    expect(run?.providerExecStartedAt ?? null).not.toBeNull() // marker preserved
    expect(provider.stats.deepseek?.completed).toBe(1)
    expect(provider.stats.grok?.cancelled ?? 0).toBeGreaterThanOrEqual(1)
    expect(provider.stats.openai?.started ?? 0).toBe(0) // NO post-abort synthesis stage started
    bHang.resolve()

    // A successor is blocked by UNKNOWN → specialist A is NEVER invoked a second time.
    const successor = multiStageProvider({ deepseek: { mode: 'complete', barrier: resolved2() }, grok: { mode: 'complete', barrier: resolved2() } })
    await runIntelligenceRefresh(ctx, realDeps(successor.getProvider))
    expect(successor.stats.deepseek?.started ?? 0).toBe(0) // A not re-called
    expect(provider.stats.deepseek?.started).toBe(1) // original A: exactly one invocation, ever
  })

  it('PARTIAL B — a completed SYNTHESIS before lease loss is not forgotten: specialists + synthesis complete, then lease lost → UNKNOWN; a late stale-owner persist affects zero rows; automatic retry repeats neither', async () => {
    const { ctx, identity } = await seedManagerCtx()
    const provider = multiStageProvider({
      deepseek: { mode: 'complete', barrier: resolved2() }, grok: { mode: 'complete', barrier: resolved2() },
      openai: { mode: 'complete', barrier: resolved2() }, anthropic: { mode: 'complete', barrier: resolved2() },
    })
    const controller = new AbortController()
    // Wrap the REAL orchestration; abort AFTER it fully returns (all stages completed) but before the owner persists.
    const runOrchestration = async (pk: DecisionOSEvidencePacket, o?: { signal?: AbortSignal; onProviderRequest?: (r: ProviderRequestOutcome) => void }) => {
      const result = await runThreeBrainAnalysis(pk, { getProvider: provider.getProvider, perProviderTimeoutMs: 60_000, signal: o?.signal, onProviderRequest: o?.onProviderRequest })
      controller.abort() // lease lost after synthesis completed, before persistence/finalization
      return result
    }
    const r = await runIntelligenceRefresh(ctx, baseDeps({ runOrchestration }), { signal: controller.signal })
    expect(r.status).toBe('unknown')
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.status).toBe('unknown')
    expect(run?.failureCategory).toBe('provider_completed_unsettled')
    expect(run?.retryable).toBe(false)
    expect(provider.stats.openai?.completed ?? 0).toBeGreaterThanOrEqual(1) // synthesis DID complete
    const originalDeepseekStarts = provider.stats.deepseek?.started

    // A late stale-owner persist (the owner's now-superseded token) affects ZERO rows.
    const store = new PrismaIntelligenceResultStore(db)
    await store.complete({ identityKey: identity.identityKey, userId: ctx.userId, ownerToken: run?.ownerToken ?? '', result: okResult(), requestSnapshot: {}, providerParticipation: {}, entitlementMode: 'free_reuse', tokenLedgerId: null, tokenReservationKey: null, expiresAt: new Date(Date.now() + 60_000), now: new Date() })
    const afterLate = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(afterLate?.status).toBe('unknown') // late persist is status-gated → no effect
    expect((await db.decisionIntelligenceRun.count({ where: { resultKey: identity.identityKey, status: 'succeeded' } }))).toBe(0)

    // Automatic retry does not repeat specialists or synthesis (successor blocked by UNKNOWN).
    const successor = multiStageProvider({ deepseek: { mode: 'complete', barrier: resolved2() }, grok: { mode: 'complete', barrier: resolved2() }, openai: { mode: 'complete', barrier: resolved2() } })
    await runIntelligenceRefresh(ctx, realDeps(successor.getProvider))
    expect(successor.stats.deepseek?.started ?? 0).toBe(0)
    expect(successor.stats.openai?.started ?? 0).toBe(0)
    expect(provider.stats.deepseek?.started).toBe(originalDeepseekStarts) // originals not re-invoked
  })

  it('PARTIAL C — parallel specialists with MIXED outcomes (A completed, B cancelled) aggregate to UNKNOWN, not CONFIRMED_CANCELLED; successor issues zero provider calls; max orchestration overlap = 1', async () => {
    const { ctx, identity } = await seedManagerCtx()
    const aHang = deferred2()
    const provider = multiStageProvider({ deepseek: { mode: 'cancel', barrier: aHang }, grok: { mode: 'complete', barrier: resolved2() } })
    const controller = new AbortController()
    const p = runIntelligenceRefresh(ctx, realDeps(provider.getProvider), { signal: controller.signal })
    await poll2(() => provider.stats.grok?.completed ?? 0, (n) => n >= 1) // grok completed before the abort
    controller.abort()
    const r = await p
    expect(r.status).toBe('unknown') // mixed (one completed) ⇒ not wholly cancelled
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.status).toBe('unknown')
    expect(run?.retryable).toBe(false)
    aHang.resolve()

    const successor = multiStageProvider({ deepseek: { mode: 'complete', barrier: resolved2() }, grok: { mode: 'complete', barrier: resolved2() } })
    await runIntelligenceRefresh(ctx, realDeps(successor.getProvider))
    expect(successor.stats.deepseek?.started ?? 0).toBe(0) // successor executed nothing → overlap never exceeded 1
    expect(successor.stats.grok?.started ?? 0).toBe(0)
  })

  it('PARTIAL D — every issued request truly cancels with no usable response → CONFIRMED_CANCELLED/retryable remains permitted; a later retry is safe', async () => {
    const { ctx, identity } = await seedManagerCtx()
    const hang = deferred2()
    const provider = multiStageProvider({ deepseek: { mode: 'cancel', barrier: hang }, grok: { mode: 'cancel', barrier: hang } })
    const controller = new AbortController()
    const p = runIntelligenceRefresh(ctx, realDeps(provider.getProvider), { signal: controller.signal })
    await poll2(() => (provider.stats.deepseek?.started ?? 0) + (provider.stats.grok?.started ?? 0), (n) => n >= 2)
    controller.abort()
    const r = await p
    expect(r.status).toBe('failed') // no usable response + all cancelled → confirmed cancellation → retryable
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.status).toBe('failed')
    expect(run?.retryable).toBe(true)
    expect(run?.failureCategory).toBe('confirmed_cancellation')
    expect(run?.providerExecStartedAt ?? null).toBeNull() // marker cleared — safe retry
    hang.resolve()
    const successor = multiStageProvider({ deepseek: { mode: 'complete', barrier: resolved2() }, grok: { mode: 'complete', barrier: resolved2() } })
    await runIntelligenceRefresh(ctx, realDeps(successor.getProvider))
    expect(successor.stats.deepseek?.started ?? 0).toBeGreaterThanOrEqual(1) // retry permitted
  })

  it('PARTIAL E — abort BEFORE any external request is issued → CONFIRMED_CANCELLED/retryable; zero provider calls; marker never set', async () => {
    const { ctx, identity } = await seedManagerCtx()
    const provider = multiStageProvider({ deepseek: { mode: 'complete', barrier: resolved2() }, grok: { mode: 'complete', barrier: resolved2() } })
    const controller = new AbortController(); controller.abort() // already lost before execution begins
    const r = await runIntelligenceRefresh(ctx, realDeps(provider.getProvider), { signal: controller.signal })
    expect(r.status).toBe('failed')
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.status).toBe('failed')
    expect(run?.retryable).toBe(true)
    expect(run?.failureCategory).toBe('confirmed_cancellation')
    expect(provider.stats.deepseek?.started ?? 0).toBe(0) // no external request issued
    expect(provider.stats.grok?.started ?? 0).toBe(0)
    expect(run?.providerExecStartedAt ?? null).toBeNull() // provider-exec marker never set
  })

  it('MULTI-STAGE — a completed synthesis is not forgotten when a later REVIEW is cancelled: history [specialists + synthesis completed, review cancelled] → UNKNOWN, not CONFIRMED_CANCELLED', async () => {
    const { ctx, identity } = await seedManagerCtx()
    const controller = new AbortController()
    const runOrchestration = async (_pk: DecisionOSEvidencePacket, o?: { signal?: AbortSignal; onProviderRequest?: (r: ProviderRequestOutcome) => void }) => {
      o?.onProviderRequest?.({ role: 'deepseek', classification: 'completed', usableResponse: true, incorporated: true, startedAtMs: 0, settledAtMs: 1 })
      o?.onProviderRequest?.({ role: 'grok', classification: 'completed', usableResponse: true, incorporated: true, startedAtMs: 0, settledAtMs: 1 })
      o?.onProviderRequest?.({ role: 'openai', classification: 'completed', usableResponse: true, incorporated: true, startedAtMs: 1, settledAtMs: 2 })
      o?.onProviderRequest?.({ role: 'anthropic', classification: 'cancelled', usableResponse: false, incorporated: false, startedAtMs: 2, settledAtMs: 3 })
      controller.abort()
      return okResult()
    }
    await runIntelligenceRefresh(ctx, baseDeps({ runOrchestration }), { signal: controller.signal })
    const run = await db.decisionIntelligenceRun.findUnique({ where: { resultKey: identity.identityKey } })
    expect(run?.status).toBe('unknown') // specialists + synthesis completed → UNKNOWN despite the cancelled review
    expect(run?.failureCategory).toBe('provider_completed_unsettled')
    expect(run?.retryable).toBe(false)
  })
})
