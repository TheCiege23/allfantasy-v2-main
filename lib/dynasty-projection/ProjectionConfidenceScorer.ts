import type { DynastyLeagueContext, PlayerDynastyAsset, DraftPickValueBreakdown } from './types'

interface ProjectionConfidenceInputs {
  players: PlayerDynastyAsset[]
  picks: DraftPickValueBreakdown
  leagueContext: DynastyLeagueContext
}

export function scoreProjectionConfidence(input: ProjectionConfidenceInputs): number {
  const { players, picks, leagueContext } = input

  const coverageRatio =
    players.length === 0
      ? 0
      : players.filter((p) => p.age != null && p.dynastyValue > 0).length / players.length

  let coverageScore = 0
  if (coverageRatio >= 0.9) coverageScore = 95
  else if (coverageRatio >= 0.7) coverageScore = 80
  else if (coverageRatio >= 0.5) coverageScore = 65
  else coverageScore = 45

  const pickShare =
    picks.totalDynastyValue > 0
      ? (picks.longTermContribution / picks.totalDynastyValue)
      : 0

  const pickScore = 70 + Math.min(20, pickShare * 40)

  const formatScore = leagueContext.isDynasty ? 90 : 70

  const base = (coverageScore * 0.45 + pickScore * 0.25 + formatScore * 0.3)
  return Math.round(Math.min(100, Math.max(20, base)))
}

