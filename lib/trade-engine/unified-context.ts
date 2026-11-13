import {
  type TradeDecisionContextV1,
  type AssetValuation,
  type PlayerRiskMarker,
  type TeamSnapshot,
  type CompetitorSnapshot,
  type MissingDataFlags,
  type DataQuality,
  type ManagerPreferenceVector,
  type TradeHistoryStats,
  TRADE_DECISION_CONTEXT_VERSION,
  classifyAgeBucket,
  computeSourceFreshness,
} from './trade-decision-context'
import type {
  LeagueDecisionContext as LegacyLeagueDecisionContext,
  TeamDecisionProfile,
} from '@/lib/league-decision-context'
import { randomUUID } from 'crypto'

export interface LegacyAssetInput {
  name: string
  type: 'PLAYER' | 'PICK' | 'FAAB'
  position: string
  age?: number | null
  team?: string | null
  value: number
  impactValue?: number
  vorpValue?: number
  volatility?: number
  tier?: string
  trend?: string
  valuedAt?: string
  adpRank?: number | null
  adpPositionalRank?: string | null
  adpValue?: number | null
  adpFetchedAt?: string | null
  injuryStatus?: string | null
  injuryType?: string | null
  injuryDescription?: string | null
  injuryDate?: string | null
  injuryFetchedAt?: string | null
  injuryReinjuryRisk?: 'low' | 'moderate' | 'high' | 'unknown'
  injuryMissedGames?: number | null
  athleticGrade?: number | null
  collegeProductionGrade?: number | null
  weeklyVolatility?: number | null
  breakoutAge?: number | null
  comparablePlayers?: string | null
}

interface UnifiedContextInput {
  legacyContext: LegacyLeagueDecisionContext | null
  sideATeamId?: string
  sideBTeamId?: string
  sideAName: string
  sideBName: string
  sideAAssets: LegacyAssetInput[]
  sideBAssets: LegacyAssetInput[]
  leagueConfig: {
    leagueId?: string | null
    leagueName?: string
    platform?: string | null
    scoringType?: string
    numTeams?: number
    isSF?: boolean
    isTEP?: boolean
    tepBonus?: number
    rosterPositions?: string[]
    starterSlots?: number
    benchSlots?: number
    taxiSlots?: number
    scoringSettings?: Record<string, number>
  }
  valuationFetchedAt: string
  adpFetchedAt?: string | null
  injuryFetchedAt?: string | null
  analyticsFetchedAt?: string | null
  rostersFetchedAt?: string | null
  tradeHistoryFetchedAt?: string | null
}

function mapAssetToValuation(asset: LegacyAssetInput): AssetValuation {
  const isCornerstone = asset.value >= 7000
  const cornerstoneReason = isCornerstone
    ? `Top-tier ${asset.position} with market value ${asset.value}`
    : ''

  return {
    name: asset.name,
    type: asset.type,
    position: asset.position || 'UNKNOWN',
    age: asset.age ?? null,
    team: asset.team ?? null,
    marketValue: asset.value,
    impactValue: asset.impactValue ?? asset.value,
    vorpValue: asset.vorpValue ?? Math.round(asset.value * 0.7),
    volatility: asset.volatility ?? 0,
    valuationSource: {
      source: 'FantasyCalc',
      valuedAt: asset.valuedAt || new Date().toISOString(),
    },
    adp: asset.adpRank != null
      ? {
          rank: asset.adpRank,
          positionalRank: asset.adpPositionalRank ?? null,
          value: asset.adpValue ?? null,
          fetchedAt: asset.adpFetchedAt || new Date().toISOString(),
        }
      : null,
    isCornerstone,
    cornerstoneReason,
  }
}

function mapAssetToRiskMarker(asset: LegacyAssetInput): PlayerRiskMarker {
  return {
    playerName: asset.name,
    ageBucket: classifyAgeBucket(asset.age ?? null, asset.position || 'WR'),
    currentAge: asset.age ?? null,
    injuryStatus: asset.injuryStatus
      ? {
          status: asset.injuryStatus,
          type: asset.injuryType ?? null,
          description: asset.injuryDescription ?? null,
          reportDate: asset.injuryDate ?? null,
          recencyDays: asset.injuryDate
            ? Math.round((Date.now() - new Date(asset.injuryDate).getTime()) / (24 * 60 * 60 * 1000))
            : null,
          missedGames: asset.injuryMissedGames ?? null,
          reinjuryRisk: asset.injuryReinjuryRisk ?? 'unknown',
        }
      : null,
    analytics: (asset.athleticGrade != null || asset.collegeProductionGrade != null)
      ? {
          athleticGrade: asset.athleticGrade ?? null,
          collegeProductionGrade: asset.collegeProductionGrade ?? null,
          weeklyVolatility: asset.weeklyVolatility ?? null,
          breakoutAge: asset.breakoutAge ?? null,
          comparablePlayers: asset.comparablePlayers ?? null,
        }
      : null,
  }
}

function mapLegacyTeamToContenderTier(
  profile: TeamDecisionProfile | undefined
): 'champion' | 'contender' | 'middle' | 'rebuild' {
  if (!profile) return 'middle'
  switch (profile.competitiveWindow) {
    case 'WIN_NOW': return 'contender'
    case 'REBUILD': return 'rebuild'
    default: return 'middle'
  }
}

function buildTeamSnapshot(
  teamId: string,
  teamName: string,
  assets: LegacyAssetInput[],
  legacyProfile: TeamDecisionProfile | undefined,
): TeamSnapshot {
  const valuations = assets.map(mapAssetToValuation)
  const riskMarkers = assets.filter(a => a.type === 'PLAYER').map(mapAssetToRiskMarker)
  const totalValue = valuations.reduce((sum, a) => sum + a.marketValue, 0)

  const playerAssets = assets.filter(a => a.type === 'PLAYER')
  const pickAssets = assets.filter(a => a.type === 'PICK')
  const youngAssets = playerAssets.filter(a => a.age != null && a.age <= 25)
  const sortedByValue = [...playerAssets].sort((a, b) => b.value - a.value)
  const starterCount = Math.min(8, sortedByValue.length)
  const starterStrengthIndex = starterCount > 0
    ? Math.round(sortedByValue.slice(0, starterCount).reduce((s, a) => s + a.value, 0) / starterCount)
    : 0

  return {
    teamId,
    teamName,
    assets: valuations,
    totalValue,
    riskMarkers,
    rosterComposition: {
      size: playerAssets.length,
      pickCount: pickAssets.length,
      youngAssetCount: youngAssets.length,
      starterStrengthIndex,
    },
    needs: legacyProfile?.needs?.map(String) || [],
    surplus: legacyProfile?.surpluses?.map(String) || [],
    contenderTier: mapLegacyTeamToContenderTier(legacyProfile),
    managerPreferences: null,
  }
}

function buildCompetitorsFromLegacy(
  legacyCtx: LegacyLeagueDecisionContext | null,
  excludeIds: string[],
): CompetitorSnapshot[] {
  if (!legacyCtx) return []

  const excludeSet = new Set(excludeIds)
  const competitors: CompetitorSnapshot[] = []

  for (const [teamId, profile] of Object.entries(legacyCtx.teams)) {
    if (excludeSet.has(teamId)) continue

    const avgQuality = Object.values(profile.starterQualityByPosition || {})
    const starterIdx = avgQuality.length > 0
      ? Math.round(avgQuality.reduce((s, v) => s + v, 0) / avgQuality.length * 80)
      : 4000

    competitors.push({
      teamId,
      teamName: teamId,
      contenderTier: mapLegacyTeamToContenderTier(profile),
      starterStrengthIndex: starterIdx,
      needs: profile.needs?.map(String) || [],
      surplus: profile.surpluses?.map(String) || [],
    })
  }

  return competitors
}

export function buildUnifiedTradeContext(input: UnifiedContextInput): TradeDecisionContextV1 {
  const now = new Date().toISOString()
  const sideAId = input.sideATeamId || input.sideAName
  const sideBId = input.sideBTeamId || input.sideBName

  const legacyProfileA = input.legacyContext?.teams?.[sideAId]
  const legacyProfileB = input.legacyContext?.teams?.[sideBId]

  const sideA = buildTeamSnapshot(sideAId, input.sideAName, input.sideAAssets, legacyProfileA)
  const sideB = buildTeamSnapshot(sideBId, input.sideBName, input.sideBAssets, legacyProfileB)

  const totalA = sideA.totalValue
  const totalB = sideB.totalValue
  const absoluteDiff = Math.abs(totalA - totalB)
  const maxVal = Math.max(totalA, totalB, 1)
  const percentageDiff = Math.round((absoluteDiff / maxVal) * 100 * 10) / 10

  const competitors = buildCompetitorsFromLegacy(input.legacyContext, [sideAId, sideBId])

  const allAssets = [...input.sideAAssets, ...input.sideBAssets]
  const playerAssets = allAssets.filter(a => a.type === 'PLAYER')
  const valuedAssets = playerAssets.filter(a => a.value > 0)
  const assetsWithAdp = playerAssets.filter(a => a.adpRank != null)
  const assetsWithInjury = playerAssets.filter(a => a.injuryFetchedAt != null)
  const assetsWithAnalytics = playerAssets.filter(a => a.athleticGrade != null || a.collegeProductionGrade != null)

  const valuationsMissing = playerAssets
    .filter(a => a.value <= 0)
    .map(a => a.name)
  const adpMissing = playerAssets
    .filter(a => a.adpRank == null)
    .map(a => a.name)
  const analyticsMissing = playerAssets
    .filter(a => a.athleticGrade == null && a.collegeProductionGrade == null)
    .map(a => a.name)

  const missingData: MissingDataFlags = {
    valuationsMissing,
    adpMissing,
    analyticsMissing,
    injuryDataStale: !input.injuryFetchedAt,
    valuationDataStale: false,
    adpDataStale: !input.adpFetchedAt,
    analyticsDataStale: !input.analyticsFetchedAt,
    tradeHistoryStale: !input.tradeHistoryFetchedAt,
    managerTendenciesUnavailable: [
      ...(legacyProfileA ? [] : [input.sideAName]),
      ...(legacyProfileB ? [] : [input.sideBName]),
    ],
    competitorDataUnavailable: competitors.length === 0,
    tradeHistoryInsufficient: true,
  }

  const assetsTotal = Math.max(playerAssets.length, 1)
  const dataQuality: DataQuality = {
    assetsCovered: valuedAssets.length,
    assetsTotal,
    coveragePercent: Math.round((valuedAssets.length / assetsTotal) * 100),
    adpHitRate: Math.round((assetsWithAdp.length / assetsTotal) * 100),
    injuryDataAvailable: assetsWithInjury.length > 0 || !!input.injuryFetchedAt,
    analyticsAvailable: assetsWithAnalytics.length > 0 || !!input.analyticsFetchedAt,
    warnings: [],
  }

  if (dataQuality.coveragePercent < 50) {
    dataQuality.warnings.push(`Only ${dataQuality.coveragePercent}% of assets have market valuations`)
  }
  if (dataQuality.adpHitRate < 50) {
    dataQuality.warnings.push(`ADP data available for only ${dataQuality.adpHitRate}% of assets`)
  }

  const dataSources = {
    valuationFetchedAt: input.valuationFetchedAt,
    adpFetchedAt: input.adpFetchedAt ?? null,
    injuryFetchedAt: input.injuryFetchedAt ?? null,
    analyticsFetchedAt: input.analyticsFetchedAt ?? null,
    rostersFetchedAt: input.rostersFetchedAt ?? null,
    tradeHistoryFetchedAt: input.tradeHistoryFetchedAt ?? null,
  }

  const sourceFreshness = computeSourceFreshness(dataSources)

  const tradeHistoryStats: TradeHistoryStats = {
    totalTrades: 0,
    recentTrades: 0,
    recencyWindowDays: 30,
    avgValueDelta: 0,
    leagueTradeFrequency: null,
    computedAt: now,
  }

  return {
    version: TRADE_DECISION_CONTEXT_VERSION,
    assembledAt: now,
    contextId: randomUUID(),
    leagueConfig: {
      leagueId: input.leagueConfig.leagueId ?? null,
      name: input.leagueConfig.leagueName || 'Unknown League',
      platform: input.leagueConfig.platform ?? null,
      scoringType: input.leagueConfig.scoringType || 'ppr',
      numTeams: input.leagueConfig.numTeams || 12,
      isSF: input.leagueConfig.isSF ?? false,
      isTEP: input.leagueConfig.isTEP ?? false,
      tepBonus: input.leagueConfig.tepBonus ?? 0,
      rosterPositions: input.leagueConfig.rosterPositions || [],
      starterSlots: input.leagueConfig.starterSlots || 9,
      benchSlots: input.leagueConfig.benchSlots || 6,
      taxiSlots: input.leagueConfig.taxiSlots || 0,
      scoringSettings: input.leagueConfig.scoringSettings || {},
    },
    sideA,
    sideB,
    competitors,
    valueDelta: {
      absoluteDiff,
      percentageDiff,
      favoredSide: totalA > totalB ? 'A' : totalB > totalA ? 'B' : 'Even',
    },
    tradeHistoryStats,
    missingData,
    dataQuality,
    dataSources,
    sourceFreshness,
  }
}

