import {
  computeDraftPlayerRankings,
  type DraftPlayerRankingRow,
  type RecommendationInput,
  type RecommendationPlayer,
} from '@/lib/draft-helper/RecommendationEngine'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { BoardTierSummary, LiveDraftAssistantMode, PickScoreBreakdown, RankedPickCandidate, WaitOrTake } from './types'
import { getSportAdapterWeights } from './sport-adapters'

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function mapAdpEdgeToScore(adpEdge: number): number {
  return clamp(Math.round(((adpEdge + 20) / 45) * 100), 0, 100)
}

function mapPoolScarcity(pos: string, available: RecommendationPlayer[], totalTeams: number): number {
  const p = pos.toUpperCase()
  const cnt = available.filter((a) => String(a.position || '').toUpperCase() === p).length
  const threshold = Math.max(3, Math.ceil(totalTeams * 0.35))
  if (cnt <= 2) return 95
  if (cnt <= threshold) return 70
  return clamp(40 + cnt * 2, 0, 100)
}

function waitOrTake(row: DraftPlayerRankingRow, overall: number, scarcityHigh: boolean): WaitOrTake {
  if (row.adp < overall - 8 && scarcityHigh) return 'take_now'
  if (row.adp > overall + 6) return 'safe_to_wait'
  if (scarcityHigh && row.needScore >= 65) return 'unlikely_to_return'
  if (row.adpEdge > 6) return 'take_now'
  return 'safe_to_wait'
}

export function mapBrainModeToEngineMode(mode: LiveDraftAssistantMode): 'bpa' | 'needs' {
  switch (mode) {
    case 'bpa':
    case 'trade_up':
    case 'trade_down':
      return 'bpa'
    case 'balanced':
    case 'balanced_build':
    case 'upside':
    case 'safe':
    case 'needs':
    case 'win_now':
    case 'future_value':
    case 'positional_run_defense':
    case 'zero_rb':
    case 'hero_rb':
    case 'stars_and_scrubs':
    default:
      return 'needs'
  }
}

function applyModeBiasToBreakdown(
  mode: LiveDraftAssistantMode,
  b: PickScoreBreakdown
): PickScoreBreakdown {
  const next = { ...b }
  if (mode === 'upside' || mode === 'stars_and_scrubs') {
    next.ceilingScore = clamp(next.ceilingScore + 12, 0, 100)
    next.draftRiskScore = clamp(next.draftRiskScore + 8, 0, 100)
  }
  if (mode === 'safe' || mode === 'win_now') {
    next.floorScore = clamp(next.floorScore + 10, 0, 100)
    next.draftRiskScore = clamp(next.draftRiskScore - 6, 0, 100)
  }
  if (mode === 'future_value') {
    next.futureFlexibilityScore = clamp(next.futureFlexibilityScore + 12, 0, 100)
  }
  next.pickScore = recomputePickScore(next)
  return next
}

function recomputePickScore(b: PickScoreBreakdown): number {
  return clamp(
    b.adpValueScore * 0.2 +
      b.teamNeedScore * 0.18 +
      b.tierCliffScore * 0.12 +
      b.positionalScarcityScore * 0.1 +
      b.rosterConstructionScore * 0.1 +
      b.formatFitScore * 0.08 +
      b.projectionValueScore * 0.08 +
      b.ceilingScore * 0.05 +
      b.floorScore * 0.04 +
      b.newsImpactScore * 0.03 +
      b.correlationScore * 0.02,
    0,
    100
  )
}

function buildBreakdownForRow(args: {
  row: DraftPlayerRankingRow
  overall: number
  normalizedSport: string
  available: RecommendationPlayer[]
  totalTeams: number
  projection?: number
  ceiling?: number
  floor?: number
  formatBoostHint: number
}): PickScoreBreakdown {
  const { row, overall, normalizedSport, available, totalTeams, projection, ceiling, floor, formatBoostHint } = args
  const pos = String(row.player.position || '').toUpperCase()
  const adpValueScore = mapAdpEdgeToScore(row.adpEdge)
  const teamNeedScore = clamp(Math.round(row.needScore), 0, 100)
  const positionalScarcityScore = mapPoolScarcity(pos, available, totalTeams)
  const tierCliffScore = clamp(positionalScarcityScore + (row.adpEdge > 8 ? 8 : 0), 0, 100)
  const rosterConstructionScore = clamp(Math.round((teamNeedScore + positionalScarcityScore) / 2), 0, 100)
  const formatFitScore = clamp(50 + formatBoostHint * 2, 0, 100)
  const projectionValueScore = projection != null ? clamp(Math.round(projection * 2), 0, 100) : 52
  const ceilingScore = ceiling != null ? clamp(Math.round(ceiling * 2), 0, 100) : 55
  const floorScore = floor != null ? clamp(Math.round(floor * 2), 0, 100) : 55
  const newsImpactScore = 50
  const correlationScore = row.player.team ? 58 : 50

  const reachScore = clamp(Math.round((row.adp - overall) * 3 + 50), 0, 100)
  const valueFallScore = clamp(Math.round((overall - row.adp) * 3 + 50), 0, 100)
  const replacementDropoffScore = clamp(100 - positionalScarcityScore, 0, 100)
  const draftRiskScore = clamp(100 - row.confidence + 20, 0, 100)
  const buildCoherenceScore = clamp(teamNeedScore, 0, 100)
  const futureFlexibilityScore = (row.player as { isRookie?: boolean }).isRookie ? 72 : 58

  const w = getSportAdapterWeights(normalizeToSupportedSport(normalizedSport))
  const raw: PickScoreBreakdown = {
    pickScore: 0,
    adpValueScore: adpValueScore * w.adpWeight,
    teamNeedScore: teamNeedScore * w.needWeight,
    tierCliffScore,
    positionalScarcityScore,
    rosterConstructionScore,
    formatFitScore,
    projectionValueScore,
    ceilingScore,
    floorScore,
    newsImpactScore,
    correlationScore,
    reachScore,
    valueFallScore,
    replacementDropoffScore,
    draftRiskScore,
    buildCoherenceScore,
    futureFlexibilityScore,
  }
  raw.adpValueScore = clamp(raw.adpValueScore, 0, 100)
  raw.teamNeedScore = clamp(raw.teamNeedScore, 0, 100)
  raw.pickScore = recomputePickScore(raw)
  return raw
}

export function runDeterministicPickEngine(args: {
  recommendationInput: RecommendationInput
  brainMode: LiveDraftAssistantMode
  projectionByKey?: Record<string, number>
  ceilingByKey?: Record<string, number>
  floorByKey?: Record<string, number>
}): {
  top3: RankedPickCandidate[]
  boardTierSummary: BoardTierSummary[]
  positionalRunSignals: string[]
  tierCliffWarnings: string[]
} {
  const ri = {
    ...args.recommendationInput,
    mode: mapBrainModeToEngineMode(args.brainMode),
  }
  const rankings = computeDraftPlayerRankings(ri)
  if (!rankings) {
    return { top3: [], boardTierSummary: [], positionalRunSignals: [], tierCliffWarnings: [] }
  }

  const { scored, overall, normalizedSport, playerKey } = rankings
  const available = args.recommendationInput.available
  const totalTeams = args.recommendationInput.totalTeams
  const positionalRunSignals: string[] = []
  const byPos: Record<string, number> = {}
  for (const p of available.slice(0, 60)) {
    const pos = String(p.position || '').toUpperCase()
    byPos[pos] = (byPos[pos] || 0) + 1
  }
  for (const [pos, cnt] of Object.entries(byPos)) {
    if (cnt <= 2 && ['RB', 'WR', 'QB', 'TE', 'P', 'G'].includes(pos)) {
      positionalRunSignals.push(`Thin ${pos} board: only ${cnt} visible options — run risk is elevated.`)
    }
  }

  const tierCliffWarnings: string[] = []
  const top = scored.slice(0, 8)
  if (top.length >= 2 && top[0].adpEdge - top[4]?.adpEdge > 12) {
    tierCliffWarnings.push('Large ADP-value gap after your top cluster — tier drop may be near.')
  }

  const top3: RankedPickCandidate[] = scored.slice(0, 3).map((row) => {
    const key = playerKey(row.player)
    const formatBoostHint =
      normalizedSport === 'NFL' && args.recommendationInput.isSF && String(row.player.position).toUpperCase() === 'QB'
        ? 7
        : 0
    let breakdown = buildBreakdownForRow({
      row,
      overall,
      normalizedSport,
      available,
      totalTeams,
      projection: args.projectionByKey?.[key],
      ceiling: args.ceilingByKey?.[key],
      floor: args.floorByKey?.[key],
      formatBoostHint,
    })
    breakdown = applyModeBiasToBreakdown(args.brainMode, breakdown)

    const pos = String(row.player.position || '').toUpperCase()
    const scarcityHigh = mapPoolScarcity(pos, available, totalTeams) >= 75
    const wot = waitOrTake(row, overall, scarcityHigh)

    // Honesty pass: ADP-derived CLAIMS ("value vs ADP", "reach vs ADP") assert
    // market behavior and must only fire on real ADP, never the synthetic
    // `overall + 20` prior. Scores still use the prior for ordering.
    const pickReasons: string[] = []
    if (row.needScore >= 55) pickReasons.push(`Addresses ${pos} roster pressure`)
    if (row.adpEdge > 4 && row.adpIsReal) pickReasons.push('Value vs expected draft position')
    if (formatBoostHint > 0) pickReasons.push('Format alignment (e.g. superflex / premium)')
    if (pickReasons.length === 0) pickReasons.push('Best composite score for this pick context')

    const riskNotes: string[] = []
    if (row.adpIsReal && row.adp > overall + 4) riskNotes.push('Reach vs ADP — acceptable only if you prioritize need or scarcity')
    if (!row.adpIsReal) riskNotes.push('No ADP data for this player — market comparison unavailable')
    if (breakdown.draftRiskScore > 70) riskNotes.push('Higher outcome variance than other targets')
    if (riskNotes.length === 0) riskNotes.push('Risk profile within normal range for this round')

    return {
      playerName: row.player.name,
      position: row.player.position,
      team: row.player.team,
      pickScore: Math.round(breakdown.pickScore),
      breakdown,
      pickReasons,
      riskNotes,
      waitOrTakeNow: wot,
    }
  })

  const boardTierSummary: BoardTierSummary[] = [
    {
      tierLabel: 'Current window',
      playersRemainingInTier: Math.min(available.length, 12),
      nextTierDropRisk: tierCliffWarnings.length ? 'medium' : 'low',
      notes: tierCliffWarnings.length ? tierCliffWarnings : ['No extreme tier cliff detected in your visible pool.'],
    },
  ]

  return { top3, boardTierSummary, positionalRunSignals, tierCliffWarnings }
}
