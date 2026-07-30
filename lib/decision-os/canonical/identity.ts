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
 * Build a complete, canonical decision from producer-supplied fields. Stamps the contract version, deterministic
 * fingerprint + id, the immutable read-only-source guarantee, and safe defaults. Producers CANNOT override the
 * version, id, fingerprint, or `sourceReadOnly` — this is the only sanctioned constructor.
 */
export function buildCanonicalDecision(input: CanonicalDecisionInput): CanonicalDecision {
  const fingerprint = computeDecisionFingerprint(input)
  return {
    ...input,
    contractVersion: CANONICAL_DECISION_CONTRACT_VERSION,
    decisionId: decisionIdFromFingerprint(fingerprint),
    fingerprint,
    evidence: input.evidence ?? [],
    players: input.players ?? [],
    status: input.status ?? 'active',
    extensions: input.extensions ?? null,
    sourceReadOnly: true,
  }
}
