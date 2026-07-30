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

/**
 * Content+run fingerprint for a decision REVISION. Covers the producing run and the mutable content (status,
 * text, evidence, scoring, source, freshness) — so retrying the SAME run with the SAME content is idempotent
 * (same hash → one revision row), while a different run OR materially changed content appends a new revision.
 * `runId` is included so a later no-op re-run by a different run is still traced as its own revision.
 */
export function computeRevisionHash(d: CanonicalDecision): string {
  const parts = [
    `did=${d.decisionId}`,
    `run=${d.runId ?? ''}`,
    `prod=${d.producer}@${d.producerVersion}`,
    `st=${d.status}`,
    `hl=${d.headline}`,
    `ex=${d.explanation}`,
    `ra=${d.recommendedAction ?? ''}`,
    `ev=${JSON.stringify(d.evidence ?? [])}`,
    `cf=${d.confidencePct ?? ''}`,
    `pr=${d.priorityScore ?? ''}`,
    `sv=${d.severity}`,
    `ur=${d.urgency}`,
    `src=${JSON.stringify(d.source ?? null)}`,
    `da=${d.dataAsOf ?? ''}`,
    `ga=${d.generatedAt}`,
    `sa=${d.staleAt ?? ''}`,
    `fr=${d.freshness}`,
    `xt=${JSON.stringify(d.extensions ?? null)}`,
  ]
  return createHash('sha256').update(parts.join('\n')).digest('hex')
}

/** Extract the immutable content snapshot recorded as a revision for a decision. */
export function toDecisionRevision(d: CanonicalDecision): CanonicalDecisionRevision {
  return {
    decisionId: d.decisionId,
    revisionHash: computeRevisionHash(d),
    runId: d.runId,
    producer: d.producer,
    producerVersion: d.producerVersion,
    status: d.status,
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
