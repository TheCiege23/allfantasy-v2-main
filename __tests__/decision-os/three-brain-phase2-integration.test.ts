/**
 * Phase 2 REAL-ADAPTER integration tests. These exercise the ACTUAL Prisma-backed store + the true
 * TokenReservationService + the reservation token guard + the full managed-intelligence flow against a REAL,
 * PROVEN-ISOLATED Postgres (the `decision-os-phaseA-verify` sandbox — a separate Neon project from production,
 * verified read-only to hold no production user data). Model providers are mocked; NO real provider credits.
 *
 * Gated on `TEST_DATABASE_URL` — skipped entirely when unset, so the normal suite needs no database. Rows are
 * namespaced by a per-run id and left in place (no autonomous destructive SQL).
 */
import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { buildEvidencePacket } from '@/lib/decision-os/three-brain/evidencePacket'
import { computeIntelligenceRequestIdentity } from '@/lib/decision-os/three-brain/phase2/requestIdentity'
import {
  PrismaIntelligenceResultStore,
  ReservationTokenGuard,
  createManagedIntelligenceDeps,
} from '@/lib/decision-os/three-brain/phase2/realAdapters'
import { TokenReservationService } from '@/lib/tokens/TokenReservationService'
import { runManagedIntelligence } from '@/lib/decision-os/three-brain/phase2/intelligenceService'
import type { FeatureAccessChecker, LeagueAccessChecker } from '@/lib/decision-os/three-brain/phase2/entitlementPolicy'
import type { IntelligenceRequestContext } from '@/lib/decision-os/three-brain/phase2/types'
import type { ThreeBrainDecisionResult } from '@/lib/decision-os/three-brain/types'

const URL = process.env.TEST_DATABASE_URL
const RUN = !!URL
const suite = RUN ? describe : describe.skip

const RUN_NS = `p2i_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
const db = RUN ? new PrismaClient({ datasourceUrl: URL }) : (null as unknown as PrismaClient)

const NOW = new Date('2026-07-28T12:00:00.000Z')
const okResult = (): ThreeBrainDecisionResult => ({
  schemaVersion: '1', decisionType: 'trade_review', shortAnswer: 'INTEGRATION_OK', whatDataSays: '', whatItMeans: '',
  recommendedAction: 'accept', alternatives: [], caveats: [], evidenceIds: ['sig-1'], agreementState: 'consensus',
  specialistStatus: { deepseek: 'completed', grok: 'completed', openai: 'completed', anthropic: 'not_requested' },
  claudeState: 'not_requested', confidencePct: 70, freshness: { state: 'fresh' }, missingInformation: [],
})

async function seedUser(balance: number): Promise<string> {
  const userId = `${RUN_NS}_${randomUUID().slice(0, 8)}`
  await db.appUser.create({
    data: { id: userId, email: `${userId}@example.test`, username: userId, updatedAt: new Date() },
  })
  await db.userTokenBalance.create({ data: { userId, balance, reservedBalance: 0 } })
  return userId
}
const balanceOf = (userId: string) =>
  db.userTokenBalance.findUnique({ where: { userId }, select: { balance: true, reservedBalance: true } })

function packetOf(userId: string, over: { decisionType?: string; factValue?: string } = {}) {
  return buildEvidencePacket({
    userId,
    sport: 'NFL',
    decisionType: over.decisionType ?? 'trade_review',
    mode: 'league',
    canonicalLeagueId: `${RUN_NS}_league`,
    signals: [{ id: 'sig-1', kind: 'trade_pending', summary: 'pending trade' }],
    facts: [{ id: 'fact-1', label: 'Value', value: over.factValue ?? '10' }],
    freshness: { state: 'fresh' },
    requestId: 'req-1',
    generatedAt: NOW.toISOString(),
  })
}

beforeAll(async () => {
  if (RUN) await db.$connect()
})
afterAll(async () => {
  if (RUN) await db.$disconnect()
})

suite('Phase 2 real-adapter integration (isolated Postgres)', () => {
  it('16. the generated Prisma client recognizes the new models + fields', async () => {
    // If these delegates/fields did not exist on the generated client, this file would not typecheck/run.
    const r = await db.decisionIntelligenceRun.findFirst({ where: { resultKey: '__none__' } })
    const res = await db.tokenReservation.findFirst({ where: { idempotencyKey: '__none__' } })
    const bal = await db.userTokenBalance.findFirst({ select: { reservedBalance: true } })
    expect(r).toBeNull()
    expect(res).toBeNull()
    void bal // reserved_balance column is selectable
  })

  it('2/3. real cache miss claims exactly one run; concurrent claims for the same key produce one owner', async () => {
    const userId = await seedUser(0)
    const store = new PrismaIntelligenceResultStore(db)
    const identity = computeIntelligenceRequestIdentity({ tool: 'manager_intelligence', userId, packet: packetOf(userId) })
    const base = { identity, tool: 'manager_intelligence', decisionType: 'trade_review', sport: 'NFL', platform: null, connectedGroupId: null, leaseMs: 60_000, now: NOW, maxAttempts: 3 }
    const [a, b] = await Promise.all([
      store.claim({ ...base, ownerToken: `own-${randomUUID()}` }),
      store.claim({ ...base, ownerToken: `own-${randomUUID()}` }),
    ])
    const owners = [a, b].filter((c) => c.outcome === 'owner')
    expect(owners).toHaveLength(1) // exactly one owner via the result_key unique constraint
    expect([a, b].some((c) => c.outcome === 'busy' || c.outcome === 'exists')).toBe(true)
  })

  it('4. tenant-scoped reads cannot cross users', async () => {
    const userA = await seedUser(0)
    const store = new PrismaIntelligenceResultStore(db)
    const identity = computeIntelligenceRequestIdentity({ tool: 'manager_intelligence', userId: userA, packet: packetOf(userA) })
    await store.claim({ identity, tool: 'manager_intelligence', decisionType: 'trade_review', sport: 'NFL', platform: null, connectedGroupId: null, ownerToken: 'o', leaseMs: 60_000, now: NOW, maxAttempts: 3 })
    expect(await store.findByIdentity({ identityKey: identity.identityKey, userId: userA })).not.toBeNull()
    expect(await store.findByIdentity({ identityKey: identity.identityKey, userId: 'someone-else' })).toBeNull()
  })

  it('7/8/10. reserve holds (balance untouched); finalize debits + writes ledger; release returns the hold', async () => {
    const userId = await seedUser(100)
    const svc = new TokenReservationService(db)
    const key = `${RUN_NS}_${randomUUID()}`

    const r1 = await svc.reserve({ userId, amount: 30, idempotencyKey: key, expiresInMs: 60_000 })
    const r2 = await svc.reserve({ userId, amount: 30, idempotencyKey: key, expiresInMs: 60_000 }) // idempotent
    expect(r2.id).toBe(r1.id) // ONE reservation for the key
    let bal = await balanceOf(userId)
    expect(bal!.balance).toBe(100) // balance NOT debited by a hold
    expect(bal!.reservedBalance).toBe(30) // spendable dropped to 70

    const fin = await svc.finalize({ userId, idempotencyKey: key })
    expect(fin.ledgerId).toBeTruthy()
    bal = await balanceOf(userId)
    expect(bal!.balance).toBe(70) // NOW debited on finalize
    expect(bal!.reservedBalance).toBe(0)
    // Ledger identity is a domain-separated SHA-256, not the raw key — look it up by the returned id.
    const ledger = await db.tokenLedger.findUnique({ where: { id: fin.ledgerId! }, select: { tokenDelta: true, entryType: true, idempotencyKey: true } })
    expect(ledger?.entryType).toBe('spend')
    expect(ledger?.tokenDelta).toBe(-30)
    expect(ledger?.idempotencyKey?.startsWith('dintel:')).toBe(true)

    // A second finalize is idempotent (no double debit).
    await svc.finalize({ userId, idempotencyKey: key })
    expect((await balanceOf(userId))!.balance).toBe(70)

    // A separate reservation that is RELEASED never debits balance.
    const key2 = `${RUN_NS}_${randomUUID()}`
    await svc.reserve({ userId, amount: 20, idempotencyKey: key2, expiresInMs: 60_000 })
    expect((await balanceOf(userId))!.reservedBalance).toBe(20)
    await svc.release({ userId, idempotencyKey: key2, reason: 'test' })
    bal = await balanceOf(userId)
    expect(bal!.balance).toBe(70) // unchanged
    expect(bal!.reservedBalance).toBe(0)
  })

  it('15. concurrent reservations cannot overspend the balance', async () => {
    const userId = await seedUser(10) // only one 8-token hold fits
    const svc = new TokenReservationService(db)
    const results = await Promise.allSettled([
      svc.reserve({ userId, amount: 8, idempotencyKey: `${RUN_NS}_${randomUUID()}`, expiresInMs: 60_000 }),
      svc.reserve({ userId, amount: 8, idempotencyKey: `${RUN_NS}_${randomUUID()}`, expiresInMs: 60_000 }),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled').length
    const rejected = results.filter((r) => r.status === 'rejected').length
    expect(ok).toBe(1) // exactly one hold fit
    expect(rejected).toBe(1) // the other was refused (insufficient) — no overspend
    const bal = await balanceOf(userId)
    expect(bal!.reservedBalance).toBe(8)
    expect(bal!.balance).toBe(10)
  })

  it('12. lease/lease-expiry recovery: a stuck run is taken over on the next claim', async () => {
    const userId = await seedUser(0)
    const store = new PrismaIntelligenceResultStore(db)
    const identity = computeIntelligenceRequestIdentity({ tool: 'manager_intelligence', userId, packet: packetOf(userId, { factValue: 'stuck' }) })
    // First claim with a lease already in the past (stuck).
    await store.claim({ identity, tool: 'manager_intelligence', decisionType: 'trade_review', sport: 'NFL', platform: null, connectedGroupId: null, ownerToken: 'dead', leaseMs: -1000, now: NOW, maxAttempts: 3 })
    const takeover = await store.claim({ identity, tool: 'manager_intelligence', decisionType: 'trade_review', sport: 'NFL', platform: null, connectedGroupId: null, ownerToken: 'fresh', leaseMs: 60_000, now: new Date(NOW.getTime() + 5_000), maxAttempts: 3 })
    expect(takeover.outcome).toBe('owner')
    expect(takeover.run.attemptCount).toBe(2)
  })

  it('1/9/11/14. full flow on real DB: token run reserves→persists→finalizes exactly once; reuse never re-charges', async () => {
    const userId = await seedUser(100)
    const orch = vi.fn(async () => okResult())
    const allowLeague: LeagueAccessChecker = { async check() { return { isMember: true, isCommissioner: false } } }
    const denyFeature: FeatureAccessChecker = { async check() { return { allowed: false, requiredPlan: 'pro' } } }
    const deps = createManagedIntelligenceDeps({
      prisma: db,
      featureChecker: denyFeature, // force token path
      leagueChecker: allowLeague,
      tokenGuard: new ReservationTokenGuard(db, async () => 7), // fixed cost 7 (no entitlement I/O)
      runOrchestration: orch,
      refreshScheduler: { async enqueue() { return { refreshInProgress: false } } },
    })
    const ctx: IntelligenceRequestContext = { tool: 'manager_intelligence', userId, packet: packetOf(userId, { factValue: 'flow' }) }

    const r1 = await runManagedIntelligence(ctx, deps)
    expect(r1.status).toBe('succeeded')
    expect(r1.cached).toBe(false)
    expect(orch).toHaveBeenCalledTimes(1)
    const bal1 = await balanceOf(userId)
    expect(bal1!.balance).toBe(93) // 100 - 7 settled
    expect(bal1!.reservedBalance).toBe(0)

    const r2 = await runManagedIntelligence(ctx, deps) // reuse
    expect(r2.cached).toBe(true)
    expect(orch).toHaveBeenCalledTimes(1) // no second provider call
    const bal2 = await balanceOf(userId)
    expect(bal2!.balance).toBe(93) // NO second charge
  })

  it('9/16. provider failure on real DB releases the hold and never debits balance', async () => {
    const userId = await seedUser(50)
    const orch = vi.fn(async () => ({ ...okResult(), agreementState: 'deterministic_only' as const, specialistStatus: { deepseek: 'failed', grok: 'failed', openai: 'skipped', anthropic: 'not_requested' } }))
    const deps = createManagedIntelligenceDeps({
      prisma: db,
      featureChecker: { async check() { return { allowed: false } } },
      leagueChecker: { async check() { return { isMember: true, isCommissioner: false } } },
      tokenGuard: new ReservationTokenGuard(db, async () => 9),
      runOrchestration: orch,
      refreshScheduler: { async enqueue() { return { refreshInProgress: false } } },
    })
    const ctx: IntelligenceRequestContext = { tool: 'manager_intelligence', userId, packet: packetOf(userId, { factValue: 'fail' }) }
    const r = await runManagedIntelligence(ctx, deps)
    expect(r.ok).toBe(false)
    const bal = await balanceOf(userId)
    expect(bal!.balance).toBe(50) // NEVER charged on failure
    expect(bal!.reservedBalance).toBe(0) // hold released
  })
})
