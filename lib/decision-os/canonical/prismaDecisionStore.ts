/**
 * Prisma-backed canonical decision store (Phase 3A). SERVER-ONLY. Implements `CanonicalDecisionStore` against the
 * additive `canonical_decisions` (current state) + `canonical_decision_revisions` (immutable audit history) tables.
 *
 * `persistBatch` runs in ONE interactive transaction (atomic batch) and is RACE-SAFE for concurrent writers:
 *   - current state is written with a native atomic upsert keyed on the unique `decisionId` (INSERT … ON CONFLICT
 *     DO UPDATE), so two concurrent writers converge on ONE row instead of one throwing a duplicate;
 *   - each run/content appends an immutable revision, idempotent on the unique (decisionId, revisionHash);
 *   - the whole batch is wrapped in a BOUNDED retry that re-runs ONLY on a unique-constraint (P2002) or
 *     write-conflict/deadlock (P2034) — every other error is rethrown immediately, and the last error is rethrown
 *     after the attempts are exhausted (no blanket error swallowing).
 * It does NO validation (the boundary already validated), NO provider call, NO token work, and NO freshness
 * minting — a pure persistence sink. It is never invoked unless `shadowPersistDecisions` (flag + shadow-mode
 * gated) calls it, so deploying this code writes nothing on its own. Injectable Prisma client for isolated-DB
 * integration tests (never production here).
 *
 * NOTE on counts: `created`/`updated`/`revised` are derived from a pre-read for observability. Under genuine
 * concurrency the split may be approximate (two racers may both report `created`), but the persisted STATE is
 * always exactly one row per decisionId and one revision per (decisionId, revisionHash).
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
import { computeRevisionHash } from './identity'

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
 *  retry (the second attempt sees the row and updates). Rethrows non-retryable errors at once and the last error
 *  after exhausting attempts. */
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

/** Canonical decision → immutable revision write payload (content snapshot only). */
function toRevisionWrite(d: CanonicalDecision) {
  return {
    runId: d.runId,
    producer: d.producer,
    producerVersion: d.producerVersion,
    status: d.status,
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
    revisionHash: row.revisionHash,
    runId: row.runId,
    producer: row.producer,
    producerVersion: row.producerVersion,
    status: row.status as CanonicalDecisionRevision['status'],
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
        let superseded = 0
        let revised = 0
        for (const d of input.decisions) {
          const write = toWrite(d)
          // Pre-read for the created/updated count only — the write below is atomic regardless.
          const before = await tx.canonicalDecision.findUnique({ where: { decisionId: d.decisionId }, select: { id: true } })
          // Race-safe native upsert: INSERT … ON CONFLICT (decision_id) DO UPDATE. No TOCTOU window.
          await tx.canonicalDecision.upsert({
            where: { decisionId: d.decisionId },
            create: { decisionId: d.decisionId, ...write },
            update: write,
          })
          if (before) updated += 1
          else created += 1

          // Append-only revision, idempotent on the unique (decisionId, revisionHash).
          const revisionHash = computeRevisionHash(d)
          const existingRev = await tx.canonicalDecisionRevision.findUnique({
            where: { decisionId_revisionHash: { decisionId: d.decisionId, revisionHash } },
            select: { id: true },
          })
          await tx.canonicalDecisionRevision.upsert({
            where: { decisionId_revisionHash: { decisionId: d.decisionId, revisionHash } },
            create: { decisionId: d.decisionId, revisionHash, ...toRevisionWrite(d) },
            update: {}, // immutable — conflict is a no-op (retry-safe)
          })
          if (!existingRev) revised += 1
        }
        for (const link of input.supersede) {
          const res = await tx.canonicalDecision.updateMany({
            where: { decisionId: link.oldDecisionId, status: { not: 'superseded' } },
            data: { status: 'superseded' },
          })
          superseded += res.count
        }
        return { created, updated, superseded, revised }
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
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(mapRevisionRow)
  }
}
