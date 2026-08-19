/**
 * Decision OS — Parity Gate binding for `manager.waiver.claim` (Slice 2).
 *
 * WRAP-FIDELITY parity: because the Decision OS path is fed the SAME deterministic suggestions the
 * legacy engine produced, this proves the Decision OS wrapper introduces NO drift when mapping
 * suggestions → claim recommendations. It does NOT prove independent recomputation equivalence (the
 * recommender is wrapped, not recomputed). Keyed by add-player (+ suggested drop), comparing the
 * stable deterministic fields only — the optional AI explanation is intentionally ignored.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import { compareKeyedParity, type ShadowParityResult } from '@/lib/decision-os/core/parity'
import type { ScoredWaiverTarget } from '@/lib/waiver-engine/waiver-scoring'
import type { WaiverClaimRecommendation } from './decision'
import { suggestionToRecommendation } from './decision'

export interface WaiverParityResult extends ShadowParityResult {
  /** Always true for Slice 2 — the recommender is wrapped, not recomputed. */
  wrapFidelity: true
  comparedClaims: number
}

function keyOf(r: WaiverClaimRecommendation): string {
  return `${r.addPlayerId}:${r.dropPlayerName ?? ''}`
}

/**
 * Compare the Decision OS recommended claims against the legacy engine's deterministic suggestions
 * (mapped through the same pure adapter). Optional AI prose is not part of the comparison.
 */
export function compareWaiverParity(
  decision: Decision<WaiverClaimRecommendation>,
  legacySuggestions: ScoredWaiverTarget[],
): WaiverParityResult {
  const legacy = legacySuggestions.map(suggestionToRecommendation)
  const result = compareKeyedParity(decision.recommended_actions, legacy, {
    keyOf,
    entityLabel: 'claim',
    fields: [
      { label: 'recommendation', valueOf: (r) => r.recommendation },
      { label: 'faabBid', valueOf: (r) => r.faabBid },
      { label: 'priorityRank', valueOf: (r) => r.priorityRank },
      { label: 'compositeScore', valueOf: (r) => r.compositeScore },
      { label: 'suggested drop', valueOf: (r) => r.dropPlayerName },
    ],
  })
  return { ...result, wrapFidelity: true, comparedClaims: result.comparedKeys }
}
