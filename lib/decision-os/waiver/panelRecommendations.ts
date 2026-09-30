import type { WaiverClaimRecommendation } from './decision'

/**
 * The shape the AI waiver panel (components/waivers/AIWaiverRecommendationsPanel.tsx) renders — the
 * contract /api/ai/waivers/recommend has always returned, so the panel does not change.
 */
export interface WaiverPanelRecommendation {
  addPlayerId: string
  addPlayerName: string
  dropPlayerId: string | null
  dropPlayerName: string | null
  priority: number
  suggestedFaabBid: number | null
  confidence: 'high' | 'medium' | 'low'
  risk: 'high' | 'medium' | 'low'
  reasoning: string
  deeperAnalysisPath: string
  tags: string[]
}

/**
 * The engine's own conviction tier, read as risk. `Must Add` / `Strong Add` are the engine saying
 * the add clearly improves you; `Stash` / `Monitor` are it saying the upside is speculative. No new
 * judgement is made here — the label IS the engine's, and this only names its band.
 */
const RISK_BY_LABEL: Record<WaiverClaimRecommendation['recommendation'], WaiverPanelRecommendation['risk']> = {
  'Must Add': 'low',
  'Strong Add': 'low',
  Add: 'medium',
  Stash: 'high',
  Monitor: 'high',
}

/** The same bands `decideWaiverClaim` uses for its own confidence sentence (≥80 high, ≥50 medium). */
function confidenceBand(score: number): WaiverPanelRecommendation['confidence'] {
  return score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low'
}

/**
 * Decision OS claim recommendations → the panel's rows, in the engine's own priority order.
 *
 * `includeFaab` false drops the bid (a rolling-waiver league, or the caller asked not to see one).
 * `limit` is the panel's quick (3) / deep (5) count.
 */
export function claimsToPanelRecommendations(
  claims: readonly WaiverClaimRecommendation[],
  opts: { leagueId: string; includeFaab: boolean; limit: number },
): WaiverPanelRecommendation[] {
  return [...claims]
    .sort((a, b) => a.priorityRank - b.priorityRank)
    .slice(0, Math.max(0, opts.limit))
    .map((c, i) => ({
      addPlayerId: c.addPlayerId,
      addPlayerName: c.addPlayerName,
      dropPlayerId: c.dropPlayerId,
      dropPlayerName: c.dropPlayerName,
      priority: i + 1,
      suggestedFaabBid: opts.includeFaab ? c.faabBid : null,
      confidence: confidenceBand(c.compositeScore),
      risk: RISK_BY_LABEL[c.recommendation] ?? 'medium',
      reasoning: c.reason,
      deeperAnalysisPath: `/chimmy/chat?topic=waiver-analysis&leagueId=${encodeURIComponent(opts.leagueId)}`,
      tags: [c.position, c.recommendation].filter(Boolean),
    }))
}
