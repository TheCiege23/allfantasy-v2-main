/**
 * Deterministic identity + construction for canonical decisions (Phase 3A). PURE (node:crypto only).
 *
 * The fingerprint is computed over STABLE IDENTITY fields only (who/where/what-kind), NOT over content
 * (headline/explanation/scoring) or timestamps. So a later re-run that produces the SAME decision with refreshed
 * wording or confidence maps to the SAME fingerprint → SAME decisionId → an idempotent UPSERT, not a duplicate.
 * A materially different decision (different category/scope/entity/period) yields a different fingerprint.
 */
import { createHash } from 'node:crypto'
import {
  CANONICAL_DECISION_CONTRACT_VERSION,
  type CanonicalDecision,
  type CanonicalDecisionInput,
  type CanonicalDecisionRevision,
} from './contract'

/** The stable identity tuple. Order + normalization are fixed so the hash is reproducible across processes. */
function identityString(input: CanonicalDecisionInput): string {
  const players = (input.players ?? [])
    .map((p) => (p.canonicalPlayerId ?? p.name ?? '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|')
  const parts = [
    `v=${CANONICAL_DECISION_CONTRACT_VERSION}`,
    `u=${input.userId ?? ''}`,
    `l=${input.leagueId ?? ''}`,
    `cf=${input.connectedFranchiseId ?? ''}`,
    `pf=${input.sourcePlatform ?? ''}`,
    `sp=${(input.sport ?? '').toString().toUpperCase()}`,
    `sn=${input.season ?? ''}`,
    `pd=${input.period ?? ''}`,
    `cat=${input.category}`,
    `sub=${input.subtype ?? ''}`,
    `sc=${input.scope}`,
    `au=${input.audience}`,
    `tm=${input.teamRef ?? ''}`,
    `pl=${players}`,
    `cg=${input.conflictGroupKey ?? ''}`,
    `sk=${input.subjectKey ?? ''}`,
  ]
  return parts.join('\n')
}

/** Deterministic hex fingerprint of a decision's identity. */
export function computeDecisionFingerprint(input: CanonicalDecisionInput): string {
  return createHash('sha256').update(identityString(input)).digest('hex')
}

/** Stable decision id derived from the fingerprint — domain-prefixed so it never collides with other id spaces. */
export function decisionIdFromFingerprint(fingerprint: string): string {
  return `dcn:${fingerprint}`
}

/** Stable JSON for an array whose element order is not semantically meaningful (evidence). Sorted by a stable key
 *  so a mere REORDER does not change the content hash (→ not a spurious same-run conflict). */
function stableEvidence(evidence: CanonicalDecision['evidence']): string {
  const norm = (evidence ?? [])
    .map((e) => JSON.stringify({ id: e.id, kind: e.kind, label: e.label, sourceType: e.sourceType ?? null, sourceId: e.sourceId ?? null, url: e.url ?? null, trust: e.trust ?? null }))
    .sort()
  return JSON.stringify(norm)
}

/**
 * CONTENT integrity hash for a decision revision — NOT the occurrence identity (that is `(decisionId, runId)`).
 * Covers only the MATERIAL generated content (status, text, evidence [order-normalized], scoring, source,
 * freshness, supersession). It deliberately EXCLUDES `runId`, `decisionId`, and all timestamps
 * (`generatedAt`/`dataAsOf`/`staleAt`) + producer metadata, so a same-run retry that only re-stamps a timestamp or
 * reorders evidence is treated as an idempotent no-op, while genuinely different content is detected as a conflict.
 */
export function computeRevisionContentHash(d: CanonicalDecision): string {
  const parts = [
    `st=${d.status}`,
    `sup=${d.supersedes ?? ''}`,
    `hl=${d.headline}`,
    `ex=${d.explanation}`,
    `ra=${d.recommendedAction ?? ''}`,
    `ev=${stableEvidence(d.evidence)}`,
    `cf=${d.confidencePct ?? ''}`,
    `pr=${d.priorityScore ?? ''}`,
    `sv=${d.severity}`,
    `ur=${d.urgency}`,
    `ei=${d.expectedImpact ?? ''}`,
    `src=${JSON.stringify(d.source ?? null)}`,
    `fr=${d.freshness}`,
    `xt=${JSON.stringify(d.extensions ?? null)}`,
  ]
  return createHash('sha256').update(parts.join('\n')).digest('hex')
}

/**
 * Authoritative ordering for CURRENT STATE: is `incoming` a newer generation than `existing`? Primary key is
 * `generatedAt` (ISO, lexicographically comparable); ties break on `runId` (stable, deterministic). An older run
 * is never newer, so current state cannot be regressed by a stale/delayed write, and concurrent different-run
 * writes converge on the same winner regardless of arrival/commit order. Trust boundary: `generatedAt`/`runId` are
 * producer-supplied — a later phase with an authoritative monotonic run sequence should replace `generatedAt` as
 * the primary key; the tuple guarantees deterministic convergence given the inputs.
 */
export function isNewerGeneration(
  incoming: { generatedAt: string; runId: string | null },
  existing: { generatedAt: string; runId: string | null },
): boolean {
  if (incoming.generatedAt !== existing.generatedAt) return incoming.generatedAt > existing.generatedAt
  return (incoming.runId ?? '') > (existing.runId ?? '')
}

/** Extract the immutable content snapshot recorded as a revision. Requires a non-null runId (occurrence identity);
 *  the shadow boundary rejects null-runId decisions before persistence. */
export function toDecisionRevision(d: CanonicalDecision): CanonicalDecisionRevision {
  if (d.runId == null) throw new Error('canonical revision requires a non-null runId (occurrence identity)')
  return {
    decisionId: d.decisionId,
    runId: d.runId,
    contentHash: computeRevisionContentHash(d),
    producer: d.producer,
    producerVersion: d.producerVersion,
    status: d.status,
    supersedesDecisionId: d.supersedes,
    headline: d.headline,
    explanation: d.explanation,
    recommendedAction: d.recommendedAction,
    evidence: d.evidence,
    confidencePct: d.confidencePct,
    priorityScore: d.priorityScore,
    severity: d.severity,
    urgency: d.urgency,
    source: d.source,
    dataAsOf: d.dataAsOf,
    generatedAt: d.generatedAt,
    staleAt: d.staleAt,
    freshness: d.freshness,
    extensions: d.extensions,
  }
}

/**
 * Build a complete, canonical decision from producer-supplied fields. Stamps the contract version, deterministic
 * fingerprint + id, the immutable read-only-source guarantee, and safe defaults. Producers CANNOT override the
 * version, id, fingerprint, or `sourceReadOnly` — this is the only sanctioned constructor.
 */
export function buildCanonicalDecision(input: CanonicalDecisionInput): CanonicalDecision {
  const subjectKey = input.subjectKey ?? null
  const fingerprint = computeDecisionFingerprint({ ...input, subjectKey })
  const sourceExecutionPolicy = input.sourceExecutionPolicy ?? 'external_read_only'
  return {
    ...input,
    contractVersion: CANONICAL_DECISION_CONTRACT_VERSION,
    decisionId: decisionIdFromFingerprint(fingerprint),
    fingerprint,
    subjectKey,
    evidence: input.evidence ?? [],
    players: input.players ?? [],
    status: input.status ?? 'active',
    extensions: input.extensions ?? null,
    sourceExecutionPolicy,
    // DERIVED: only a native, actionable-later decision may be non-read-only. Producers cannot forge this.
    sourceReadOnly: sourceExecutionPolicy !== 'native_actionable_dormant',
  }
}
