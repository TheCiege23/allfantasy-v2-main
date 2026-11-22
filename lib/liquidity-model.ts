export interface LiquidityMetrics {
  tradesLast30: number
  activeManagers: number
  totalManagers: number
  avgAssetsPerTrade: number
}

export function computeLiquidity(metrics: LiquidityMetrics): number {
  const tradeComponent = Math.min(1, metrics.tradesLast30 / 20)
  const participationComponent =
    metrics.totalManagers > 0
      ? metrics.activeManagers / metrics.totalManagers
      : 0
  const sizeComponent = Math.min(1, metrics.avgAssetsPerTrade / 5)

  const score =
    tradeComponent * 0.4 +
    participationComponent * 0.3 +
    sizeComponent * 0.3

  return Math.round(score * 100)
}

type LiquidityTier = 'FROZEN' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH'

export function liquidityTier(score: number): LiquidityTier {
  if (score < 15) return 'FROZEN'
  if (score < 35) return 'LOW'
  if (score < 60) return 'MODERATE'
  if (score < 80) return 'HIGH'
  return 'VERY_HIGH'
}

