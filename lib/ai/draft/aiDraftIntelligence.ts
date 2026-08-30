/**
 * Draft intelligence: deterministic signals + hooks for LLM explanation.
 * Complements RecommendationEngine / War Room without replacing them.
 */

import { computeDraftRecommendation, type RecommendationPlayer } from '@/lib/draft-helper/RecommendationEngine'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getPlayerMarketSignal } from '@/lib/ai/memory/aiMemory'

export type DraftIntelligenceSnapshot = {
  bestPick: RecommendationPlayer | null
  valueVsMarket: number
  platformAdp: number | null
  leagueVsPlatformAdpDelta: number | null
  reachVsPlatform: number | null
  personalizedFitScore: number
  formatFitScore: number
  riskScore: number
  confidenceScore: number
  insightLines: string[]
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Build a deterministic draft snapshot for UI + optional LLM narrative.
 */
export async function buildDraftIntelligenceSnapshot(input: {
  sport: string
  season: number
  /** Sleeper/player id when known — improves market signal lookup */
  bestPickPlayerId?: string | null
  available: RecommendationPlayer[]
  teamRoster: Array<{ position: string; team?: string | null; byeWeek?: number | null }>
  rosterSlots: string[]
  round: number
  pickInRound: number
  totalTeams: number
  isDynasty?: boolean
  isSuperflex?: boolean
  platformAdp?: number | null
  leagueEarlyWrRate?: number | null
  draftEligiblePositions?: ReadonlySet<string>
}): Promise<DraftIntelligenceSnapshot> {
  const sport = normalizeToSupportedSport(input.sport)
  const det = computeDraftRecommendation({
    available: input.available,
    teamRoster: input.teamRoster,
    rosterSlots: input.rosterSlots,
    round: input.round,
    pick: input.pickInRound,
    totalTeams: input.totalTeams,
    sport,
    isDynasty: Boolean(input.isDynasty),
    isSF: Boolean(input.isSuperflex),
    mode: 'needs',
    draftEligiblePositions: input.draftEligiblePositions,
  })

  const best = det.recommendation?.player ?? null
  const platformAdp = input.platformAdp ?? best?.adp ?? null
  /*
   * 🛑 `adpEdge` IS ONLY A MARKET COMPARISON WHEN THE ADP IS REAL.
   *
   * `computeDraftRecommendation` is called above WITHOUT `aiAdpByKey`, so any player the
   * market has not priced gets the synthetic `overall + 20` prior — against which `adpEdge`
   * evaluates to exactly -20 at EVERY pick (clamped). A field named `valueVsMarket` was
   * therefore reporting a fixed -20 "market" verdict for unpriced players, and the reach line
   * below fired on 100% of picks for a wholly unpriced pool (devy / NCAAF / rookies).
   *
   * Zero is the honest value: no measured difference from a market that did not price them.
   */
  const adpIsReal = det.recommendation?.adpIsReal ?? false
  const valueVsMarket = adpIsReal ? clamp(det.recommendation?.adpEdge ?? 0, -40, 40) : 0

  let leagueVsPlatformAdpDelta: number | null = null
  if (input.leagueEarlyWrRate != null) {
    leagueVsPlatformAdpDelta = clamp((input.leagueEarlyWrRate - 0.28) * 40, -15, 15)
  }

  let marketNotes: string[] = []
  if (input.bestPickPlayerId) {
    const sig = await getPlayerMarketSignal(input.bestPickPlayerId, sport, input.season)
    marketNotes = sig.notes
  }

  // Gated for the same reason as `valueVsMarket`: without a real ADP this is the -20 prior,
  // not a reach, and it would exceed the threshold below on every pick.
  const reachVsPlatform =
    adpIsReal && det.recommendation != null && det.recommendation.adpEdge < -8
      ? Math.abs(det.recommendation.adpEdge)
      : null

  const personalizedFitScore = clamp(60 + valueVsMarket * 1.2 + (det.recommendation?.needScore ?? 50) * 0.25, 0, 100)
  const formatFitScore = clamp(55 + (input.isSuperflex ? 8 : 0) + (input.isDynasty ? 5 : 0), 0, 100)
  const riskScore = clamp(100 - (det.recommendation?.confidence ?? 50), 0, 100)
  const confidenceScore = clamp(det.recommendation?.confidence ?? 55, 0, 100)

  const insightLines: string[] = [
    det.explanation?.slice(0, 200) ?? 'Board-driven recommendation.',
    ...marketNotes,
  ]
  if (leagueVsPlatformAdpDelta != null && Math.abs(leagueVsPlatformAdpDelta) > 3) {
    insightLines.push(
      leagueVsPlatformAdpDelta > 0
        ? 'This league trends earlier at WR vs platform average — adjust tiers.'
        : 'This league is patient at WR vs platform — value may slide.',
    )
  }
  if (reachVsPlatform != null && reachVsPlatform > 10) {
    insightLines.push('Current pick is a reach vs platform ADP — confirm role/usage upside.')
  }

  return {
    bestPick: best,
    valueVsMarket,
    platformAdp,
    leagueVsPlatformAdpDelta,
    reachVsPlatform,
    personalizedFitScore,
    formatFitScore,
    riskScore,
    confidenceScore,
    insightLines,
  }
}
