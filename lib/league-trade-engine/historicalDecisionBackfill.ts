import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { projectedLetterFor } from '@/lib/trade-intel/gradeScale'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function valuedAssets(value: unknown): { total: number | null; complete: boolean } {
  if (!Array.isArray(value) || value.length === 0) return { total: null, complete: false }
  const values = value.map((asset) => record(asset).value)
  if (values.some((amount) => typeof amount !== 'number' || !Number.isFinite(amount))) return { total: null, complete: false }
  return { total: (values as number[]).reduce((sum, amount) => sum + amount, 0), complete: true }
}

export function buildHistoricalDecisionBackfill(input: {
  trade: {
    id: string; leagueId: string; proposedByUserId: string; proposerRosterId: string; receiverRosterId: string
    status: string; createdAt: Date; items: Array<{ itemType: string; itemReference: string | null; fromRosterId: string; toRosterId: string; faabAmount: number | null; metadata: unknown }>
  }
  offer: {
    createdAt: Date; assetsGiven: unknown; assetsReceived: unknown; grade: string | null; confidenceScore: number | null
    modelVersion: string | null; leagueFormat: string | null; scoringType: string | null; driversJson: unknown
  } | null
  execution: { beforeState: unknown; afterState: unknown; executedAt: Date; completeness: string } | null
}) {
  const given = valuedAssets(input.offer?.assetsGiven)
  const received = valuedAssets(input.offer?.assetsReceived)
  const priced = Boolean(input.offer?.grade && given.complete && received.complete && (given.total ?? 0) > 0)
  const proposerPct = priced ? (((received.total ?? 0) - (given.total ?? 0)) / (given.total ?? 1)) * 100 : null
  const receiverPct = priced && (received.total ?? 0) > 0 ? (((given.total ?? 0) - (received.total ?? 0)) / (received.total ?? 1)) * 100 : null
  const unavailable = 'Original contextual grade unavailable — the archived trade does not contain the complete proposal-time rules, projections, standings, and outcome simulation.'
  const marketReason = (grade: string | null, gets: number | null, sends: number | null) => grade
    ? `Recovered proposal-time market grade ${grade}: received ${Math.round(gets ?? 0)} in archived value and sent ${Math.round(sends ?? 0)}. ${unavailable}`
    : unavailable
  const participantIds = [...new Set([
    input.trade.proposerRosterId,
    input.trade.receiverRosterId,
    ...input.trade.items.flatMap((item) => [item.fromRosterId, item.toRosterId]),
  ])]
  const participants = participantIds.map((rosterId) => rosterId === input.trade.proposerRosterId
    ? { rosterId, grade: priced ? input.offer?.grade ?? null : null, valueGiven: given.total, valueReceived: received.total, percent: proposerPct }
    : rosterId === input.trade.receiverRosterId
      ? { rosterId, grade: projectedLetterFor({ percentDiff: receiverPct, hasSignal: priced }), valueGiven: received.total, valueReceived: given.total, percent: receiverPct }
      : { rosterId, grade: null, valueGiven: null, valueReceived: null, percent: null }
  ).map((side) => ({
    rosterId: side.rosterId,
    grade: side.grade,
    action: 'review',
    recommendation: side.grade ? 'Review the recovered proposal-time market evidence.' : 'Use the realized result; the original decision grade is unavailable.',
    valueGiven: side.valueGiven,
    valueReceived: side.valueReceived,
    valueDelta: side.valueGiven != null && side.valueReceived != null ? side.valueReceived - side.valueGiven : null,
    fairnessScore: null,
    confidenceScore: input.offer?.confidenceScore ?? 0,
    coverageStatus: priced ? 'partial' : 'blocked',
    coveragePct: priced ? 50 : 0,
    lineupPointsBefore: null,
    lineupPointsAfter: null,
    lineupPointsDelta: null,
    outcomeMetric: null,
    outcomeBeforePct: null,
    outcomeAfterPct: null,
    outcomeDeltaPct: null,
    reason: marketReason(side.grade, side.valueReceived, side.valueGiven),
  }))
  const evidence = {
    team_identity: 'available', user_strategy: 'missing', league_rules: 'missing', trade_rules: 'missing',
    roster_before: input.execution ? 'available' : 'missing', roster_after: input.execution ? 'available' : 'missing',
    as_of_asset_values: priced ? 'available' : 'missing', as_of_projections: 'missing', paired_outcome_simulation: 'missing', historical_timestamp: 'available',
  }
  return {
    tradeId: input.trade.id,
    leagueId: input.trade.leagueId,
    proposedByUserId: input.trade.proposedByUserId,
    policyVersion: 'historical-recovery-v1',
    format: input.offer?.leagueFormat ?? 'unknown',
    leagueContext: { leagueId: input.trade.leagueId, scoringType: input.offer?.scoringType ?? null, historicalRulesAvailable: false },
    rosterContext: { beforeState: input.execution?.beforeState ?? null, afterState: input.execution?.afterState ?? null, source: input.execution ? 'trade_execution_snapshot' : null },
    assetContext: { assets: input.trade.items, archivedAssetsGiven: input.offer?.assetsGiven ?? null, archivedAssetsReceived: input.offer?.assetsReceived ?? null, valueSource: priced ? 'archived_trade_offer_event' : null, projectionSource: null, evidenceCapturedAt: input.offer?.createdAt.toISOString() ?? input.trade.createdAt.toISOString() },
    managerContext: { proposedByUserId: input.trade.proposedByUserId, active: null, confirmedAt: null },
    outcomeSimulation: null,
    evidence,
    readiness: { contextualGradeAllowed: false, marketGradeAllowed: priced, missingRequired: Object.entries(evidence).filter(([, state]) => state === 'missing').map(([key]) => key), reason: unavailable },
    decisionResult: { modelVersion: input.offer?.modelVersion ?? 'historical-recovery-v1', capturedAt: input.offer?.createdAt.toISOString() ?? input.trade.createdAt.toISOString(), scope: 'historical_recovered_market', evaluatorSupported: priced, reason: unavailable, participants },
    completeness: 'partial',
    capturedAt: input.offer?.createdAt ?? input.trade.createdAt,
  }
}

export type HistoricalBackfillResult = { scanned: number; created: number; recoveredMarketGrades: number; unavailableOriginalGrades: number }

/** Bounded, idempotent recovery. It writes only archived facts and never recalculates an old trade with today's data. */
export async function backfillHistoricalTradeDecisionSnapshots(limit = 50): Promise<HistoricalBackfillResult> {
  const bounded = Math.max(1, Math.min(200, Math.floor(limit)))
  const candidates = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT t."id"
    FROM "af_league_trades" t
    LEFT JOIN "trade_decision_snapshots" s ON s."tradeId" = t."id"
    WHERE s."id" IS NULL
      AND t."status" IN ('processed', 'reversed', 'rejected', 'cancelled', 'countered', 'expired', 'vetoed')
    ORDER BY t."createdAt" ASC
    LIMIT ${bounded}
  `)
  const ids = candidates.map((row) => row.id)
  if (!ids.length) return { scanned: 0, created: 0, recoveredMarketGrades: 0, unavailableOriginalGrades: 0 }
  const [trades, offers, executions] = await Promise.all([
    prisma.afLeagueTrade.findMany({ where: { id: { in: ids } }, include: { items: true } }),
    prisma.tradeOfferEvent.findMany({ where: { afLeagueTradeId: { in: ids } } }),
    prisma.tradeExecutionSnapshot.findMany({ where: { genericTradeId: { in: ids } } }),
  ])
  const offerByTrade = new Map(offers.flatMap((row) => row.afLeagueTradeId ? [[row.afLeagueTradeId, row] as const] : []))
  const executionByTrade = new Map(executions.flatMap((row) => row.genericTradeId ? [[row.genericTradeId, row] as const] : []))
  let created = 0
  let recoveredMarketGrades = 0
  for (const trade of trades) {
    const snapshot = buildHistoricalDecisionBackfill({ trade, offer: offerByTrade.get(trade.id) ?? null, execution: executionByTrade.get(trade.id) ?? null })
    try {
      await prisma.tradeDecisionSnapshot.create({ data: {
        ...snapshot,
        leagueContext: snapshot.leagueContext as Prisma.InputJsonValue,
        rosterContext: snapshot.rosterContext as Prisma.InputJsonValue,
        assetContext: snapshot.assetContext as Prisma.InputJsonValue,
        managerContext: snapshot.managerContext as Prisma.InputJsonValue,
        outcomeSimulation: Prisma.JsonNull,
        evidence: snapshot.evidence as Prisma.InputJsonValue,
        readiness: snapshot.readiness as Prisma.InputJsonValue,
        decisionResult: snapshot.decisionResult as Prisma.InputJsonValue,
      } })
      created += 1
      if (snapshot.readiness.marketGradeAllowed) recoveredMarketGrades += 1
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) throw error
    }
  }
  return { scanned: ids.length, created, recoveredMarketGrades, unavailableOriginalGrades: created - recoveredMarketGrades }
}
