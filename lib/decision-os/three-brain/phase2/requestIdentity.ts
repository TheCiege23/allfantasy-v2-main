/**
 * 2A — Canonical request identity. Deterministic, tenant-scoped, and versioned. Two semantically identical
 * requests resolve to the SAME key; any input that can change the answer (evidence fingerprint, league, team,
 * decision type, week/date, source-data version, options, or a prompt/schema/contract version bump) produces a
 * NEW key. The userId is folded into BOTH the hash and the key so one user can never collide with — or reuse —
 * another user's private result (defense in depth alongside the store's per-user query filter).
 *
 * Reuses the repo's `buildAiInputHash` (stable-stringify + sha256) so hashing is consistent with the existing
 * AiResult cache. No secrets or raw credentials enter the hash.
 */
import { buildAiInputHash } from '@/lib/ai/ai-result-cache'
import { THREE_BRAIN_SCHEMA_VERSION } from '../types'
import {
  INTELLIGENCE_CONTRACT_VERSION,
  INTELLIGENCE_PROMPT_VERSION,
  type IntelligenceRequestContext,
  type IntelligenceRequestIdentity,
} from './types'

/** Combined version tag; a change to any component invalidates older persisted results. */
export function intelligenceVersionTag(): string {
  return `c${INTELLIGENCE_CONTRACT_VERSION}.s${THREE_BRAIN_SCHEMA_VERSION}.p${INTELLIGENCE_PROMPT_VERSION}`
}

function normalizeOptions(options?: Record<string, unknown>): Record<string, unknown> | null {
  if (!options) return null
  // Drop undefined values; buildAiInputHash's stableStringify already sorts keys deterministically.
  const entries = Object.entries(options).filter(([, v]) => v !== undefined)
  return entries.length ? Object.fromEntries(entries) : null
}

/**
 * Compute the canonical identity. The evidence packet's `evidenceFingerprint` already captures the
 * decision-relevant league/roster/signal/fact/freshness state, so materially-changed league data yields a new
 * fingerprint → new identity. We additionally fold in the routing/scope/version inputs the fingerprint omits.
 */
export function computeIntelligenceRequestIdentity(
  ctx: IntelligenceRequestContext,
): IntelligenceRequestIdentity {
  const versionTag = intelligenceVersionTag()
  const leagueId = ctx.packet.canonicalLeagueId ?? null
  const userId = ctx.userId

  // The canonical payload — everything capable of changing the answer, EXCLUDING secrets/credentials.
  const payload = {
    tool: ctx.tool,
    operation: ctx.operation ?? null,
    userId, // tenant scoping — different users never share a key
    leagueId,
    connectedGroupId: ctx.connectedGroupId ?? null,
    platform: ctx.packet.platform ?? null,
    platformLeagueId: ctx.packet.platformLeagueId ?? null,
    teamOrRosterId: ctx.packet.teamOrRosterId ?? null,
    userRole: ctx.packet.userRole ?? null,
    sport: ctx.packet.sport,
    season: ctx.packet.season ?? null,
    week: ctx.week ?? null,
    dateContext: ctx.dateContext ?? null,
    decisionType: ctx.packet.decisionType,
    mode: ctx.packet.mode,
    // The deterministic server-owned fingerprint over signals/facts/freshness/missing info.
    evidenceFingerprint: ctx.packet.evidenceFingerprint,
    sourceDataVersion: ctx.sourceDataVersion ?? null,
    options: normalizeOptions(ctx.options),
  }

  const inputHash = buildAiInputHash({
    feature: `decision_os_intel:${ctx.tool}`,
    scopeType: 'user',
    scopeId: userId, // per-user scope in the hash input
    model: versionTag, // version participates in the hash
    payload,
  })

  // LENGTH-SAFE, collision-resistant key. userId + leagueId are already folded into `inputHash` (and enforced
  // again by the store's per-user query filter), so they are NOT concatenated literally here — that keeps the
  // key BOUNDED (`intel:` + tool enum + version tag + 64-hex hash ≈ ≤120 chars) regardless of how long a userId
  // or leagueId is, so it always fits result_key / idempotency_key (VarChar 255). The full user/league linkage
  // is preserved on the DecisionIntelligenceRun columns (userId, leagueId) + this hash.
  const identityKey = `intel:${ctx.tool}:v:${versionTag}:${inputHash}`

  return {
    identityKey,
    inputHash,
    versionTag,
    scopeUserId: userId,
    scopeLeagueId: leagueId,
    metadata: {
      tool: ctx.tool,
      decisionType: ctx.packet.decisionType,
      sport: ctx.packet.sport,
      season: ctx.packet.season ?? null,
      week: ctx.week ?? null,
      evidenceFingerprint: ctx.packet.evidenceFingerprint,
      sourceDataVersion: ctx.sourceDataVersion ?? null,
      versionTag,
      reusedBecause: 'identity_matched_and_fresh',
    },
  }
}
