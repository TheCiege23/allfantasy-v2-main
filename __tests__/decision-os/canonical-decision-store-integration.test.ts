// @vitest-environment node
import './_noopDbEnv' // MUST be first — lets the Prisma singleton init under node env when no DB is configured
/**
 * Phase 3A — canonical decision Prisma store INTEGRATION (real isolated sandbox; never production). Proves the
 * `PrismaCanonicalDecisionStore` end-to-end against the `canonical_decisions` table: shadow write, retry
 * idempotency (upsert-by-decisionId), duplicate suppression, atomic batch, supersession, run linkage, audit
 * fields, and JSON/DateTime round-trip. Gated on TEST_DATABASE_URL (skips otherwise). No provider, no tokens.
 */
import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  buildCanonicalDecision,
  shadowPersistDecisions,
  CANONICAL_SHADOW_FLAG,
  type CanonicalDecisionInput,
} from '@/lib/decision-os/canonical'
import { PrismaCanonicalDecisionStore } from '@/lib/decision-os/canonical/prismaDecisionStore'

const URL = process.env.TEST_DATABASE_URL
const RUN = !!URL
const suite = RUN ? describe : describe.skip
const NS = `p3a_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`
const PRODUCER = `p3a_int_${NS}`
const db = RUN ? new PrismaClient({ datasourceUrl: URL }) : (null as unknown as PrismaClient)
const enabledEnv = () => ({ [CANONICAL_SHADOW_FLAG]: 'true' }) as unknown as NodeJS.ProcessEnv

const input = (over: Partial<CanonicalDecisionInput> = {}): CanonicalDecisionInput => ({
  userId: `${NS}_u1`,
  leagueId: `${NS}_lg1`,
  connectedFranchiseId: null,
  sourcePlatform: 'sleeper',
  sport: 'NFL',
  season: 2026,
  period: 'week:5',
  category: 'waiver_target',
  subtype: null,
  scope: 'player',
  audience: 'manager',
  headline: 'Add breakout RB',
  explanation: 'High opportunity share after the starter went down.',
  recommendedAction: 'Submit a waiver claim',
  evidence: [{ id: 'e1', kind: 'transaction', label: 'RB1 to IR', trust: 'high' }],
  confidencePct: 66,
  severity: 'medium',
  urgency: 'this_week',
  priorityScore: 60,
  expectedImpact: null,
  players: [{ canonicalPlayerId: `${NS}_plRB`, name: 'Breakout RB', position: 'RB' }],
  teamRef: `${NS}_roster1`,
  source: { platform: 'sleeper', platformLeagueId: 'S1', deepLinkUrl: 'https://sleeper.com/x' },
  dataAsOf: '2026-07-29T12:00:00.000Z',
  generatedAt: '2026-07-29T12:00:05.000Z',
  staleAt: '2026-07-30T12:00:00.000Z',
  freshness: 'fresh',
  entitlementTier: 'subscription',
  tokenCostClass: 'included',
  status: 'active',
  suppressionReason: null,
  conflictGroupKey: `waiver:NFL:2026:${NS}_plRB`,
  supersedes: null,
  producer: PRODUCER,
  producerVersion: '1',
  runId: `${NS}_run1`,
  extensions: { sourceId: 's1' },
  ...over,
})

beforeAll(async () => { if (RUN) await db.$connect() })
afterAll(async () => {
  if (RUN) {
    await db.canonicalDecision.deleteMany({ where: { producer: PRODUCER } }).catch(() => {})
    await db.$disconnect()
  }
})

suite('canonical decision Prisma store (isolated sandbox)', () => {
  it('shadow write persists with full JSON + DateTime round-trip + audit/run linkage', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const d = buildCanonicalDecision(input())
    const r = await shadowPersistDecisions({ decisions: [d], mode: 'shadow', store, env: enabledEnv() })
    expect(r).toMatchObject({ enabled: true, created: 1, updated: 0, superseded: 0 })

    const saved = await store.get(d.decisionId)
    expect(saved).not.toBeNull()
    expect(saved!.decisionId).toBe(d.decisionId)
    expect(saved!.sourceReadOnly).toBe(true)
    expect(saved!.runId).toBe(`${NS}_run1`)
    expect(saved!.producer).toBe(PRODUCER)
    expect(saved!.evidence).toEqual(d.evidence) // JSON round-trip
    expect(saved!.players).toEqual(d.players)
    expect(saved!.source).toEqual(d.source)
    expect(saved!.extensions).toEqual(d.extensions)
    expect(saved!.generatedAt).toBe('2026-07-29T12:00:05.000Z') // DateTime round-trip
    expect(saved!.staleAt).toBe('2026-07-30T12:00:00.000Z')
    expect(saved!.freshness).toBe('fresh')
    expect(saved!.conflictGroupKey).toBe(`waiver:NFL:2026:${NS}_plRB`)
  })

  it('retry is idempotent (same decision twice → one row, created then updated)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const d = buildCanonicalDecision(input({ period: 'week:6' }))
    const first = await shadowPersistDecisions({ decisions: [d], mode: 'shadow', store, env: enabledEnv() })
    const second = await shadowPersistDecisions({ decisions: [d], mode: 'shadow', store, env: enabledEnv() })
    expect(first.created).toBe(1)
    expect(second.created).toBe(0)
    expect(second.updated).toBe(1)
    const count = await db.canonicalDecision.count({ where: { decisionId: d.decisionId } })
    expect(count).toBe(1)
  })

  it('atomic batch + duplicate suppression within one call', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const a = buildCanonicalDecision(input({ period: 'week:7', players: [{ canonicalPlayerId: `${NS}_pA` }] }))
    const b = buildCanonicalDecision(input({ period: 'week:7', players: [{ canonicalPlayerId: `${NS}_pB` }] }))
    const r = await shadowPersistDecisions({ decisions: [a, b, { ...a }], mode: 'shadow', store, env: enabledEnv() })
    expect(r.created).toBe(2) // a + b; the duplicate a deduped
  })

  it('supersession marks the prior decision superseded in the DB', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const oldD = buildCanonicalDecision(input({ period: 'week:8' }))
    await shadowPersistDecisions({ decisions: [oldD], mode: 'shadow', store, env: enabledEnv() })
    const newD = buildCanonicalDecision(input({ period: 'week:9', supersedes: oldD.decisionId }))
    const r = await shadowPersistDecisions({ decisions: [newD], mode: 'shadow', store, env: enabledEnv() })
    expect(r.superseded).toBe(1)
    expect((await store.get(oldD.decisionId))!.status).toBe('superseded')
    expect((await store.get(newD.decisionId))!.status).toBe('active')
  })

  it('flag disabled → nothing written to the real DB', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const d = buildCanonicalDecision(input({ period: 'week:disabled' }))
    const r = await shadowPersistDecisions({ decisions: [d], mode: 'shadow', store, env: {} as NodeJS.ProcessEnv })
    expect(r.persisted).toBe(0)
    expect(await db.canonicalDecision.count({ where: { decisionId: d.decisionId } })).toBe(0)
  })

  // ── H3: concurrent-writer safety (real Postgres) ────────────────────────────────────────────────────────────
  it('two CONCURRENT inserts of the same logical decision converge on exactly one row (no unhandled unique error)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const d = buildCanonicalDecision(input({ period: 'week:concurrent-insert' }))
    // Both race to insert the same decisionId; a race-safe upsert must not throw and must leave ONE row.
    const [r1, r2] = await Promise.all([
      store.persistBatch({ decisions: [d], supersede: [], now: new Date('2026-07-29T12:00:00.000Z') }),
      store.persistBatch({ decisions: [d], supersede: [], now: new Date('2026-07-29T12:00:01.000Z') }),
    ])
    expect(r1.created + r1.updated).toBe(1)
    expect(r2.created + r2.updated).toBe(1)
    expect(await db.canonicalDecision.count({ where: { decisionId: d.decisionId } })).toBe(1)
  })

  it('two CONCURRENT supersessions of the same prior decision are idempotent (final status superseded)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const oldD = buildCanonicalDecision(input({ period: 'week:concurrent-old' }))
    await store.persistBatch({ decisions: [oldD], supersede: [], now: new Date('2026-07-29T12:00:00.000Z') })
    const newA = buildCanonicalDecision(input({ period: 'week:concurrent-newA', supersedes: oldD.decisionId }))
    const newB = buildCanonicalDecision(input({ period: 'week:concurrent-newB', supersedes: oldD.decisionId }))
    await Promise.all([
      store.persistBatch({ decisions: [newA], supersede: [{ oldDecisionId: oldD.decisionId, byDecisionId: newA.decisionId }], now: new Date() }),
      store.persistBatch({ decisions: [newB], supersede: [{ oldDecisionId: oldD.decisionId, byDecisionId: newB.decisionId }], now: new Date() }),
    ])
    expect((await store.get(oldD.decisionId))!.status).toBe('superseded')
  })

  it('batch is ATOMIC — a DB-rejected item rolls back the whole batch (first item not persisted)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const good = buildCanonicalDecision(input({ period: 'week:atomic-good' }))
    // Bypass the boundary validator and hand the store an item that violates a DB column limit (subjectKey VARCHAR(191)).
    const bad = { ...buildCanonicalDecision(input({ period: 'week:atomic-bad' })), subjectKey: 'x'.repeat(400) }
    await expect(
      store.persistBatch({ decisions: [good, bad], supersede: [], now: new Date() }),
    ).rejects.toBeTruthy()
    expect(await db.canonicalDecision.count({ where: { decisionId: good.decisionId } })).toBe(0) // rolled back
  })

  // ── H2: append-only revision history (audit) ────────────────────────────────────────────────────────────────
  it('a later run appends a revision and does NOT overwrite prior generated content', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const run1 = buildCanonicalDecision(input({ period: 'week:hist', runId: `${NS}_runH1`, explanation: 'first-gen', confidencePct: 40 }))
    await shadowPersistDecisions({ decisions: [run1], mode: 'shadow', store, env: enabledEnv() })
    await shadowPersistDecisions({ decisions: [run1], mode: 'shadow', store, env: enabledEnv() }) // retry same → no new revision
    const run2 = buildCanonicalDecision(input({ period: 'week:hist', runId: `${NS}_runH2`, explanation: 'second-gen', confidencePct: 90 }))
    const r2 = await shadowPersistDecisions({ decisions: [run2], mode: 'shadow', store, env: enabledEnv() })
    expect(run1.decisionId).toBe(run2.decisionId) // same logical decision
    expect(r2.updated).toBe(1)
    expect(r2.revised).toBe(1)

    const current = await store.get(run1.decisionId)
    expect(current!.explanation).toBe('second-gen') // current state = latest run
    expect(current!.runId).toBe(`${NS}_runH2`)

    const revs = await store.getRevisions(run1.decisionId)
    expect(revs.length).toBe(2) // both runs preserved (retry did not duplicate)
    expect(revs.map((r) => r.explanation)).toEqual(['first-gen', 'second-gen'])
    expect(revs.map((r) => r.runId)).toEqual([`${NS}_runH1`, `${NS}_runH2`])
    expect(revs[0]!.confidencePct).toBe(40) // prior generated content still recoverable
  })

  // ── H4: execution/source policy round-trips ─────────────────────────────────────────────────────────────────
  it('native_actionable_dormant persists with sourceReadOnly=false; external stays read-only', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const native = buildCanonicalDecision(input({ period: 'week:native', sourcePlatform: 'allfantasy', source: null, sourceExecutionPolicy: 'native_actionable_dormant' }))
    const external = buildCanonicalDecision(input({ period: 'week:external' })) // sleeper default
    await shadowPersistDecisions({ decisions: [native, external], mode: 'shadow', store, env: enabledEnv() })
    const savedNative = await store.get(native.decisionId)
    const savedExternal = await store.get(external.decisionId)
    expect(savedNative!.sourceExecutionPolicy).toBe('native_actionable_dormant')
    expect(savedNative!.sourceReadOnly).toBe(false)
    expect(savedExternal!.sourceExecutionPolicy).toBe('external_read_only')
    expect(savedExternal!.sourceReadOnly).toBe(true)
  })
})
