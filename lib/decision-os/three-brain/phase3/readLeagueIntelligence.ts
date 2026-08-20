import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { buildLeagueIntelligenceEvidence } from '../phase2/leagueEvidenceResolver'
import { computeIntelligenceRequestIdentity } from '../phase2/requestIdentity'
import { classifyStoredRun, resolveFreshnessPolicy } from '../phase2/freshnessPolicy'
import { PrismaIntelligenceResultStore, realFeatureChecker, realLeagueChecker } from '../phase2/realAdapters'
import { resolveIntelligenceAccess } from '../phase2/entitlementPolicy'
import type { FreshnessClass, IntelligenceTool } from '../phase2/types'
import type { ThreeBrainDecisionResult } from '../types'

type PrismaLike = typeof defaultPrisma

/**
 * Phase 3 — the READ half of route integration.
 *
 * Decision OS routes are GETs that render a dashboard. They must NOT be the thing that triggers
 * generation: `runManagedIntelligence` executes the orchestration synchronously when it wins the
 * single-flight claim, so calling it from a GET would make the first visitor to any league wait on
 * three live provider calls and pay the tokens for them — on a page load they did not ask to spend
 * anything on.
 *
 * So this is a strictly DB-first READ. It resolves the caller's canonical identity, returns the
 * persisted run if one exists, and otherwise reports honestly that nothing has been generated yet.
 * It never claims, never calls a provider, never spends a token, and never writes. Generation stays
 * with the maintenance cron (`/api/cron/decision-os-intelligence-maintenance`).
 *
 * The honesty contract matters more here than anywhere else in the stack: a Decision OS surface
 * with no analysis must say it has none. Returning an empty-but-successful shape is how a product
 * starts fabricating — the UI renders confident-looking structure over nothing. Every non-`ready`
 * state below carries a machine-readable `reason` instead of a plausible-looking blank.
 */
export type LeagueIntelligenceStatus =
  /** A completed analysis, within its freshness window. */
  | 'ready'
  /** A completed analysis that is past its TTL. The result is still returned — clearly marked. */
  | 'stale'
  /** A run is in flight (this caller's or a coalesced one). No result yet. */
  | 'generating'
  /** Nothing has ever been generated for this exact evidence. Not an error. */
  | 'not_generated'
  /** The league has no persisted behavioral evidence to analyze. Not an error. */
  | 'evidence_unavailable'
  /** Scope this resolver cannot rebuild (e.g. a connected league group). */
  | 'unsupported_scope'
  /** A prior run failed. `reason` carries the category, never the provider's raw error. */
  | 'failed'
  /**
   * An analysis may exist, but this user is not entitled to SEE it. Distinct from `not_generated`
   * on purpose: the honest answer is "this is behind the paywall", not "there is nothing here", and
   * a client should offer the upgrade rather than a generate button that would be refused.
   */
  | 'locked'

export type LeagueIntelligenceRead = {
  status: LeagueIntelligenceStatus
  /** Populated ONLY for `ready` / `stale`. Null in every other state — never a placeholder. */
  result: ThreeBrainDecisionResult | null
  generatedAt: string | null
  expiresAt: string | null
  freshness: FreshnessClass | null
  /** Which providers participated. Safe attribution only — no raw responses or reasoning. */
  providerAttribution: Record<string, string> | null
  orchestrationVersion: string | null
  reason: string | null
}

function empty(status: LeagueIntelligenceStatus, reason: string | null, version: string | null): LeagueIntelligenceRead {
  return {
    status,
    result: null,
    generatedAt: null,
    expiresAt: null,
    freshness: null,
    providerAttribution: null,
    orchestrationVersion: version,
    reason,
  }
}

/**
 * Read the persisted three-brain analysis for one league + tool. Degraded-safe by construction:
 * every failure path is a typed status, so a caller can render an honest state rather than a 500.
 */
export async function readLeagueIntelligence(input: {
  db?: PrismaLike
  leagueId: string
  userId: string
  tool: IntelligenceTool
  decisionType: string
  connectedGroupId?: string | null
}): Promise<LeagueIntelligenceRead> {
  // NEVER THROW. The routes that call this document a degraded-safe contract — "a pipeline failure
  // returns honest nulls, not a 500" — and this block is what makes that true for the intelligence
  // half. Without it a transient DB error while resolving OPTIONAL, additive analysis would take down
  // the deterministic payload beside it, which is the part the surface actually needs.
  try {
    return await readLeagueIntelligenceUnsafe(input)
  } catch {
    // `evidence_unavailable` is the honest user-facing status (we cannot show analysis); the distinct
    // reason keeps it diagnosable and stops a resolver fault from masquerading as "this league has no data".
    return empty('evidence_unavailable', 'resolver_error', null)
  }
}

async function readLeagueIntelligenceUnsafe(input: {
  db?: PrismaLike
  leagueId: string
  userId: string
  tool: IntelligenceTool
  decisionType: string
  connectedGroupId?: string | null
}): Promise<LeagueIntelligenceRead> {
  const db = input.db ?? defaultPrisma

  // 1) Rebuild the evidence that defines this request's identity. This is also the honest gate:
  //    no persisted behavioral evidence → nothing legitimate to show, and nothing to invent.
  const evidence = await buildLeagueIntelligenceEvidence({
    db,
    leagueId: input.leagueId,
    userId: input.userId,
    tool: input.tool,
    decisionType: input.decisionType,
    connectedGroupId: input.connectedGroupId ?? null,
  })
  if (!evidence.ok) {
    const unsupported = evidence.reason === 'connected_group_refresh_unsupported'
    return empty(unsupported ? 'unsupported_scope' : 'evidence_unavailable', evidence.reason, null)
  }

  // 2) Canonical identity — the same key the writer uses, so a run generated by the cron is found
  //    here. Deriving it from the evidence (not from request params) is what makes changed league
  //    data miss the cache instead of serving a stale answer under a matching key.
  const identity = computeIntelligenceRequestIdentity(evidence.ctx)

  // 2b) ENTITLEMENT. Generating is already gated, but reading has to be gated too — otherwise a
  // user who generated while entitled (or whose plan later lapsed) keeps reading AI output for
  // free forever. Checked BEFORE the store read so an unentitled caller never even loads the row.
  const access = await resolveIntelligenceAccess({
    ctx: evidence.ctx,
    featureChecker: realFeatureChecker,
    leagueChecker: realLeagueChecker,
  })
  if (!access.ok) {
    return empty('locked', access.denyReason, identity.versionTag)
  }

  // 3) DB-first read. No claim, no lease, no provider call.
  const store = new PrismaIntelligenceResultStore(db)
  const run = await store.findByIdentity({ identityKey: identity.identityKey, userId: input.userId })
  if (!run) return empty('not_generated', 'no_run_for_current_evidence', identity.versionTag)

  const freshness = classifyStoredRun({
    run,
    policy: resolveFreshnessPolicy(input.decisionType),
    now: new Date(),
    currentVersionTag: identity.versionTag,
  })

  const base = {
    generatedAt: run.completedAt?.toISOString() ?? null,
    expiresAt: run.expiresAt?.toISOString() ?? null,
    providerAttribution: run.providerParticipation,
    orchestrationVersion: identity.versionTag,
  }

  switch (freshness) {
    case 'fresh':
    case 'stale': {
      // Guard the contract rather than trusting the classifier: only a succeeded run with an
      // actual payload may be surfaced as an answer.
      if (run.status !== 'succeeded' || !run.resultJson) {
        return empty('not_generated', 'no_result_payload', identity.versionTag)
      }
      return { status: freshness === 'fresh' ? 'ready' : 'stale', result: run.resultJson, freshness, reason: null, ...base }
    }
    case 'running':
      return { ...empty('generating', 'run_in_flight', identity.versionTag), freshness }
    case 'failed_retryable':
    case 'failed_terminal':
      return { ...empty('failed', run.failureCategory ?? 'internal', identity.versionTag), freshness }
    // A version/evidence change invalidates the stored answer: it described different data, so it
    // is not an answer to THIS question any more.
    case 'invalidated':
    case 'miss':
    default:
      return { ...empty('not_generated', 'evidence_changed_since_last_run', identity.versionTag), freshness }
  }
}
