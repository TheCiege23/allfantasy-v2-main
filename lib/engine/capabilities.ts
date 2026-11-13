import type { EngineCapabilities, EngineContext, ConfidenceState } from './types'

interface FeatureFlags {
  enableSimulation: boolean
  enableCounterBuilder: boolean
  enablePortfolio: boolean
  enableDevyIntel: boolean
  enableLiquidity: boolean
  enableAcceptanceModel: boolean
}

const DEFAULT_FLAGS: FeatureFlags = {
  enableSimulation: true,
  enableCounterBuilder: true,
  enablePortfolio: true,
  enableDevyIntel: true,
  enableLiquidity: true,
  enableAcceptanceModel: true,
}

export function resolveCapabilities(
  ctx: EngineContext | null,
  flags: Partial<FeatureFlags> = {}
): EngineCapabilities {
  const f = { ...DEFAULT_FLAGS, ...flags }
  const hasLeague = !!ctx?.league
  const hasManagers = !!ctx?.managers && Object.keys(ctx.managers).length > 0
  const hasRosters = hasManagers && Object.values(ctx!.managers).some(m => m.assets.length > 0)

  return {
    scoring: hasLeague,
    scarcity: hasLeague && hasRosters,
    contenderClassifier: hasLeague && hasManagers,
    managerArchetypes: hasLeague && hasManagers,
    liquidity: hasLeague && f.enableLiquidity,
    acceptanceModel: hasLeague && f.enableAcceptanceModel,
    simulation: hasLeague && hasRosters && f.enableSimulation,
    portfolioProjection: hasLeague && hasRosters && f.enablePortfolio,
    counterBuilder: hasLeague && f.enableCounterBuilder,
    devyIntelligence: hasLeague && f.enableDevyIntel,
  }
}

export function resolveConfidence(
  capabilities: EngineCapabilities,
  dataQuality: { tradeCount30d: number; rosterCompleteness: number }
): ConfidenceState {
  const activeCount = Object.values(capabilities).filter(Boolean).length
  const totalCount = Object.keys(capabilities).length

  if (dataQuality.rosterCompleteness < 0.3) return 'INSUFFICIENT'
  if (dataQuality.tradeCount30d < 3 || activeCount < totalCount * 0.4) return 'LEARNING'
  if (activeCount >= totalCount * 0.7 && dataQuality.rosterCompleteness > 0.7) return 'HIGH'
  return 'MODERATE'
}

export function gracefulDowngrade<T>(
  capability: keyof EngineCapabilities,
  capabilities: EngineCapabilities,
  compute: () => T,
  fallback: T
): T {
  if (!capabilities[capability]) return fallback
  try {
    return compute()
  } catch {
    return fallback
  }
}
