import { prisma } from '@/lib/prisma'
import { buildRedraftWarRoomContext } from '@/lib/redraft-war-room/redraftWarRoomContext'
import {
  analyzeTrade as analyzeTradeWithContext,
  type TradeAnalysis as DeterministicTradeAnalysis,
  type TradeVerdict,
} from '@/lib/redraft-war-room/redraftTradeEngine'

type ConfidenceLevel = 'high' | 'medium' | 'low'
type TradeRecommendation = 'balanced' | 'lopsided' | 'needs_review' | 'needs_more_data'
type IntegrityStatus = 'clear' | 'flagged' | 'not_scanned'

type TradeSideRecord = {
  rosterId: string
  teamName: string | null
}

type TradeAssetRecord = {
  assetType: string
  fromRosterId: string
  toRosterId: string
  playerId: string | null
  playerName: string | null
  pickSeason: number | null
  pickRound: number | null
  pickNumber: number | null
}

type TradeSnapshotRecord = {
  grade: string
  fairnessScore: number
  confidenceScore: number
  valueDifference: number
}

type IntegrityFlagRow = {
  id: string
  severity: string
  summary: string
  tradeTransactionId: string | null
}

type LegacyTradePiece = {
  playerId: string | null
  playerName: string | null
}

export interface TradeSideImpact {
  rosterId: string
  teamName: string | null
  verdict: TradeVerdict
  recommendation: 'favorable' | 'unfavorable' | 'neutral' | 'needs_more_data'
  valueDelta: number | null
  rosterFitDelta: number
  lineupImpact: string[]
  benchImpact: string[]
  playoffImpact: string | null
  risks: string[]
  explanationFacts: string[]
}

export interface TradeAnalysis {
  tradeId: string
  tradeType: 'proposal' | 'accepted_trade'
  leagueId: string
  seasonId: string
  status: string
  grade: string | null
  fairnessScore: number | null
  confidence: ConfidenceLevel
  recommendation: TradeRecommendation
  summary: string
  sideAImpact: TradeSideImpact
  sideBImpact: TradeSideImpact
  risks: string[]
  dataWarnings: string[]
  unsupportedAssets: string[]
  integrity: {
    status: IntegrityStatus
    flagIds: string[]
    severity: 'low' | 'medium' | 'high' | null
    summary: string | null
  }
  snapshot: {
    grade: string
    fairnessScore: number
    confidenceScore: number
    valueDifference: number
  } | null
  source: 'deterministic_redraft_war_room'
}

export type CollusionAlert = {
  tradeId: string
  reason: string
  severity: 'low' | 'medium' | 'high'
}

type ResolvedTradeRecord = {
  tradeId: string
  tradeType: 'proposal' | 'accepted_trade'
  leagueId: string
  seasonId: string
  status: string
  sideA: TradeSideRecord
  sideB: TradeSideRecord
  sideAOutgoingPlayerIds: string[]
  sideAIncomingPlayerIds: string[]
  sideBOutgoingPlayerIds: string[]
  sideBIncomingPlayerIds: string[]
  unsupportedAssets: string[]
  snapshot: TradeSnapshotRecord | null
  integrityTradeId: string | null
}

function toConfidenceLevel(input: number | null | undefined): ConfidenceLevel {
  const score = typeof input === 'number' && Number.isFinite(input) ? input : null
  if (score == null) return 'low'
  if (score >= 75) return 'high'
  if (score >= 45) return 'medium'
  return 'low'
}

function normalizeSeverity(value: string | null | undefined): 'low' | 'medium' | 'high' {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'high' || normalized === 'medium') return normalized
  return 'low'
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
}

function summarizeUnsupportedAsset(asset: TradeAssetRecord): string {
  if (asset.assetType === 'faab') {
    const amount = Number((asset as { metadata?: { amount?: number } }).metadata?.amount ?? null)
    return Number.isFinite(amount) ? `FAAB transfer (${amount})` : 'FAAB transfer'
  }
  if (asset.assetType === 'draft_pick') {
    const season = asset.pickSeason ?? '?'
    const round = asset.pickRound ?? '?'
    return `Draft pick ${season} round ${round}`
  }
  return asset.assetType
}

function parseLegacyOfferPlayers(raw: unknown): LegacyTradePiece[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const piece = item as Record<string, unknown>
      const playerId =
        typeof piece.playerId === 'string'
          ? piece.playerId
          : typeof piece.externalId === 'string'
            ? piece.externalId
            : null
      const playerName =
        typeof piece.playerName === 'string'
          ? piece.playerName
          : typeof piece.name === 'string'
            ? piece.name
            : null
      if (!playerId && !playerName) return null
      return { playerId, playerName }
    })
    .filter((piece): piece is LegacyTradePiece => Boolean(piece))
}

function resolveRecommendation(side: DeterministicTradeAnalysis): TradeSideImpact['recommendation'] {
  if (side.verdict === 'accept') return 'favorable'
  if (side.verdict === 'reject') return 'unfavorable'
  if (side.verdict === 'needs_more_data') return 'needs_more_data'
  return 'neutral'
}

function summarizeSide(teamName: string | null, side: DeterministicTradeAnalysis): string {
  const label = teamName?.trim() || 'This roster'
  const fit =
    side.rosterFitDelta > 0
      ? 'improves roster fit'
      : side.rosterFitDelta < 0
        ? 'creates roster fit risk'
        : 'does not materially change roster fit'
  const value =
    side.valueDelta == null
      ? 'has no clean value signal'
      : side.valueDelta > 0
        ? `gains about ${Math.abs(side.valueDelta).toFixed(1)} in current value`
        : side.valueDelta < 0
          ? `gives up about ${Math.abs(side.valueDelta).toFixed(1)} in current value`
          : 'lands near even on value'
  return `${label} ${fit} and ${value}.`
}

function resolveOverallRecommendation(
  sideA: DeterministicTradeAnalysis,
  sideB: DeterministicTradeAnalysis,
): TradeRecommendation {
  if (sideA.verdict === 'needs_more_data' && sideB.verdict === 'needs_more_data') {
    return 'needs_more_data'
  }
  if (
    (sideA.verdict === 'accept' && sideB.verdict === 'reject') ||
    (sideA.verdict === 'reject' && sideB.verdict === 'accept')
  ) {
    return 'lopsided'
  }
  if (sideA.verdict === 'reject' || sideB.verdict === 'reject') {
    return 'needs_review'
  }
  if (sideA.verdict === 'accept' || sideB.verdict === 'accept') {
    return 'balanced'
  }
  return 'needs_review'
}

function computeConfidence(args: {
  snapshot: TradeSnapshotRecord | null
  dataWarnings: string[]
  sideA: DeterministicTradeAnalysis
  sideB: DeterministicTradeAnalysis
}): ConfidenceLevel {
  const snapshotConfidence = toConfidenceLevel(args.snapshot?.confidenceScore)
  if (snapshotConfidence === 'high' && args.dataWarnings.length <= 1) return 'high'
  if (
    args.sideA.verdict !== 'needs_more_data' &&
    args.sideB.verdict !== 'needs_more_data' &&
    args.dataWarnings.length <= 3
  ) {
    return 'medium'
  }
  return snapshotConfidence === 'medium' ? 'medium' : 'low'
}

async function loadProposalTrade(tradeId: string): Promise<ResolvedTradeRecord | null> {
  const proposal = await prisma.redraftTradeProposal.findUnique({
    where: { id: tradeId },
    include: {
      assets: true,
      proposerRoster: { select: { id: true, teamName: true, ownerName: true } },
      receiverRoster: { select: { id: true, teamName: true, ownerName: true } },
      valueSnapshot: true,
    },
  })
  if (!proposal) return null

  const playerAssets = proposal.assets.filter((asset) => asset.assetType === 'player')
  const unsupportedAssets = proposal.assets
    .filter((asset) => asset.assetType !== 'player')
    .map(summarizeUnsupportedAsset)

  return {
    tradeId: proposal.id,
    tradeType: 'proposal',
    leagueId: proposal.leagueId,
    seasonId: proposal.seasonId,
    status: proposal.status,
    sideA: {
      rosterId: proposal.proposerRosterId,
      teamName: proposal.proposerRoster.teamName?.trim() || proposal.proposerRoster.ownerName,
    },
    sideB: {
      rosterId: proposal.receiverRosterId,
      teamName: proposal.receiverRoster.teamName?.trim() || proposal.receiverRoster.ownerName,
    },
    sideAOutgoingPlayerIds: playerAssets
      .filter(
        (asset) =>
          asset.fromRosterId === proposal.proposerRosterId && asset.toRosterId === proposal.receiverRosterId,
      )
      .map((asset) => asset.playerId)
      .filter((value): value is string => Boolean(value)),
    sideAIncomingPlayerIds: playerAssets
      .filter(
        (asset) =>
          asset.fromRosterId === proposal.receiverRosterId && asset.toRosterId === proposal.proposerRosterId,
      )
      .map((asset) => asset.playerId)
      .filter((value): value is string => Boolean(value)),
    sideBOutgoingPlayerIds: playerAssets
      .filter(
        (asset) =>
          asset.fromRosterId === proposal.receiverRosterId && asset.toRosterId === proposal.proposerRosterId,
      )
      .map((asset) => asset.playerId)
      .filter((value): value is string => Boolean(value)),
    sideBIncomingPlayerIds: playerAssets
      .filter(
        (asset) =>
          asset.fromRosterId === proposal.proposerRosterId && asset.toRosterId === proposal.receiverRosterId,
      )
      .map((asset) => asset.playerId)
      .filter((value): value is string => Boolean(value)),
    unsupportedAssets,
    snapshot: proposal.valueSnapshot
      ? {
          grade: proposal.valueSnapshot.grade,
          fairnessScore: proposal.valueSnapshot.fairnessScore,
          confidenceScore: proposal.valueSnapshot.confidenceScore,
          valueDifference: proposal.valueSnapshot.valueDifference,
        }
      : null,
    integrityTradeId: null,
  }
}

async function loadLegacyTrade(tradeId: string): Promise<ResolvedTradeRecord | null> {
  const trade = await prisma.redraftLeagueTrade.findFirst({
    where: { id: tradeId },
    include: {
      proposerRoster: { select: { id: true, teamName: true, ownerName: true } },
      receiverRoster: { select: { id: true, teamName: true, ownerName: true } },
    },
  })
  if (!trade) return null

  const proposerPieces = parseLegacyOfferPlayers(trade.proposerOffers)
  const receiverPieces = parseLegacyOfferPlayers(trade.receiverOffers)

  return {
    tradeId: trade.id,
    tradeType: 'accepted_trade',
    leagueId: trade.leagueId,
    seasonId: trade.seasonId,
    status: trade.status,
    sideA: {
      rosterId: trade.proposerRosterId,
      teamName: trade.proposerRoster.teamName?.trim() || trade.proposerRoster.ownerName,
    },
    sideB: {
      rosterId: trade.receiverRosterId,
      teamName: trade.receiverRoster.teamName?.trim() || trade.receiverRoster.ownerName,
    },
    sideAOutgoingPlayerIds: proposerPieces.map((piece) => piece.playerId).filter((value): value is string => Boolean(value)),
    sideAIncomingPlayerIds: receiverPieces.map((piece) => piece.playerId).filter((value): value is string => Boolean(value)),
    sideBOutgoingPlayerIds: receiverPieces.map((piece) => piece.playerId).filter((value): value is string => Boolean(value)),
    sideBIncomingPlayerIds: proposerPieces.map((piece) => piece.playerId).filter((value): value is string => Boolean(value)),
    unsupportedAssets: [],
    snapshot:
      trade.aiGrade && trade.aiFairnessScore != null
        ? {
            grade: trade.aiGrade,
            fairnessScore: Math.round(trade.aiFairnessScore),
            confidenceScore: trade.aiCollusionFlag ? 70 : 45,
            valueDifference: 0,
          }
        : null,
    integrityTradeId: trade.id,
  }
}

async function loadResolvedTradeRecord(tradeId: string): Promise<ResolvedTradeRecord | null> {
  const proposal = await loadProposalTrade(tradeId)
  if (proposal) return proposal
  return loadLegacyTrade(tradeId)
}

async function loadOpenIntegrityFlags(args: {
  leagueId: string
  sideA: TradeSideRecord
  sideB: TradeSideRecord
  integrityTradeId: string | null
}): Promise<IntegrityFlagRow[]> {
  const pairFilters = [
    { affectedRosterIds: { has: args.sideA.rosterId } },
    { affectedRosterIds: { has: args.sideB.rosterId } },
  ]

  return prisma.integrityFlag.findMany({
    where: {
      leagueId: args.leagueId,
      status: 'open',
      OR: [
        ...(args.integrityTradeId ? [{ tradeTransactionId: args.integrityTradeId }] : []),
        { AND: pairFilters },
      ],
    },
    select: {
      id: true,
      severity: true,
      summary: true,
      tradeTransactionId: true,
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 5,
  })
}

function toSideImpact(side: TradeSideRecord, analysis: DeterministicTradeAnalysis): TradeSideImpact {
  return {
    rosterId: side.rosterId,
    teamName: side.teamName,
    verdict: analysis.verdict,
    recommendation: resolveRecommendation(analysis),
    valueDelta: analysis.valueDelta,
    rosterFitDelta: analysis.rosterFitDelta,
    lineupImpact: analysis.lineupImpact,
    benchImpact: analysis.benchImpact,
    playoffImpact: analysis.playoffImpact,
    risks: analysis.riskFlags,
    explanationFacts: analysis.explanationFacts,
  }
}

function buildSummary(args: {
  trade: ResolvedTradeRecord
  sideA: DeterministicTradeAnalysis
  sideB: DeterministicTradeAnalysis
  recommendation: TradeRecommendation
  integrityFlags: IntegrityFlagRow[]
}): string {
  const lines = [summarizeSide(args.trade.sideA.teamName, args.sideA), summarizeSide(args.trade.sideB.teamName, args.sideB)]
  if (args.trade.snapshot) {
    lines.push(
      `Snapshot grade ${args.trade.snapshot.grade} with fairness ${args.trade.snapshot.fairnessScore}/100 and confidence ${args.trade.snapshot.confidenceScore}/100.`,
    )
  }
  if (args.integrityFlags.length > 0) {
    lines.push(`Integrity review has ${args.integrityFlags.length} open flag(s) that need commissioner review.`)
  } else if (args.trade.tradeType === 'accepted_trade') {
    lines.push('No open integrity flags are attached to this accepted trade.')
  }
  if (args.recommendation === 'needs_more_data') {
    lines.push('This analysis is limited by missing projections, stats, or player identity signals.')
  } else if (args.recommendation === 'lopsided') {
    lines.push('The current data reads as materially better for one side than the other.')
  }
  return lines.join(' ')
}

export async function analyzeTrade(userId: string, tradeId: string): Promise<TradeAnalysis | null> {
  const trade = await loadResolvedTradeRecord(tradeId)
  if (!trade) return null

  const contextResult = await buildRedraftWarRoomContext({
    leagueId: trade.leagueId,
    userId,
    seasonId: trade.seasonId,
  })
  if (!contextResult.ok) return null

  const sideAAnalysis = analyzeTradeWithContext(contextResult.context, {
    rosterId: trade.sideA.rosterId,
    outgoingPlayerIds: trade.sideAOutgoingPlayerIds,
    incomingPlayerIds: trade.sideAIncomingPlayerIds,
  })
  const sideBAnalysis = analyzeTradeWithContext(contextResult.context, {
    rosterId: trade.sideB.rosterId,
    outgoingPlayerIds: trade.sideBOutgoingPlayerIds,
    incomingPlayerIds: trade.sideBIncomingPlayerIds,
  })

  const dataWarnings = uniqueStrings([
    ...sideAAnalysis.missingDataFlags,
    ...sideBAnalysis.missingDataFlags,
    ...trade.unsupportedAssets.map((asset) => `Unsupported deterministic asset type: ${asset}.`),
    trade.sideAOutgoingPlayerIds.length === 0 && trade.sideAIncomingPlayerIds.length === 0
      ? 'No player assets could be matched for side A.'
      : null,
    trade.sideBOutgoingPlayerIds.length === 0 && trade.sideBIncomingPlayerIds.length === 0
      ? 'No player assets could be matched for side B.'
      : null,
  ])

  const integrityFlags = await loadOpenIntegrityFlags({
    leagueId: trade.leagueId,
    sideA: trade.sideA,
    sideB: trade.sideB,
    integrityTradeId: trade.integrityTradeId,
  }).catch(() => [] as IntegrityFlagRow[])

  const recommendation = resolveOverallRecommendation(sideAAnalysis, sideBAnalysis)
  const confidence = computeConfidence({
    snapshot: trade.snapshot,
    dataWarnings,
    sideA: sideAAnalysis,
    sideB: sideBAnalysis,
  })
  const risks = uniqueStrings([
    ...sideAAnalysis.riskFlags,
    ...sideBAnalysis.riskFlags,
    integrityFlags.length > 0 ? 'Open integrity flags exist for this roster pair.' : null,
  ])
  const highestSeverity =
    integrityFlags.length > 0
      ? integrityFlags
          .map((flag) => normalizeSeverity(flag.severity))
          .sort((left, right) => ['low', 'medium', 'high'].indexOf(right) - ['low', 'medium', 'high'].indexOf(left))[0]
      : null

  return {
    tradeId: trade.tradeId,
    tradeType: trade.tradeType,
    leagueId: trade.leagueId,
    seasonId: trade.seasonId,
    status: trade.status,
    grade: trade.snapshot?.grade ?? null,
    fairnessScore: trade.snapshot?.fairnessScore ?? null,
    confidence,
    recommendation,
    summary: buildSummary({
      trade,
      sideA: sideAAnalysis,
      sideB: sideBAnalysis,
      recommendation,
      integrityFlags,
    }),
    sideAImpact: toSideImpact(trade.sideA, sideAAnalysis),
    sideBImpact: toSideImpact(trade.sideB, sideBAnalysis),
    risks,
    dataWarnings,
    unsupportedAssets: trade.unsupportedAssets,
    integrity: {
      status: trade.tradeType === 'proposal' && integrityFlags.length === 0 ? 'not_scanned' : integrityFlags.length > 0 ? 'flagged' : 'clear',
      flagIds: integrityFlags.map((flag) => flag.id),
      severity: highestSeverity,
      summary: integrityFlags[0]?.summary ?? null,
    },
    snapshot: trade.snapshot,
    source: 'deterministic_redraft_war_room',
  }
}

export async function detectCollusion(leagueId: string): Promise<CollusionAlert[]> {
  const flags = await prisma.integrityFlag.findMany({
    where: {
      leagueId,
      status: 'open',
      flagType: 'collusion',
    },
    select: {
      id: true,
      severity: true,
      summary: true,
      tradeTransactionId: true,
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 10,
  })

  return flags.map((flag) => ({
    tradeId: flag.tradeTransactionId ?? flag.id,
    reason: flag.summary,
    severity: normalizeSeverity(flag.severity),
  }))
}
