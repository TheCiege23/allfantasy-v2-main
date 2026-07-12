import {
  resolveNflRedraftProductionProviderCapability,
  type NflRedraftProductionProviderDependencies,
} from '@/lib/nfl-provider/nflRedraftProductionProviderWiring'
import type {
  FantasyCalcPlayer,
  FantasyCalcPlayerIdentity,
  FantasyCalcSettings,
} from '@/lib/fantasycalc'
import {
  findPlayerByName,
  getDetailedTier,
  getValueTier,
} from '@/lib/fantasycalc'

export type CanonicalPlayerValuation = FantasyCalcPlayer
export type CanonicalPlayerIdentity = FantasyCalcPlayerIdentity
export type CanonicalValuationSettings = FantasyCalcSettings

export type {
  EnhancedTradeAnalysis,
  EnhancedTradeAsset,
  FantasyCalcCache,
  FantasyCalcPlayer,
  FantasyCalcPlayerIdentity,
  FantasyCalcSettings,
  PickTradeAsset,
  PickValueMeta,
  PickValueResult,
  PlayerTradeAsset,
  PlayerValueLookup,
} from '@/lib/fantasycalc'

export {
  analyzeTradeEnhanced,
  applyTierJumpOverride,
  calculateTradeBalance,
  compareTradeValues,
  compressScore,
  confidenceScore,
  findPlayerByName,
  findPlayerBySleeperId,
  formatValueForDisplay,
  formatValuesForPrompt,
  getDetailedTier,
  getPickValue,
  getPickValueSync,
  getPickValueWithHistorical,
  getPlayerValue,
  getTopPlayers,
  getTrendingPlayers,
  getValuationCacheAgeMs,
  getValueTier,
  letterGradeFromScore,
  processLabel,
  recomputePicksWithTimeCap,
  timingLabel,
  tradeScore,
} from '@/lib/fantasycalc'

const DEFAULT_SETTINGS: FantasyCalcSettings = {
  isDynasty: true,
  numQbs: 2,
  numTeams: 12,
  ppr: 1,
}

/**
 * Provider-neutral list gateway. Application code calls this module; only the
 * provider adapter may know that FantasyCalc currently fulfills the request.
 */
export async function getCanonicalPlayerValuations(
  settings: FantasyCalcSettings = DEFAULT_SETTINGS,
  deps: NflRedraftProductionProviderDependencies = {},
): Promise<FantasyCalcPlayer[]> {
  const resolution = await resolveNflRedraftProductionProviderCapability({
    capability: 'fantasy_valuations',
    valuationSettings: settings,
  }, deps)
  const records = resolution.canonicalData?.valuationRecords
  return Array.isArray(records) ? records as FantasyCalcPlayer[] : []
}

export async function getCanonicalValuationSnapshot(
  settings: FantasyCalcSettings = DEFAULT_SETTINGS,
  deps: NflRedraftProductionProviderDependencies = {},
): Promise<{
  players: FantasyCalcPlayer[]
  source: 'canonical_provider' | 'canonical_cache' | 'unavailable'
  stale: boolean
  fallbackUsed: boolean
  cacheUsed: boolean
  sourceTimestampIso: string | null
}> {
  const resolution = await resolveNflRedraftProductionProviderCapability({
    capability: 'fantasy_valuations',
    valuationSettings: settings,
  }, deps)
  const records = resolution.canonicalData?.valuationRecords
  return {
    players: Array.isArray(records) ? records as FantasyCalcPlayer[] : [],
    source: resolution.selectedProvider === 'canonical_cache'
      ? 'canonical_cache'
      : resolution.selectedProvider && resolution.selectedProvider !== 'hidden'
        ? 'canonical_provider'
        : 'unavailable',
    stale: resolution.trace.freshnessStatus === 'stale',
    fallbackUsed: resolution.trace.fallbackUsed,
    cacheUsed: resolution.trace.cacheUsed,
    sourceTimestampIso: resolution.trace.sourceTimestampIso,
  }
}

/** @deprecated Use getCanonicalPlayerValuations. Kept temporarily for source compatibility. */
export const fetchFantasyCalcValues = getCanonicalPlayerValuations

export async function getCanonicalPlayerDirectory(
  settings: FantasyCalcSettings = DEFAULT_SETTINGS,
  deps: NflRedraftProductionProviderDependencies = {},
): Promise<FantasyCalcPlayerIdentity[]> {
  const valuations = await getCanonicalPlayerValuations(settings, deps)
  return [...new Map(valuations.map((entry) => [String(entry.player.id), entry.player])).values()]
}

/** @deprecated Use getCanonicalPlayerDirectory. */
export const fetchFantasyCalcPlayerDirectory = getCanonicalPlayerDirectory

export async function getPlayerValuesForNames(
  names: string[],
  settings: FantasyCalcSettings = DEFAULT_SETTINGS,
): Promise<Map<string, import('@/lib/fantasycalc').PlayerValueLookup>> {
  const players = await getCanonicalPlayerValuations(settings)
  const result = new Map<string, import('@/lib/fantasycalc').PlayerValueLookup>()
  for (const name of names) {
    const player = findPlayerByName(players, name)
    if (!player) continue
    result.set(name.toLowerCase(), {
      name: player.player.name,
      value: player.value,
      rank: player.overallRank,
      positionRank: player.positionRank,
      trend30Day: player.trend30Day,
      tier: getValueTier(player.value),
      detailedTier: getDetailedTier(player.value, player.overallRank, player.player.position),
      position: player.player.position,
      team: player.player.maybeTeam,
      sleeperId: player.player.sleeperId,
      age: player.player.maybeAge,
      redraftValue: player.redraftValue,
      espnId: player.player.espnId || null,
      fleaflickerId: player.player.fleaflickerId || null,
      maybeTier: player.maybeTier ?? null,
      maybeAdp: player.maybeAdp ?? null,
      maybeTradeFrequency: player.maybeTradeFrequency ?? null,
      volatility: player.maybeMovingStandardDeviationAdjusted ?? null,
      combinedValue: player.combinedValue,
    })
  }
  return result
}
