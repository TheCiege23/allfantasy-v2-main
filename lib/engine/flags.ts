export const ENGINE_FLAGS = {
  enableScoringAdjustments: true,
  enableScarcity: true,
  enableContenderClassifier: true,
  enableArchetypes: true,
  enableLiquidityModel: true,
  enableAcceptanceModel: true,
  enableDevyIntelligence: true,
  enablePortfolioProjection: true,
  enableCounterBuilder: true,

  enableMonteCarlo: false,
  enableMLAcceptance: false,
} as const

type EngineFlagKey = keyof typeof ENGINE_FLAGS

export function isEnabled(flag: EngineFlagKey): boolean {
  return ENGINE_FLAGS[flag] === true
}

const CACHE_TTL = {
  rankings: 15 * 60 * 1000,
  trade: 5 * 60 * 1000,
  simulation: 30 * 60 * 1000,
  waiver: 10 * 60 * 1000,
} as const

export function getCacheTTL(mode: keyof typeof CACHE_TTL): number {
  return CACHE_TTL[mode]
}
