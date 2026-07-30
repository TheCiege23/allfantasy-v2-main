/**
 * Validation for canonical decisions (Phase 3A). PURE (zod only). The shadow store validates EVERY decision
 * before persisting — an invalid or identity-forged decision is rejected, never written.
 *
 * Enforces: known contract version; known category (taxonomy); enum-bounded classification fields; the immutable
 * read-only-source guarantee (`sourceReadOnly === true`); scope-required identity (a league/commissioner decision
 * must carry a leagueId, a portfolio decision a connectedFranchiseId, etc.); and IDENTITY INTEGRITY — the stored
 * fingerprint/decisionId must equal what `computeDecisionFingerprint` derives from the decision, so a forged or
 * hand-edited id is rejected. NFL and NCAAF validate identically (no NFL-only rule).
 */
import { z } from 'zod'
import { CANONICAL_DECISION_CONTRACT_VERSION, type CanonicalDecision } from './contract'
import { DECISION_CATEGORIES } from './taxonomy'
import { computeDecisionFingerprint, decisionIdFromFingerprint } from './identity'

const evidenceSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().min(1),
  sourceType: z.string().nullish(),
  sourceId: z.string().nullish(),
  observedAt: z.string().nullish(),
  url: z.string().nullish(),
  trust: z.enum(['high', 'medium', 'low', 'unverified']).optional(),
})

const playerSchema = z.object({
  canonicalPlayerId: z.string().nullish(),
  name: z.string().nullish(),
  position: z.string().nullish(),
  teamAbbr: z.string().nullish(),
})

const sourceSchema = z.object({
  platform: z.string().min(1),
  platformLeagueId: z.string().nullish(),
  platformEntityId: z.string().nullish(),
  deepLinkUrl: z.string().nullish(),
  snapshotId: z.string().nullish(),
  snapshotAt: z.string().nullish(),
})

const baseSchema = z.object({
  contractVersion: z.literal(CANONICAL_DECISION_CONTRACT_VERSION),
  decisionId: z.string().regex(/^dcn:[0-9a-f]{64}$/, 'decisionId must be dcn:<sha256hex>'),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/, 'fingerprint must be a sha256 hex digest'),
  userId: z.string().min(1).nullable(),
  leagueId: z.string().min(1).nullable(),
  connectedFranchiseId: z.string().min(1).nullable(),
  sourcePlatform: z.string().min(1).nullable(),
  sport: z.string().min(1),
  season: z.number().int().nullable(),
  period: z.string().min(1).nullable(),
  category: z.enum(DECISION_CATEGORIES),
  subtype: z.string().min(1).nullable(),
  scope: z.enum(['user', 'league', 'team', 'player', 'matchup', 'commissioner', 'portfolio']),
  audience: z.enum(['manager', 'commissioner', 'dual_role']),
  headline: z.string().min(1).max(300),
  explanation: z.string().min(1),
  recommendedAction: z.string().nullable(),
  evidence: z.array(evidenceSchema),
  confidencePct: z.number().min(0).max(100).nullable(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  urgency: z.enum(['none', 'this_week', 'today', 'now']),
  priorityScore: z.number().min(0).max(100).nullable(),
  expectedImpact: z.string().nullable(),
  players: z.array(playerSchema),
  teamRef: z.string().min(1).nullable(),
  source: sourceSchema.nullable(),
  sourceReadOnly: z.literal(true), // AF never writes to imported platforms — enforced structurally
  dataAsOf: z.string().nullable(),
  generatedAt: z.string().min(1),
  staleAt: z.string().nullable(),
  freshness: z.enum(['fresh', 'aging', 'stale', 'expired', 'unknown']),
  entitlementTier: z.enum(['free', 'subscription', 'tokens', 'commissioner']),
  tokenCostClass: z.enum(['free', 'included', 'token_billable', 'unknown']),
  status: z.enum(['active', 'superseded', 'suppressed', 'expired', 'resolved']),
  suppressionReason: z.string().nullable(),
  conflictGroupKey: z.string().min(1).nullable(),
  supersedes: z.string().min(1).nullable(),
  producer: z.string().min(1),
  producerVersion: z.string().min(1),
  runId: z.string().min(1).nullable(),
  extensions: z.record(z.unknown()).nullable(),
})

/** Scope → identity fields that must be present. Rejects a decision that claims a scope without its anchor. */
function scopeIdentityErrors(d: CanonicalDecision): string[] {
  const errs: string[] = []
  const needsLeague = d.scope === 'league' || d.scope === 'commissioner' || d.scope === 'team' || d.scope === 'matchup'
  if (needsLeague && !d.leagueId) errs.push(`scope '${d.scope}' requires leagueId`)
  if (d.scope === 'team' && !d.teamRef) errs.push(`scope 'team' requires teamRef`)
  if (d.scope === 'user' && !d.userId) errs.push(`scope 'user' requires userId`)
  if (d.scope === 'portfolio' && !d.connectedFranchiseId) errs.push(`scope 'portfolio' requires connectedFranchiseId`)
  if (d.scope === 'player' && !d.players.some((p) => p.canonicalPlayerId || p.name)) {
    errs.push(`scope 'player' requires at least one identified player`)
  }
  return errs
}

export type ValidationResult =
  | { ok: true; decision: CanonicalDecision }
  | { ok: false; errors: string[] }

/** Validate a candidate canonical decision. Returns typed errors; never throws on invalid input. */
export function validateCanonicalDecision(candidate: unknown): ValidationResult {
  const parsed = baseSchema.safeParse(candidate)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
  }
  const d = parsed.data as CanonicalDecision
  const errors = scopeIdentityErrors(d)

  // Identity integrity: the id/fingerprint MUST match what the identity of this decision derives to.
  const expected = computeDecisionFingerprint(d)
  if (d.fingerprint !== expected) errors.push('fingerprint does not match decision identity (forged or stale id)')
  if (d.decisionId !== decisionIdFromFingerprint(d.fingerprint)) errors.push('decisionId does not match fingerprint')

  return errors.length ? { ok: false, errors } : { ok: true, decision: d }
}

/** True when a persisted decision's contract version is one this build understands. */
export function isSupportedContractVersion(version: string): boolean {
  return version === CANONICAL_DECISION_CONTRACT_VERSION
}
