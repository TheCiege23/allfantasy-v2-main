import type { WaiverClaimRecommendation } from './decision'
import { calibrateWaiverScore, waiverBandFor, type WaiverCalibration } from './calibration'

/**
 * The shape the AI waiver panel (components/waivers/AIWaiverRecommendationsPanel.tsx) renders — the
 * contract /api/ai/waivers/recommend has always returned, so the panel does not change.
 */
interface WaiverPanelRecommendation {
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

/**
 * The same bands `decideWaiverClaim` uses for its own confidence sentence (≥80 high, ≥50 medium), after the
 * engine's graded record has corrected the score (±10 at most; `calibration.ts`). The record is by band, so
 * every row is corrected by its own band's — and the ORDER is untouched: rows stay in the engine's priority.
 */
function confidenceBand(score: number, calibration: WaiverCalibration | null | undefined): WaiverPanelRecommendation['confidence'] {
  return waiverBandFor(calibrateWaiverScore(score, calibration)?.score ?? score)
}

/**
 * Decision OS claim recommendations → the panel's rows, in the engine's own priority order.
 *
 * `includeFaab` false drops the bid (a rolling-waiver league, or the caller asked not to see one).
 * `limit` is the panel's quick (3) / deep (5) count.
 */
export function claimsToPanelRecommendations(
  claims: readonly WaiverClaimRecommendation[],
  opts: { leagueId: string; includeFaab: boolean; limit: number; calibration?: WaiverCalibration | null },
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
      confidence: confidenceBand(c.compositeScore, opts.calibration),
      risk: RISK_BY_LABEL[c.recommendation] ?? 'medium',
      reasoning: c.reason,
      deeperAnalysisPath: `/chimmy/chat?topic=waiver-analysis&leagueId=${encodeURIComponent(opts.leagueId)}`,
      tags: [c.position, c.recommendation].filter(Boolean),
    }))
}
