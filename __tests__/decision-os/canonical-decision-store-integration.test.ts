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

  it('retry of the same run is idempotent (one row, one revision, stale-skipped not updated)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const d = buildCanonicalDecision(input({ period: 'week:6' }))
    const first = await shadowPersistDecisions({ decisions: [d], mode: 'shadow', store, env: enabledEnv() })
    const second = await shadowPersistDecisions({ decisions: [d], mode: 'shadow', store, env: enabledEnv() })
    expect(first.created).toBe(1)
    expect(first.revised).toBe(1)
    expect(second.created).toBe(0)
    expect(second.updated).toBe(0) // same generation is not newer
    expect(second.staleSkipped).toBe(1)
    expect(second.revised).toBe(0) // same (decisionId, runId) occurrence
    expect(await db.canonicalDecision.count({ where: { decisionId: d.decisionId } })).toBe(1)
    expect((await store.getRevisions(d.decisionId)).length).toBe(1)
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
  it('two CONCURRENT inserts of the same logical decision converge on exactly one row + one revision (no unhandled error)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const d = buildCanonicalDecision(input({ period: 'week:concurrent-insert' }))
    // Both race to insert the same (decisionId, runId); the row lock + retry must not throw and must leave ONE row.
    const [r1, r2] = await Promise.all([
      store.persistBatch({ decisions: [d], supersede: [], now: new Date('2026-07-29T12:00:00.000Z') }),
      store.persistBatch({ decisions: [d], supersede: [], now: new Date('2026-07-29T12:00:01.000Z') }),
    ])
    expect(r1.created + r2.created).toBe(1) // exactly one insert wins; the other stale-skips
    expect(await db.canonicalDecision.count({ where: { decisionId: d.decisionId } })).toBe(1)
    expect((await store.getRevisions(d.decisionId)).length).toBe(1) // one occurrence for the run
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

  // ── I1: same-run occurrence identity (real Postgres) ────────────────────────────────────────────────────────
  it('same run + changed prose → NO second revision; first occurrence preserved (typed conflict)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const runId = `${NS}_runProse`
    const first = buildCanonicalDecision(input({ period: 'week:prose', runId, explanation: 'first-gen' }))
    const changed = buildCanonicalDecision(input({ period: 'week:prose', runId, explanation: 'DIFFERENT prose' }))
    await shadowPersistDecisions({ decisions: [first], mode: 'shadow', store, env: enabledEnv() })
    const r = await shadowPersistDecisions({ decisions: [changed], mode: 'shadow', store, env: enabledEnv() })
    expect(r.revised).toBe(0)
    expect(r.revisionConflicts).toBe(1)
    const revs = await store.getRevisions(first.decisionId)
    expect(revs.length).toBe(1)
    expect(revs[0]!.explanation).toBe('first-gen') // immutable — never overwritten
    expect(await db.canonicalDecisionRevision.count({ where: { decisionId: first.decisionId } })).toBe(1)
  })

  it('same run + changed generatedAt / reordered evidence → still ONE revision, no conflict', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const runId = `${NS}_runStable`
    const e1 = { id: 'e1', kind: 'matchup', label: 'A' }
    const e2 = { id: 'e2', kind: 'injury', label: 'B' }
    const a = buildCanonicalDecision(input({ period: 'week:stable', runId, generatedAt: '2026-07-29T12:00:00.000Z', evidence: [e1, e2] }))
    const b = buildCanonicalDecision(input({ period: 'week:stable', runId, generatedAt: '2026-07-29T20:00:00.000Z', evidence: [e2, e1] }))
    await shadowPersistDecisions({ decisions: [a], mode: 'shadow', store, env: enabledEnv() })
    const r = await shadowPersistDecisions({ decisions: [b], mode: 'shadow', store, env: enabledEnv() })
    expect(r.revisionConflicts).toBe(0)
    expect(await db.canonicalDecisionRevision.count({ where: { decisionId: a.decisionId } })).toBe(1)
  })

  it('concurrent same-run mismatched payloads resolve deterministically (one revision, first content wins)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const runId = `${NS}_runRace`
    const a = buildCanonicalDecision(input({ period: 'week:race', runId, explanation: 'payload-A' }))
    const b = buildCanonicalDecision(input({ period: 'week:race', runId, explanation: 'payload-B' }))
    const [r1, r2] = await Promise.all([
      store.persistBatch({ decisions: [a], supersede: [], now: new Date() }),
      store.persistBatch({ decisions: [b], supersede: [], now: new Date() }),
    ])
    // exactly one occurrence exists; exactly one call created it, the other saw a conflict — never two rows.
    expect(await db.canonicalDecisionRevision.count({ where: { decisionId: a.decisionId } })).toBe(1)
    expect(r1.revised + r2.revised).toBe(1)
    expect(r1.revisionConflicts + r2.revisionConflicts).toBe(1)
  })

  // ── I2: deterministic current-state ordering (real Postgres) ────────────────────────────────────────────────
  it('older run cannot regress a newer current decision — both arrival orders converge (real DB)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const decisionSeed = { period: 'week:order' }
    const mkNew = () => buildCanonicalDecision(input({ ...decisionSeed, runId: `${NS}_rNew`, generatedAt: '2026-07-29T13:00:00.000Z', explanation: 'NEW' }))
    const mkOld = () => buildCanonicalDecision(input({ ...decisionSeed, runId: `${NS}_rOld`, generatedAt: '2026-07-29T12:00:00.000Z', explanation: 'OLD' }))

    // arrival order 1: old then new
    await shadowPersistDecisions({ decisions: [mkOld()], mode: 'shadow', store, env: enabledEnv() })
    const rNew = await shadowPersistDecisions({ decisions: [mkNew()], mode: 'shadow', store, env: enabledEnv() })
    expect(rNew.updated).toBe(1)
    expect((await store.get(mkNew().decisionId))!.explanation).toBe('NEW')

    // arrival order 2 (fresh decision id): new then old → older must NOT regress
    const seed2 = { period: 'week:order2' }
    const mkNew2 = () => buildCanonicalDecision(input({ ...seed2, runId: `${NS}_rNew2`, generatedAt: '2026-07-29T13:00:00.000Z', explanation: 'NEW2' }))
    const mkOld2 = () => buildCanonicalDecision(input({ ...seed2, runId: `${NS}_rOld2`, generatedAt: '2026-07-29T12:00:00.000Z', explanation: 'OLD2' }))
    await shadowPersistDecisions({ decisions: [mkNew2()], mode: 'shadow', store, env: enabledEnv() })
    const rOld = await shadowPersistDecisions({ decisions: [mkOld2()], mode: 'shadow', store, env: enabledEnv() })
    expect(rOld.staleSkipped).toBe(1)
    expect((await store.get(mkNew2().decisionId))!.explanation).toBe('NEW2')
    // both runs still recorded for audit even though the older did not become current
    expect((await store.getRevisions(mkNew2().decisionId)).map((r) => r.runId).sort()).toEqual([`${NS}_rNew2`, `${NS}_rOld2`].sort())
  })

  it('concurrent old/new writes converge on the newer regardless of commit order (real DB)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const seed = { period: 'week:concurrent-order' }
    const newer = buildCanonicalDecision(input({ ...seed, runId: `${NS}_cNew`, generatedAt: '2026-07-29T13:00:00.000Z', explanation: 'NEWER' }))
    const older = buildCanonicalDecision(input({ ...seed, runId: `${NS}_cOld`, generatedAt: '2026-07-29T12:00:00.000Z', explanation: 'OLDER' }))
    await Promise.all([
      store.persistBatch({ decisions: [newer], supersede: [], now: new Date() }),
      store.persistBatch({ decisions: [older], supersede: [], now: new Date() }),
    ])
    expect((await store.get(newer.decisionId))!.explanation).toBe('NEWER') // newer always wins
  })

  it('equal generatedAt → deterministic runId tie-break (real DB)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const seed = { period: 'week:tie', generatedAt: '2026-07-29T12:00:00.000Z' }
    const runA = buildCanonicalDecision(input({ ...seed, runId: `${NS}_tieA`, explanation: 'A' }))
    const runB = buildCanonicalDecision(input({ ...seed, runId: `${NS}_tieB`, explanation: 'B' })) // tieB > tieA
    await shadowPersistDecisions({ decisions: [runB], mode: 'shadow', store, env: enabledEnv() })
    const rA = await shadowPersistDecisions({ decisions: [runA], mode: 'shadow', store, env: enabledEnv() })
    expect(rA.staleSkipped).toBe(1) // tieA < tieB → not newer
    expect((await store.get(runA.decisionId))!.explanation).toBe('B')
  })

  it('a stale write after supersession does not revert status (real DB)', async () => {
    const store = new PrismaCanonicalDecisionStore(db)
    const oldD = buildCanonicalDecision(input({ period: 'week:sup-old', runId: `${NS}_supOld` }))
    await shadowPersistDecisions({ decisions: [oldD], mode: 'shadow', store, env: enabledEnv() })
    const newD = buildCanonicalDecision(input({ period: 'week:sup-new', runId: `${NS}_supNew`, supersedes: oldD.decisionId }))
    await shadowPersistDecisions({ decisions: [newD], mode: 'shadow', store, env: enabledEnv() })
    expect((await store.get(oldD.decisionId))!.status).toBe('superseded')
    const stale = buildCanonicalDecision(input({ period: 'week:sup-old', runId: `${NS}_supOld` })) // same run/generation
    const r = await shadowPersistDecisions({ decisions: [stale], mode: 'shadow', store, env: enabledEnv() })
    expect(r.staleSkipped).toBe(1)
    expect((await store.get(oldD.decisionId))!.status).toBe('superseded') // not un-superseded
  })
})
