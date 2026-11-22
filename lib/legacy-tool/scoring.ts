function clamp0to100(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export function normalizeScore(value: number): number {
  return clamp0to100(value)
}

export function computeTradeFairnessScore(args: {
  sideAScore: number
  sideBScore: number
  fairnessScale: number
}): number {
  const delta = Math.abs(args.sideAScore - args.sideBScore)
  return clamp0to100(100 - Math.min(100, delta * args.fairnessScale))
}

export function computeTradeRecommendationScore(args: {
  rawValueEdge: number
  teamFitEdge: number
  shortTermEdge: number
  longTermEdge: number
  riskAdjustedEdge: number
  playoffEdge: number
}): number {
  return (
    0.35 * args.rawValueEdge +
    0.2 * args.teamFitEdge +
    0.15 * args.shortTermEdge +
    0.15 * args.longTermEdge +
    0.1 * args.riskAdjustedEdge +
    0.05 * args.playoffEdge
  )
}

export function computeWaiverScore(args: {
  opportunityScore: number
  talentUpsideScore: number
  shortTermUsability: number
  longTermStashValue: number
  rosterFitScore: number
  usageTrendScore: number
  scheduleScore: number
  playoffStashScore: number
  xBuzzScore: number
  acquisitionCostPenalty: number
}): number {
  const raw =
    0.22 * args.opportunityScore +
    0.18 * args.talentUpsideScore +
    0.15 * args.shortTermUsability +
    0.12 * args.longTermStashValue +
    0.1 * args.rosterFitScore +
    0.08 * args.usageTrendScore +
    0.07 * args.scheduleScore +
    0.05 * args.playoffStashScore +
    0.03 * args.xBuzzScore -
    0.12 * args.acquisitionCostPenalty

  return clamp0to100(raw)
}

export function computeAddDropDelta(args: {
  waiverTargetScore: number
  currentRosterSpotScore: number
}): number {
  return args.waiverTargetScore - args.currentRosterSpotScore
}

