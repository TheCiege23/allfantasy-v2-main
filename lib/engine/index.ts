export type {
  EngineLeagueContext,
  EnginePlayerState,
  EngineAsset,
  EngineManagerProfile,
  EngineContext,
  EngineOutput,
  EngineCapabilities,
  ConfidenceState,
  TeamPhase,
  ArchetypeId,
  InjuryStatus,
  DepthRole,
  ScoringFormat,
  EngineAssetType,
} from './types'

export { ENGINE_VERSION } from './types'

export {
  normalizeLeagueContext,
  normalizePlayerState,
  normalizeManagerProfile,
  normalizeAssetFromPlayer,
  normalizeAssetFromPick,
  buildEngineContext,
} from './normalize'

export {
  resolveCapabilities,
  resolveConfidence,
  gracefulDowngrade,
  type FeatureFlags,
} from './capabilities'

export {
  computeScoringAdjustments,
  type ScoringAdjustment,
} from './scoring'

export {
  computePositionalScarcity,
  type PositionalScarcity,
} from './scarcity'

export {
  classifyTeamPhase,
  classifyAllTeams,
  type ContenderClassification,
} from './contender'

export {
  classifyArchetype,
  classifyAllArchetypes,
  archetypeAcceptanceModifier,
  type ArchetypeClassification,
} from './archetypes'

export {
  computeLDIAcceptance,
  type LDIAcceptInput,
  type LDIAcceptResult,
  type AcceptDriver,
} from './ldi-accept'

export { ENGINE_FLAGS, isEnabled, getCacheTTL } from './flags'

export type {
  TradeConfidenceState,
  LeagueFormat,
  QbFormat,
  SportKey,
  SleeperUserIdentity,
  LeagueScoringSettings,
  LeagueRosterSettings,
  TradeLeagueContext,
  TradeAssetUnion,
  Asset,
  TradePlayerAsset,
  TradePickAsset,
  TeamContext,
  MarketContext,
  NflContext,
  TradeEngineRequest,
  TradeEngineResponse,
} from './trade-types'

export { runTradeAnalysis } from './trade'

export {
  breakoutAgeScore,
  draftCapitalScore,
  adpScore,
  computeDraftProjectionScore as computeEngineDevyDPS,
  enrichDevy,
  devyValueMultiplier,
} from './devy'

export { computeLiquidity, computeLiquidity as computeEngineLiquidity } from './liquidity'

export { computeAcceptanceProbability as computeEngineAcceptance } from './acceptance'

export {
  computeContextHash,
  getCachedResult,
  setCachedResult,
  invalidateCache,
  type CacheType,
} from './cache'

import type { EngineContext, EngineOutput, EngineCapabilities } from './types'
import { ENGINE_VERSION } from './types'
import { resolveCapabilities, resolveConfidence, gracefulDowngrade } from './capabilities'
import { computeScoringAdjustments, type ScoringAdjustment } from './scoring'
import { computePositionalScarcity, type PositionalScarcity } from './scarcity'
import { classifyAllTeams, type ContenderClassification } from './contender'
import { classifyAllArchetypes, type ArchetypeClassification } from './archetypes'
import { computeLDIAcceptance, type LDIAcceptResult } from './ldi-accept'
import { isEnabled } from './flags'
import { computeContextHash, getCachedResult, setCachedResult, type CacheType } from './cache'
import { computeLiquidity, liquidityTier, analyzeLiquidity, type LiquidityResult } from '@/lib/liquidity-model'
import { acceptanceProbability, extractAcceptanceFeatures } from '@/lib/acceptance-model'
import { simulatePortfolio, type PortfolioSimResult, type PortfolioAsset } from '@/lib/portfolio-simulator'

export type EngineMode = 'rankings' | 'trade' | 'waiver' | 'simulation'

export interface RunEngineOptions {
  mode: EngineMode
  leagueId: string
  rosterId?: number
  partnerRosterId?: number
  skipCache?: boolean
  tradeDriverData?: any
}

export interface EngineComputedContext {
  scoring: ScoringAdjustment
  scarcity: Record<string, PositionalScarcity>
  teamPhases: Record<number, ContenderClassification>
  archetypes: Record<number, ArchetypeClassification>
}

export interface EngineResult {
  context: EngineComputedContext
  liquidity: LiquidityResult | null
  acceptance: { probability: number; ldiResult: LDIAcceptResult | null } | null
  portfolio: PortfolioSimResult | null
  featuresAvailable: Record<string, boolean>
}

export async function runEngine(
  ctx: EngineContext,
  options: RunEngineOptions,
  dataQuality: { tradeCount30d: number; rosterCompleteness: number } = { tradeCount30d: 0, rosterCompleteness: 0.5 }
): Promise<EngineOutput<EngineResult>> {
  const start = Date.now()

  const cacheKey = {
    leagueId: options.leagueId,
    mode: options.mode,
    rosterId: options.rosterId ?? null,
    partnerRosterId: options.partnerRosterId ?? null,
    engineVersion: ENGINE_VERSION,
    dataQuality,
  }

  if (!options.skipCache && options.leagueId) {
    const hash = computeContextHash(cacheKey)
    const cached = await getCachedResult<EngineOutput<EngineResult>>(
      options.leagueId,
      options.mode as CacheType,
      hash
    )
    if (cached) return cached
  }

  const capabilities = resolveCapabilities(ctx, {
    enableSimulation: isEnabled('enableMonteCarlo'),
    enablePortfolio: isEnabled('enablePortfolioProjection'),
    enableLiquidity: isEnabled('enableLiquidityModel'),
    enableAcceptanceModel: isEnabled('enableAcceptanceModel'),
    enableDevyIntel: isEnabled('enableDevyIntelligence'),
    enableCounterBuilder: isEnabled('enableCounterBuilder'),
  })
  const confidence = resolveConfidence(capabilities, dataQuality)

  const allPlayers = Object.values(ctx.managers)
    .flatMap(m => m.assets)
    .filter(a => a.type === 'player' && a.player)
    .map(a => a.player!)

  const scoring = gracefulDowngrade(
    'scoring',
    capabilities,
    () => computeScoringAdjustments(ctx.league),
    { baseMultiplier: 1, tepMultiplier: 1, sfMultiplier: 1, idpMultiplier: 1, positionMultiplier: {} }
  )

  const scarcity = gracefulDowngrade(
    'scarcity',
    capabilities,
    () => computePositionalScarcity(ctx.league, allPlayers),
    {}
  )

  const teamPhases = gracefulDowngrade(
    'contenderClassifier',
    capabilities,
    () => classifyAllTeams(ctx.managers, ctx.league),
    {}
  )

  const archetypes = gracefulDowngrade(
    'managerArchetypes',
    capabilities,
    () => classifyAllArchetypes(ctx.managers),
    {}
  )

  const engineContext: EngineComputedContext = { scoring, scarcity, teamPhases, archetypes }

  let liquidity: LiquidityResult | null = null
  if (capabilities.liquidity) {
    liquidity = gracefulDowngrade('liquidity', capabilities, () => {
      return analyzeLiquidity({
        tradesLast30: dataQuality.tradeCount30d,
        activeManagers: Object.keys(ctx.managers).length,
        totalManagers: ctx.league.numTeams,
        avgAssetsPerTrade: 3,
      })
    }, null)
  }

  let acceptance: { probability: number; ldiResult: LDIAcceptResult | null } | null = null
  if (capabilities.acceptanceModel && options.mode === 'trade' && options.tradeDriverData) {
    acceptance = gracefulDowngrade('acceptanceModel', capabilities, () => {
      const features = extractAcceptanceFeatures(options.tradeDriverData)
      const prob = acceptanceProbability(features)

      let ldiResult: LDIAcceptResult | null = null
      if (options.rosterId && options.partnerRosterId) {
        const sender = ctx.managers[options.rosterId]
        const receiver = ctx.managers[options.partnerRosterId]
        if (sender && receiver) {
          const senderArch = archetypes[options.rosterId]
          const receiverArch = archetypes[options.partnerRosterId]
          ldiResult = computeLDIAcceptance({
            sender,
            receiver,
            senderArchetype: senderArch?.archetype || 'unknown',
            receiverArchetype: receiverArch?.archetype || 'unknown',
            offeredPositions: [],
            requestedPositions: [],
            fairnessScore: options.tradeDriverData.lineupImpactScore ?? 50,
            scarcity,
          })
        }
      }

      return { probability: prob, ldiResult }
    }, null)
  }

  let portfolio: PortfolioSimResult | null = null
  if (capabilities.portfolioProjection && options.rosterId) {
    portfolio = gracefulDowngrade('portfolioProjection', capabilities, () => {
      const manager = ctx.managers[options.rosterId!]
      if (!manager) return null

      const assets: PortfolioAsset[] = manager.assets
        .filter(a => a.type === 'player' && a.player)
        .map(a => ({
          type: (a.player!.isDevy ? 'DEVY' : 'NFL') as 'NFL' | 'DEVY',
          name: a.player!.name,
          position: a.player!.position,
          age: a.player!.age ?? undefined,
          value: a.player!.value.market,
          draftProjectionScore: a.player!.devyMeta?.draftProjectionScore ?? undefined,
          projectedDraftRound: a.player!.devyMeta?.projectedDraftRound ?? undefined,
        }))

      const pickAssets: PortfolioAsset[] = manager.assets
        .filter(a => a.type === 'pick' && a.pick)
        .map(a => ({
          type: 'PICK' as const,
          pickRound: a.pick!.round,
          pickYear: a.pick!.year,
        }))

      return simulatePortfolio([...assets, ...pickAssets])
    }, null)
  }

  const featuresAvailable: Record<string, boolean> = {
    scoring: capabilities.scoring,
    scarcity: capabilities.scarcity,
    contenderClassifier: capabilities.contenderClassifier,
    archetypes: capabilities.managerArchetypes,
    liquidity: liquidity !== null,
    acceptance: acceptance !== null,
    simulation: capabilities.simulation,
    portfolio: portfolio !== null,
    counterBuilder: capabilities.counterBuilder,
    devy: capabilities.devyIntelligence,
  }

  const result: EngineOutput<EngineResult> = {
    data: {
      context: engineContext,
      liquidity,
      acceptance,
      portfolio,
      featuresAvailable,
    },
    capabilities,
    confidence,
    meta: {
      computedAt: Date.now(),
      engineVersion: ENGINE_VERSION,
      computeTimeMs: Date.now() - start,
    },
  }

  if (!options.skipCache && options.leagueId) {
    const hash = computeContextHash(cacheKey)
    setCachedResult(options.leagueId, options.mode as CacheType, hash, result).catch(() => {})
  }

  return result
}

