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
import {
  CANONICAL_DECISION_CONTRACT_VERSION,
  isExternalSourcePlatform,
  type CanonicalDecision,
} from './contract'
import { DECISION_CATEGORIES } from './taxonomy'
import { computeDecisionFingerprint, decisionIdFromFingerprint } from './identity'

// ── Bounds. Constrained JSON must never become an unbounded metadata escape hatch, and every string must fit its
//    column, so oversized/abusive input is rejected BEFORE persistence (not truncated by the DB). ───────────────
const MAX_EVIDENCE = 50
const MAX_PLAYERS = 60
const MAX_EXTENSION_KEYS = 50
const MAX_EXTENSION_BYTES = 8 * 1024 // 8 KB serialized

const evidenceSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.string().min(1).max(48),
  label: z.string().min(1).max(300),
  sourceType: z.string().max(48).nullish(),
  sourceId: z.string().max(191).nullish(),
  observedAt: z.string().max(64).nullish(),
  url: z.string().max(2048).nullish(),
  trust: z.enum(['high', 'medium', 'low', 'unverified']).optional(),
})

const playerSchema = z.object({
  canonicalPlayerId: z.string().max(191).nullish(),
  name: z.string().max(191).nullish(),
  position: z.string().max(16).nullish(),
  teamAbbr: z.string().max(16).nullish(),
})

const sourceSchema = z.object({
  platform: z.string().min(1).max(24),
  platformLeagueId: z.string().max(191).nullish(),
  platformEntityId: z.string().max(191).nullish(),
  deepLinkUrl: z.string().max(2048).nullish(),
  snapshotId: z.string().max(191).nullish(),
  snapshotAt: z.string().max(64).nullish(),
})

/** Extensions: a bounded map — capped key count + serialized size — so it can't silently become the real contract. */
const extensionsSchema = z
  .record(z.unknown())
  .nullable()
  .refine((v) => v == null || Object.keys(v).length <= MAX_EXTENSION_KEYS, {
    message: `extensions may have at most ${MAX_EXTENSION_KEYS} keys`,
  })
  .refine((v) => v == null || JSON.stringify(v).length <= MAX_EXTENSION_BYTES, {
    message: `extensions serialized size must be <= ${MAX_EXTENSION_BYTES} bytes`,
  })

const baseSchema = z.object({
  contractVersion: z.literal(CANONICAL_DECISION_CONTRACT_VERSION),
  decisionId: z.string().regex(/^dcn:[0-9a-f]{64}$/, 'decisionId must be dcn:<sha256hex>'),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/, 'fingerprint must be a sha256 hex digest'),
  userId: z.string().min(1).max(191).nullable(),
  leagueId: z.string().min(1).max(191).nullable(),
  connectedFranchiseId: z.string().min(1).max(191).nullable(),
  sourcePlatform: z.string().min(1).max(24).nullable(),
  sport: z.string().min(1).max(16),
  season: z.number().int().nullable(),
  period: z.string().min(1).max(32).nullable(),
  category: z.enum(DECISION_CATEGORIES),
  subtype: z.string().min(1).max(48).nullable(),
  subjectKey: z.string().min(1).max(191).nullable(),
  scope: z.enum(['user', 'league', 'team', 'player', 'matchup', 'commissioner', 'portfolio']),
  audience: z.enum(['manager', 'commissioner', 'dual_role']),
  headline: z.string().min(1).max(300),
  explanation: z.string().min(1).max(5000),
  recommendedAction: z.string().max(2000).nullable(),
  evidence: z.array(evidenceSchema).max(MAX_EVIDENCE),
  confidencePct: z.number().min(0).max(100).nullable(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  urgency: z.enum(['none', 'this_week', 'today', 'now']),
  priorityScore: z.number().min(0).max(100).nullable(),
  expectedImpact: z.string().max(1000).nullable(),
  players: z.array(playerSchema).max(MAX_PLAYERS),
  teamRef: z.string().min(1).max(191).nullable(),
  source: sourceSchema.nullable(),
  sourceExecutionPolicy: z.enum(['external_read_only', 'advisory_only', 'native_actionable_dormant']),
  sourceReadOnly: z.boolean(), // consistency with the policy is checked in executionPolicyErrors()
  dataAsOf: z.string().max(64).nullable(),
  generatedAt: z.string().min(1).max(64),
  staleAt: z.string().max(64).nullable(),
  freshness: z.enum(['fresh', 'aging', 'stale', 'expired', 'unknown']),
  entitlementTier: z.enum(['free', 'subscription', 'tokens', 'commissioner']),
  tokenCostClass: z.enum(['free', 'included', 'token_billable', 'unknown']),
  status: z.enum(['active', 'superseded', 'suppressed', 'expired', 'resolved']),
  suppressionReason: z.string().max(128).nullable(),
  conflictGroupKey: z.string().min(1).max(191).nullable(),
  supersedes: z.string().min(1).max(191).nullable(),
  producer: z.string().min(1).max(64),
  producerVersion: z.string().min(1).max(32),
  runId: z.string().min(1).max(191).nullable(),
  extensions: extensionsSchema,
})

/** Execution/source policy invariants. Guarantees imported platforms stay strictly read-only and that a native
 *  actionable-later decision can never wear an external platform — and that `sourceReadOnly` matches the policy. */
function executionPolicyErrors(d: CanonicalDecision): string[] {
  const errs: string[] = []
  const external = isExternalSourcePlatform(d.sourcePlatform) || isExternalSourcePlatform(d.source?.platform)
  if (external && d.sourceExecutionPolicy === 'native_actionable_dormant') {
    errs.push('external source platform can never be native_actionable_dormant (imported platforms are read-only)')
  }
  if (external && d.sourceReadOnly !== true) {
    errs.push('external source platform requires sourceReadOnly=true')
  }
  const expectedReadOnly = d.sourceExecutionPolicy !== 'native_actionable_dormant'
  if (d.sourceReadOnly !== expectedReadOnly) {
    errs.push('sourceReadOnly is inconsistent with sourceExecutionPolicy (must be derived from it)')
  }
  return errs
}

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
  const errors = [...scopeIdentityErrors(d), ...executionPolicyErrors(d)]

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
