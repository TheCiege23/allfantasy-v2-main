/**
 * Prisma-backed canonical decision store (Phase 3A). SERVER-ONLY. Implements `CanonicalDecisionStore` against the
 * additive `canonical_decisions` (current state) + `canonical_decision_revisions` (immutable audit history) tables.
 *
 * `persistBatch` runs in ONE interactive transaction (atomic batch) and is RACE-SAFE + ORDER-DETERMINISTIC:
 *   - CURRENT STATE is written under an authoritative ordering rule: the existing row is locked with
 *     `SELECT … FOR UPDATE`, and it is updated ONLY when the incoming generation is strictly newer
 *     (`isNewerGeneration`: generatedAt, then runId tie-break). An older/stale/retried run can NEVER regress a
 *     newer current decision, and concurrent different-run writers converge on the same winner regardless of commit
 *     order. The first insert races through ON CONFLICT via the bounded retry below.
 *   - AUDIT HISTORY appends an immutable revision with OCCURRENCE IDENTITY `(decisionId, runId)` — at most one per
 *     run (DB-enforced unique). `content_hash` detects a same-run write with materially different content: the
 *     first occurrence is PRESERVED (never overwritten, never a second row) and the conflict is counted.
 *   - The whole batch is wrapped in a BOUNDED retry that re-runs ONLY on a unique-constraint (P2002) or
 *     write-conflict/deadlock (P2034); every other error surfaces immediately (no blanket error swallowing).
 * It does NO validation (the boundary already validated + required a non-null runId), NO provider call, NO token
 * work, and NO freshness minting. It is never invoked unless `shadowPersistDecisions` (flag + shadow-mode gated)
 * calls it, so deploying this code writes nothing on its own. Injectable Prisma client for isolated-DB integration
 * tests (never production here).
 */
import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import type {
  CanonicalDecision,
  CanonicalDecisionRevision,
  DecisionEvidenceRef,
  DecisionPlayerRef,
  DecisionSourceRef,
} from './contract'
import type { CanonicalDecisionStore, PersistBatchCounts, SupersedeLink } from './decisionStore'
import { computeRevisionContentHash, isNewerGeneration } from './identity'

type PrismaLike = typeof defaultPrisma
const asJson = (v: unknown): Prisma.InputJsonValue => v as unknown as Prisma.InputJsonValue
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)
const dt = (s: string | null | undefined): Date | null => (s ? new Date(s) : null)

const MAX_WRITE_ATTEMPTS = 4

/** Retryable ONLY for a unique-constraint race (P2002) or a write conflict / deadlock (P2034). Everything else is
 *  a real error and must surface. */
function isRetryableWriteError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2002' || e.code === 'P2034')
}

/** Bounded retry around an atomic transaction — converts a concurrent unique/serialization loss into a converging
 *  retry (the second attempt sees the row under FOR UPDATE and re-evaluates). Rethrows non-retryable errors at once
 *  and the last error after exhausting attempts. */
async function withWriteRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (isRetryableWriteError(e) && attempt < MAX_WRITE_ATTEMPTS) {
        lastErr = e
        continue
      }
      throw e
    }
  }
  throw lastErr
}

/** Row → canonical decision (JSON columns re-typed; DateTimes → ISO strings). */
function mapRow(row: NonNullable<Awaited<ReturnType<PrismaLike['canonicalDecision']['findUnique']>>>): CanonicalDecision {
  return {
    contractVersion: row.contractVersion,
    decisionId: row.decisionId,
    fingerprint: row.fingerprint,
    userId: row.userId,
    leagueId: row.leagueId,
    connectedFranchiseId: row.connectedFranchiseId,
    sourcePlatform: row.sourcePlatform,
    sport: row.sport,
    season: row.season,
    period: row.period,
    category: row.category as CanonicalDecision['category'],
    subtype: row.subtype,
    subjectKey: row.subjectKey,
    scope: row.scope as CanonicalDecision['scope'],
    audience: row.audience as CanonicalDecision['audience'],
    headline: row.headline,
    explanation: row.explanation,
    recommendedAction: row.recommendedAction,
    evidence: (row.evidence ?? []) as DecisionEvidenceRef[],
    confidencePct: row.confidencePct,
    severity: row.severity as CanonicalDecision['severity'],
    urgency: row.urgency as CanonicalDecision['urgency'],
    priorityScore: row.priorityScore,
    expectedImpact: row.expectedImpact,
    players: (row.players ?? []) as DecisionPlayerRef[],
    teamRef: row.teamRef,
    source: (row.source ?? null) as DecisionSourceRef | null,
    sourceExecutionPolicy: row.sourceExecutionPolicy as CanonicalDecision['sourceExecutionPolicy'],
    sourceReadOnly: row.sourceReadOnly,
    dataAsOf: iso(row.dataAsOf),
    generatedAt: row.generatedAt.toISOString(),
    staleAt: iso(row.staleAt),
    freshness: row.freshness as CanonicalDecision['freshness'],
    entitlementTier: row.entitlementTier as CanonicalDecision['entitlementTier'],
    tokenCostClass: row.tokenCostClass as CanonicalDecision['tokenCostClass'],
    status: row.status as CanonicalDecision['status'],
    suppressionReason: row.suppressionReason,
    conflictGroupKey: row.conflictGroupKey,
    supersedes: row.supersedesDecisionId,
    producer: row.producer,
    producerVersion: row.producerVersion,
    runId: row.runId,
    extensions: (row.extensions ?? null) as Record<string, unknown> | null,
  }
}

/** Canonical decision → column write payload (shared by create + update). */
function toWrite(d: CanonicalDecision) {
  return {
    contractVersion: d.contractVersion,
    fingerprint: d.fingerprint,
    userId: d.userId,
    leagueId: d.leagueId,
    connectedFranchiseId: d.connectedFranchiseId,
    sourcePlatform: d.sourcePlatform,
    sport: d.sport,
    season: d.season,
    period: d.period,
    category: d.category,
    subtype: d.subtype,
    subjectKey: d.subjectKey,
    scope: d.scope,
    audience: d.audience,
    headline: d.headline,
    explanation: d.explanation,
    recommendedAction: d.recommendedAction,
    evidence: asJson(d.evidence),
    confidencePct: d.confidencePct,
    severity: d.severity,
    urgency: d.urgency,
    priorityScore: d.priorityScore,
    expectedImpact: d.expectedImpact,
    players: asJson(d.players),
    teamRef: d.teamRef,
    source: d.source == null ? Prisma.JsonNull : asJson(d.source),
    sourceExecutionPolicy: d.sourceExecutionPolicy,
    sourceReadOnly: d.sourceReadOnly,
    dataAsOf: dt(d.dataAsOf),
    generatedAt: new Date(d.generatedAt),
    staleAt: dt(d.staleAt),
    freshness: d.freshness,
    entitlementTier: d.entitlementTier,
    tokenCostClass: d.tokenCostClass,
    status: d.status,
    suppressionReason: d.suppressionReason,
    conflictGroupKey: d.conflictGroupKey,
    supersedesDecisionId: d.supersedes,
    producer: d.producer,
    producerVersion: d.producerVersion,
    runId: d.runId,
    extensions: d.extensions == null ? Prisma.JsonNull : asJson(d.extensions),
  }
}

/** Canonical decision → immutable revision content columns (identity: decisionId/runId/contentHash set by caller). */
function toRevisionWrite(d: CanonicalDecision) {
  return {
    producer: d.producer,
    producerVersion: d.producerVersion,
    status: d.status,
    supersedesDecisionId: d.supersedes,
    headline: d.headline,
    explanation: d.explanation,
    recommendedAction: d.recommendedAction,
    evidence: asJson(d.evidence),
    confidencePct: d.confidencePct,
    priorityScore: d.priorityScore,
    severity: d.severity,
    urgency: d.urgency,
    source: d.source == null ? Prisma.JsonNull : asJson(d.source),
    dataAsOf: dt(d.dataAsOf),
    generatedAt: new Date(d.generatedAt),
    staleAt: dt(d.staleAt),
    freshness: d.freshness,
    extensions: d.extensions == null ? Prisma.JsonNull : asJson(d.extensions),
  }
}

function mapRevisionRow(row: NonNullable<Awaited<ReturnType<PrismaLike['canonicalDecisionRevision']['findUnique']>>>): CanonicalDecisionRevision {
  return {
    decisionId: row.decisionId,
    runId: row.runId,
    contentHash: row.contentHash,
    producer: row.producer,
    producerVersion: row.producerVersion,
    status: row.status as CanonicalDecisionRevision['status'],
    supersedesDecisionId: row.supersedesDecisionId,
    headline: row.headline,
    explanation: row.explanation,
    recommendedAction: row.recommendedAction,
    evidence: (row.evidence ?? []) as DecisionEvidenceRef[],
    confidencePct: row.confidencePct,
    priorityScore: row.priorityScore,
    severity: row.severity as CanonicalDecisionRevision['severity'],
    urgency: row.urgency as CanonicalDecisionRevision['urgency'],
    source: (row.source ?? null) as DecisionSourceRef | null,
    dataAsOf: iso(row.dataAsOf),
    generatedAt: row.generatedAt.toISOString(),
    staleAt: iso(row.staleAt),
    freshness: row.freshness as CanonicalDecisionRevision['freshness'],
    extensions: (row.extensions ?? null) as Record<string, unknown> | null,
    createdAt: row.createdAt.toISOString(),
  }
}

export class PrismaCanonicalDecisionStore implements CanonicalDecisionStore {
  constructor(private readonly db: PrismaLike = defaultPrisma) {}

  async persistBatch(input: { decisions: CanonicalDecision[]; supersede: SupersedeLink[]; now: Date }): Promise<PersistBatchCounts> {
    return withWriteRetry(() =>
      this.db.$transaction(async (tx) => {
        let created = 0
        let updated = 0
        let staleSkipped = 0
        let superseded = 0
        let revised = 0
        let revisionConflicts = 0
        for (const d of input.decisions) {
          const runId = d.runId as string // boundary guarantees non-null (occurrence identity)
          const write = toWrite(d)

          // ── current state: lock the row, then apply only if the incoming generation is strictly newer ──
          const locked = await tx.$queryRaw<Array<{ generated_at: Date; run_id: string | null }>>(
            Prisma.sql`SELECT generated_at, run_id FROM canonical_decisions WHERE decision_id = ${d.decisionId} FOR UPDATE`,
          )
          if (locked.length === 0) {
            // No row yet — insert. A concurrent insert raises P2002 → the whole tx retries and takes the branch below.
            await tx.canonicalDecision.create({ data: { decisionId: d.decisionId, ...write } })
            created += 1
          } else {
            const existing = { generatedAt: locked[0]!.generated_at.toISOString(), runId: locked[0]!.run_id }
            if (isNewerGeneration({ generatedAt: d.generatedAt, runId: d.runId }, existing)) {
              await tx.canonicalDecision.update({ where: { decisionId: d.decisionId }, data: write })
              updated += 1
            } else {
              staleSkipped += 1 // older/equal generation → do not regress current state
            }
          }

          // ── revision: occurrence identity (decisionId, runId); content_hash detects same-run conflicts ──
          const contentHash = computeRevisionContentHash(d)
          const beforeRev = await tx.canonicalDecisionRevision.findUnique({
            where: { decisionId_runId: { decisionId: d.decisionId, runId } },
            select: { contentHash: true },
          })
          await tx.canonicalDecisionRevision.upsert({
            where: { decisionId_runId: { decisionId: d.decisionId, runId } },
            create: { decisionId: d.decisionId, runId, contentHash, ...toRevisionWrite(d) },
            update: {}, // immutable — a same-run conflict never overwrites the first occurrence
          })
          if (!beforeRev) {
            const after = await tx.canonicalDecisionRevision.findUnique({
              where: { decisionId_runId: { decisionId: d.decisionId, runId } },
              select: { contentHash: true },
            })
            if (after && after.contentHash === contentHash) revised += 1
            else revisionConflicts += 1 // a concurrent same-run writer's content won the occurrence
          } else if (beforeRev.contentHash !== contentHash) {
            revisionConflicts += 1 // same run, different content → first occurrence preserved
          }
        }
        for (const link of input.supersede) {
          const res = await tx.canonicalDecision.updateMany({
            where: { decisionId: link.oldDecisionId, status: { not: 'superseded' } },
            data: { status: 'superseded' },
          })
          superseded += res.count
        }
        return { created, updated, staleSkipped, superseded, revised, revisionConflicts }
      }),
    )
  }

  async get(decisionId: string): Promise<CanonicalDecision | null> {
    const row = await this.db.canonicalDecision.findUnique({ where: { decisionId } })
    return row ? mapRow(row) : null
  }

  async getRevisions(decisionId: string): Promise<CanonicalDecisionRevision[]> {
    const rows = await this.db.canonicalDecisionRevision.findMany({
      where: { decisionId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], // deterministic audit order
    })
    return rows.map(mapRevisionRow)
  }
}
