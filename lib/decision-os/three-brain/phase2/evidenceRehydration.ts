/**
 * Blocker 2 — safe evidence rehydration for refresh. A refresh must run on CURRENT evidence, never on the old
 * persisted snapshot: re-running a stale snapshot would give old analysis a false new `generatedAt`. This
 * contract resolves the latest authoritative evidence and rebuilds the request; the refresh job then:
 *   - if material evidence changed → uses the NEW canonical identity (a new run),
 *   - if evidence is unchanged → may reuse the existing result (extend TTL) WITHOUT provider spend,
 *   - if current evidence cannot be loaded → retains the stale result and records refresh failure (NOT fresh),
 *   - never refreshes a live-sensitive decision from non-live evidence.
 *
 * Dependency-injected + standalone. The DEFAULT is `noLiveSourceRehydrator`, which conservatively REFUSES to
 * refresh (no live evidence source is wired in Phase 2) so a refresh can never fabricate freshness. Phase 3
 * injects a real rehydrator backed by the deterministic evidence resolvers — no live-route wiring required to
 * supply one in tests.
 */
import type { IntelligenceRequestContext, IntelligenceRunRecord } from './types'

export type RehydratedEvidence = {
  ok: true
  /** The request rebuilt from CURRENT evidence. */
  ctx: IntelligenceRequestContext
  /** Version marker of the current evidence (used to detect material change vs the persisted run). */
  sourceDataVersion: string | null
  /** True only when the evidence was loaded from a live/current authoritative source. Required to refresh a
   *  live-sensitive decision. */
  isLiveEvidence: boolean
  evidenceLoadedAt: string
}
export type RehydrationFailure = { ok: false; reason: string }
export type RehydrationResult = RehydratedEvidence | RehydrationFailure

export interface EvidenceRehydrator {
  /** Resolve current authoritative evidence for a persisted run and rebuild its request context. */
  rehydrate(input: { run: IntelligenceRunRecord }): Promise<RehydrationResult>
}

/**
 * Standalone default: NO live evidence source is wired, so refuse to refresh. This guarantees a refresh never
 * bumps freshness from an old snapshot. Phase 3 replaces this with a rehydrator that loads current evidence.
 */
export const noLiveSourceRehydrator: EvidenceRehydrator = {
  async rehydrate() {
    return { ok: false, reason: 'no_live_evidence_source' }
  },
}
