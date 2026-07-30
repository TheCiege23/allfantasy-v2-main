/**
 * Prisma-backed canonical decision store (Phase 3A). SERVER-ONLY. Implements `CanonicalDecisionStore` against the
 * additive `canonical_decisions` table. `persistBatch` runs in ONE transaction: upsert-by-`decisionId` (the unique
 * key → idempotent, retry-safe) plus status-gated supersession. It does NO validation (the boundary already
 * validated), NO provider call, NO token work, and NO freshness minting — it is a pure persistence sink.
 *
 * It is never invoked unless `shadowPersistDecisions` (flag + shadow-mode gated) calls it, so deploying this code
 * writes nothing on its own. Injectable Prisma client for isolated-DB integration tests (never production here).
 */
import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import type { CanonicalDecision, DecisionEvidenceRef, DecisionPlayerRef, DecisionSourceRef } from './contract'
import type { CanonicalDecisionStore, SupersedeLink } from './decisionStore'

type PrismaLike = typeof defaultPrisma
const asJson = (v: unknown): Prisma.InputJsonValue => v as unknown as Prisma.InputJsonValue
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)
const dt = (s: string | null | undefined): Date | null => (s ? new Date(s) : null)

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
    sourceReadOnly: true,
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
    sourceReadOnly: true,
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

export class PrismaCanonicalDecisionStore implements CanonicalDecisionStore {
  constructor(private readonly db: PrismaLike = defaultPrisma) {}

  async persistBatch(input: { decisions: CanonicalDecision[]; supersede: SupersedeLink[]; now: Date }): Promise<{ created: number; updated: number; superseded: number }> {
    return this.db.$transaction(async (tx) => {
      let created = 0
      let updated = 0
      let superseded = 0
      for (const d of input.decisions) {
        const write = toWrite(d)
        const existing = await tx.canonicalDecision.findUnique({ where: { decisionId: d.decisionId }, select: { id: true } })
        if (existing) {
          await tx.canonicalDecision.update({ where: { decisionId: d.decisionId }, data: write })
          updated += 1
        } else {
          await tx.canonicalDecision.create({ data: { decisionId: d.decisionId, ...write } })
          created += 1
        }
      }
      for (const link of input.supersede) {
        const res = await tx.canonicalDecision.updateMany({
          where: { decisionId: link.oldDecisionId, status: { not: 'superseded' } },
          data: { status: 'superseded' },
        })
        superseded += res.count
      }
      return { created, updated, superseded }
    })
  }

  async get(decisionId: string): Promise<CanonicalDecision | null> {
    const row = await this.db.canonicalDecision.findUnique({ where: { decisionId } })
    return row ? mapRow(row) : null
  }
}
