import { z } from 'zod'

export const TRADE_DECISION_CONTEXT_VERSION = '1.0.0' as const

const LeagueConfigSchema = z.object({
  leagueId: z.string().nullable(),
  name: z.string(),
  platform: z.string().nullable(),
  scoringType: z.string(),
  numTeams: z.number().int().min(2),
  isSF: z.boolean(),
  isTEP: z.boolean(),
  tepBonus: z.number(),
  rosterPositions: z.array(z.string()),
  starterSlots: z.number().int(),
  benchSlots: z.number().int(),
  taxiSlots: z.number().int(),
  scoringSettings: z.record(z.string(), z.number()),
}).strict()

const ValuationSourceSchema = z.object({
  source: z.string(),
  valuedAt: z.string(),
}).strict()

const AssetValuationSchema = z.object({
  name: z.string(),
  type: z.enum(['PLAYER', 'PICK', 'FAAB']),
  position: z.string(),
  age: z.number().nullable(),
  team: z.string().nullable(),
  marketValue: z.number(),
  impactValue: z.number(),
  vorpValue: z.number(),
  volatility: z.number(),
  valuationSource: ValuationSourceSchema,
  adp: z.object({
    rank: z.number(),
    positionalRank: z.string().nullable(),
    value: z.number().nullable(),
    fetchedAt: z.string(),
  }).strict().nullable(),
  isCornerstone: z.boolean(),
  cornerstoneReason: z.string(),
}).strict()

const PlayerRiskMarkerSchema = z.object({
  playerName: z.string(),
  ageBucket: z.enum(['prime', 'ascending', 'declining', 'cliff', 'unknown']),
  currentAge: z.number().nullable(),
  injuryStatus: z.object({
    status: z.string(),
    type: z.string().nullable(),
    description: z.string().nullable(),
    reportDate: z.string().nullable(),
    recencyDays: z.number().nullable(),
    missedGames: z.number().nullable(),
    reinjuryRisk: z.enum(['low', 'moderate', 'high', 'unknown']),
  }).strict().nullable(),
  analytics: z.object({
    athleticGrade: z.number().nullable(),
    collegeProductionGrade: z.number().nullable(),
    weeklyVolatility: z.number().nullable(),
    breakoutAge: z.number().nullable(),
    comparablePlayers: z.string().nullable(),
  }).strict().nullable(),
}).strict()

const ManagerPreferenceVectorSchema = z.object({
  sampleSize: z.number().int(),
  starterPremium: z.number(),
  positionBias: z.object({
    QB: z.number(),
    RB: z.number(),
    WR: z.number(),
    TE: z.number(),
    PICK: z.number(),
  }).strict(),
  riskTolerance: z.number(),
  consolidationBias: z.number(),
  overpayThreshold: z.number(),
  fairnessTolerance: z.number(),
  computedAt: z.string(),
}).strict()

const TeamSnapshotSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  assets: z.array(AssetValuationSchema),
  totalValue: z.number(),
  riskMarkers: z.array(PlayerRiskMarkerSchema),
  rosterComposition: z.object({
    size: z.number().int(),
    pickCount: z.number().int(),
    youngAssetCount: z.number().int(),
    starterStrengthIndex: z.number(),
  }).strict(),
  needs: z.array(z.string()),
  surplus: z.array(z.string()),
  contenderTier: z.enum(['champion', 'contender', 'middle', 'rebuild']),
  managerPreferences: ManagerPreferenceVectorSchema.nullable(),
}).strict()

const CompetitorSnapshotSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  contenderTier: z.enum(['champion', 'contender', 'middle', 'rebuild']),
  starterStrengthIndex: z.number(),
  needs: z.array(z.string()),
  surplus: z.array(z.string()),
}).strict()

const TradeHistoryStatsSchema = z.object({
  totalTrades: z.number().int(),
  recentTrades: z.number().int(),
  recencyWindowDays: z.number().int(),
  avgValueDelta: z.number(),
  leagueTradeFrequency: z.enum(['low', 'medium', 'high']).nullable(),
  computedAt: z.string(),
}).strict()

const MissingDataFlagsSchema = z.object({
  valuationsMissing: z.array(z.string()),
  adpMissing: z.array(z.string()),
  analyticsMissing: z.array(z.string()),
  injuryDataStale: z.boolean(),
  valuationDataStale: z.boolean(),
  adpDataStale: z.boolean(),
  analyticsDataStale: z.boolean(),
  tradeHistoryStale: z.boolean(),
  managerTendenciesUnavailable: z.array(z.string()),
  competitorDataUnavailable: z.boolean(),
  tradeHistoryInsufficient: z.boolean(),
}).strict()

const DataQualitySchema = z.object({
  assetsCovered: z.number().int(),
  assetsTotal: z.number().int(),
  coveragePercent: z.number(),
  adpHitRate: z.number(),
  injuryDataAvailable: z.boolean(),
  analyticsAvailable: z.boolean(),
  warnings: z.array(z.string()),
}).strict()

const FreshnessGradeEnum = z.enum(['fresh', 'aging', 'stale', 'expired', 'unavailable'])

const SingleSourceFreshnessSchema = z.object({
  source: z.string(),
  fetchedAt: z.string().nullable(),
  ageMs: z.number(),
  ageLabel: z.string(),
  grade: FreshnessGradeEnum,
  confidencePenalty: z.number(),
}).strict()

const SourceFreshnessSchema = z.object({
  rosters: SingleSourceFreshnessSchema,
  valuations: SingleSourceFreshnessSchema,
  injuries: SingleSourceFreshnessSchema,
  adp: SingleSourceFreshnessSchema,
  analytics: SingleSourceFreshnessSchema,
  tradeHistory: SingleSourceFreshnessSchema,
  compositeScore: z.number().min(0).max(100),
  compositeGrade: FreshnessGradeEnum,
  totalConfidencePenalty: z.number(),
  warnings: z.array(z.string()),
}).strict()

type FreshnessGrade = z.infer<typeof FreshnessGradeEnum>
type SingleSourceFreshness = z.infer<typeof SingleSourceFreshnessSchema>
type SourceFreshness = z.infer<typeof SourceFreshnessSchema>

export const TradeDecisionContextV1Schema = z.object({
  version: z.literal(TRADE_DECISION_CONTEXT_VERSION),
  assembledAt: z.string(),
  contextId: z.string(),

  leagueConfig: LeagueConfigSchema,

  sideA: TeamSnapshotSchema,
  sideB: TeamSnapshotSchema,

  competitors: z.array(CompetitorSnapshotSchema),

  valueDelta: z.object({
    absoluteDiff: z.number(),
    percentageDiff: z.number(),
    favoredSide: z.enum(['A', 'B', 'Even']),
  }).strict(),

  tradeHistoryStats: TradeHistoryStatsSchema,

  missingData: MissingDataFlagsSchema,
  dataQuality: DataQualitySchema,

  dataSources: z.object({
    valuationFetchedAt: z.string(),
    adpFetchedAt: z.string().nullable(),
    injuryFetchedAt: z.string().nullable(),
    analyticsFetchedAt: z.string().nullable(),
    rostersFetchedAt: z.string().nullable(),
    tradeHistoryFetchedAt: z.string().nullable(),
  }).strict(),

  sourceFreshness: SourceFreshnessSchema.optional(),
}).strict()

export type TradeDecisionContextV1 = z.infer<typeof TradeDecisionContextV1Schema>

export type AssetValuation = z.infer<typeof AssetValuationSchema>
export type PlayerRiskMarker = z.infer<typeof PlayerRiskMarkerSchema>
export type ManagerPreferenceVector = z.infer<typeof ManagerPreferenceVectorSchema>
export type TeamSnapshot = z.infer<typeof TeamSnapshotSchema>
export type CompetitorSnapshot = z.infer<typeof CompetitorSnapshotSchema>
export type TradeHistoryStats = z.infer<typeof TradeHistoryStatsSchema>
export type MissingDataFlags = z.infer<typeof MissingDataFlagsSchema>
export type DataQuality = z.infer<typeof DataQualitySchema>

export const LEAGUE_DECISION_CONTEXT_VERSION = '1.0.0' as const

const LeagueTeamSnapshotSchema = TeamSnapshotSchema.extend({
  rosterId: z.number().int(),
  userId: z.string(),
  record: z.object({
    wins: z.number().int(),
    losses: z.number().int(),
    ties: z.number().int().optional(),
  }).strict().nullable(),
  pointsFor: z.number(),
  avatar: z.string().nullable().optional(),
  tradeCount: z.number().int(),
})

type DataCoverageTier = 'FULL' | 'PARTIAL' | 'MINIMAL'

interface DataCoverageResult {
  tier: DataCoverageTier
  score: number
  confidenceAdjustment: number
  badge: {
    label: string
    description: string
    color: 'green' | 'yellow' | 'red'
  }
  dimensions: {
    assetCoverage: { score: number; detail: string }
    sourceFreshness: { score: number; detail: string }
    dataCompleteness: { score: number; detail: string }
  }
}

export function computeDataCoverageTier(
  dataQuality: DataQuality,
  missingData: MissingDataFlags,
  sourceFreshness?: SourceFreshness,
): DataCoverageResult {
  const assetScore = Math.min(100, dataQuality.coveragePercent)

  let freshnessScore = 50
  if (sourceFreshness) {
    freshnessScore = sourceFreshness.compositeScore
  } else {
    const staleFlags = [
      missingData.injuryDataStale,
      missingData.valuationDataStale,
      missingData.adpDataStale,
      missingData.analyticsDataStale,
      missingData.tradeHistoryStale,
    ]
    const staleCount = staleFlags.filter(Boolean).length
    freshnessScore = Math.max(0, 100 - staleCount * 20)
  }

  let completenessScore = 100
  const missingAssets =
    missingData.valuationsMissing.length +
    missingData.adpMissing.length +
    missingData.analyticsMissing.length
  completenessScore -= Math.min(missingAssets * 5, 40)
  if (missingData.competitorDataUnavailable) completenessScore -= 15
  if (missingData.tradeHistoryInsufficient) completenessScore -= 10
  completenessScore -= Math.min(missingData.managerTendenciesUnavailable.length * 5, 15)
  if (!dataQuality.injuryDataAvailable) completenessScore -= 10
  if (!dataQuality.analyticsAvailable) completenessScore -= 10
  completenessScore = Math.max(0, completenessScore)

  const compositeScore = Math.round(
    assetScore * 0.40 +
    freshnessScore * 0.35 +
    completenessScore * 0.25
  )

  let tier: DataCoverageTier
  let confidenceAdjustment: number
  let badge: DataCoverageResult['badge']

  if (compositeScore >= 70) {
    tier = 'FULL'
    confidenceAdjustment = 0
    badge = {
      label: 'Full Data',
      description: 'All major data sources are available and current. Analysis is based on comprehensive information.',
      color: 'green',
    }
  } else if (compositeScore >= 40) {
    tier = 'PARTIAL'
    confidenceAdjustment = -8
    badge = {
      label: 'Partial Data',
      description: 'Some data sources are missing or outdated. Results should be verified before acting.',
      color: 'yellow',
    }
  } else {
    tier = 'MINIMAL'
    confidenceAdjustment = -18
    badge = {
      label: 'Limited Data',
      description: 'Significant data gaps exist. Treat this analysis as directional guidance only.',
      color: 'red',
    }
  }

  return {
    tier,
    score: compositeScore,
    confidenceAdjustment,
    badge,
    dimensions: {
      assetCoverage: {
        score: assetScore,
        detail: `${dataQuality.assetsCovered}/${dataQuality.assetsTotal} assets valued (${assetScore}%)`,
      },
      sourceFreshness: {
        score: freshnessScore,
        detail: sourceFreshness
          ? `Composite freshness: ${sourceFreshness.compositeGrade} (${freshnessScore}/100)`
          : `${[missingData.injuryDataStale, missingData.valuationDataStale, missingData.adpDataStale, missingData.analyticsDataStale, missingData.tradeHistoryStale].filter(Boolean).length} of 5 sources stale`,
      },
      dataCompleteness: {
        score: completenessScore,
        detail: missingAssets > 0
          ? `${missingAssets} asset data points missing${missingData.competitorDataUnavailable ? ', no competitor data' : ''}`
          : 'All data dimensions available',
      },
    },
  }
}

const SOURCE_FRESHNESS_THRESHOLDS: Record<string, { aging: number; stale: number; expired: number }> = {
  rosters:      { aging: 1 * 60 * 60 * 1000, stale: 6 * 60 * 60 * 1000, expired: 24 * 60 * 60 * 1000 },
  valuations:   { aging: 24 * 60 * 60 * 1000, stale: 3 * 24 * 60 * 60 * 1000, expired: 7 * 24 * 60 * 60 * 1000 },
  injuries:     { aging: 6 * 60 * 60 * 1000, stale: 24 * 60 * 60 * 1000, expired: 7 * 24 * 60 * 60 * 1000 },
  adp:          { aging: 3 * 24 * 60 * 60 * 1000, stale: 7 * 24 * 60 * 60 * 1000, expired: 14 * 24 * 60 * 60 * 1000 },
  analytics:    { aging: 7 * 24 * 60 * 60 * 1000, stale: 14 * 24 * 60 * 60 * 1000, expired: 30 * 24 * 60 * 60 * 1000 },
  tradeHistory: { aging: 24 * 60 * 60 * 1000, stale: 7 * 24 * 60 * 60 * 1000, expired: 30 * 24 * 60 * 60 * 1000 },
}

const GRADE_PENALTIES: Record<FreshnessGrade, number> = {
  fresh: 0,
  aging: -2,
  stale: -5,
  expired: -8,
  unavailable: -10,
}

const GRADE_SCORES: Record<FreshnessGrade, number> = {
  fresh: 100,
  aging: 70,
  stale: 40,
  expired: 15,
  unavailable: 0,
}

function formatAge(ms: number): string {
  if (ms < 60_000) return 'just now'
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 24 * 60 * 60 * 1000) return `${Math.round(ms / (60 * 60 * 1000))}h ago`
  return `${Math.round(ms / (24 * 60 * 60 * 1000))}d ago`
}

function gradeSource(ageMs: number, thresholdKey: string): FreshnessGrade {
  const t = SOURCE_FRESHNESS_THRESHOLDS[thresholdKey] || SOURCE_FRESHNESS_THRESHOLDS.valuations
  if (ageMs <= t.aging) return 'fresh'
  if (ageMs <= t.stale) return 'aging'
  if (ageMs <= t.expired) return 'stale'
  return 'expired'
}

function scoreSingle(fetchedAt: string | null, sourceLabel: string, thresholdKey: string, now: number): SingleSourceFreshness {
  if (!fetchedAt) {
    return {
      source: sourceLabel,
      fetchedAt: null,
      ageMs: -1,
      ageLabel: 'unavailable',
      grade: 'unavailable',
      confidencePenalty: GRADE_PENALTIES.unavailable,
    }
  }
  const ageMs = Math.max(0, now - new Date(fetchedAt).getTime())
  const grade = gradeSource(ageMs, thresholdKey)
  return {
    source: sourceLabel,
    fetchedAt,
    ageMs,
    ageLabel: formatAge(ageMs),
    grade,
    confidencePenalty: GRADE_PENALTIES[grade],
  }
}

export function computeSourceFreshness(dataSources: {
  valuationFetchedAt: string
  adpFetchedAt: string | null
  injuryFetchedAt: string | null
  analyticsFetchedAt: string | null
  rostersFetchedAt: string | null
  tradeHistoryFetchedAt: string | null
}): SourceFreshness {
  const now = Date.now()

  const rosters = scoreSingle(dataSources.rostersFetchedAt, 'Sleeper Rosters', 'rosters', now)
  const valuations = scoreSingle(dataSources.valuationFetchedAt, 'Player Valuations', 'valuations', now)
  const injuries = scoreSingle(dataSources.injuryFetchedAt, 'Injury Reports', 'injuries', now)
  const adp = scoreSingle(dataSources.adpFetchedAt, 'ADP Rankings', 'adp', now)
  const analytics = scoreSingle(dataSources.analyticsFetchedAt, 'Player Analytics', 'analytics', now)
  const tradeHistory = scoreSingle(dataSources.tradeHistoryFetchedAt, 'Trade History', 'tradeHistory', now)

  const sources = [rosters, valuations, injuries, adp, analytics, tradeHistory]
  const weights = { rosters: 0.2, valuations: 0.25, injuries: 0.2, adp: 0.15, analytics: 0.1, tradeHistory: 0.1 }
  const weightedScore =
    GRADE_SCORES[rosters.grade] * weights.rosters +
    GRADE_SCORES[valuations.grade] * weights.valuations +
    GRADE_SCORES[injuries.grade] * weights.injuries +
    GRADE_SCORES[adp.grade] * weights.adp +
    GRADE_SCORES[analytics.grade] * weights.analytics +
    GRADE_SCORES[tradeHistory.grade] * weights.tradeHistory

  const compositeScore = Math.round(Math.max(0, Math.min(100, weightedScore)))
  const compositeGrade: FreshnessGrade =
    compositeScore >= 80 ? 'fresh' :
    compositeScore >= 55 ? 'aging' :
    compositeScore >= 25 ? 'stale' :
    'expired'

  const totalConfidencePenalty = sources.reduce((sum, s) => sum + s.confidencePenalty, 0)

  const warnings: string[] = []
  for (const s of sources) {
    if (s.grade === 'expired') warnings.push(`${s.source} data is expired (${s.ageLabel}) — results may be unreliable`)
    else if (s.grade === 'stale') warnings.push(`${s.source} data is stale (${s.ageLabel}) — consider refreshing`)
    else if (s.grade === 'unavailable') warnings.push(`${s.source} data is unavailable — confidence significantly reduced`)
  }

  return {
    rosters, valuations, injuries, adp, analytics, tradeHistory,
    compositeScore, compositeGrade, totalConfidencePenalty, warnings,
  }
}

const LeagueDecisionContextSchema = z.object({
  version: z.literal(LEAGUE_DECISION_CONTEXT_VERSION),
  assembledAt: z.string(),
  contextId: z.string(),

  leagueConfig: LeagueConfigSchema,

  teams: z.array(LeagueTeamSnapshotSchema),

  tradeHistoryStats: TradeHistoryStatsSchema,

  missingData: MissingDataFlagsSchema,
  dataQuality: DataQualitySchema,

  dataSources: z.object({
    valuationFetchedAt: z.string(),
    adpFetchedAt: z.string().nullable(),
    injuryFetchedAt: z.string().nullable(),
    analyticsFetchedAt: z.string().nullable(),
    rostersFetchedAt: z.string().nullable(),
    tradeHistoryFetchedAt: z.string().nullable(),
  }).strict(),

  sourceFreshness: SourceFreshnessSchema,
})

export type LeagueDecisionContext = z.infer<typeof LeagueDecisionContextSchema>
export type LeagueTeamSnapshot = z.infer<typeof LeagueTeamSnapshotSchema>

export function classifyAgeBucket(age: number | null, position: string): PlayerRiskMarker['ageBucket'] {
  if (age == null) return 'unknown'

  const thresholds: Record<string, { ascending: number; prime: number; declining: number }> = {
    QB: { ascending: 25, prime: 32, declining: 37 },
    RB: { ascending: 23, prime: 27, declining: 30 },
    WR: { ascending: 24, prime: 30, declining: 33 },
    TE: { ascending: 24, prime: 30, declining: 33 },
  }

  const t = thresholds[position] || thresholds.WR
  if (age < t.ascending) return 'ascending'
  if (age <= t.prime) return 'prime'
  if (age <= t.declining) return 'declining'
  return 'cliff'
}
