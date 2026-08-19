import { createHash } from 'crypto'
import type { TradeOfferMode as PrismaTradeOfferMode } from '@prisma/client'
import { prisma } from '../prisma'
import { resolveCurrentTradeLearningSeason } from './season-resolver'

export const CURRENT_MODEL_VERSION = 'v2.1.0'

export type TradeOfferMode = 'INSTANT' | 'STRUCTURED' | 'TRADE_IDEAS' | 'PROPOSAL_GENERATOR' | 'TRADE_CONSOLE' | 'LIVE_PROPOSAL'

function toPrismaTradeOfferMode(mode: TradeOfferMode): PrismaTradeOfferMode {
  if (mode === 'TRADE_CONSOLE') return 'TRADE_HUB'
  return mode as PrismaTradeOfferMode
}

export interface SegmentParts {
  isSuperflex: boolean
  isTEPremium: boolean
  leagueSize: number | null
  opponentTradeSampleSize: number | null
}

export interface TradeOfferEventInput {
  leagueId?: string | null
  season?: number | null
  week?: number | null
  senderUserId?: string | null
  opponentUserId?: string | null
  assetsGiven: Array<{ name: string; value?: number; type?: string }>
  assetsReceived: Array<{ name: string; value?: number; type?: string }>
  features?: {
    lineupImpact?: number
    vorp?: number
    market?: number
    behavior?: number
    demand?: number
    weights?: number[]
    capsApplied?: string[]
  } | null
  segmentParts?: SegmentParts | null
  acceptProb?: number | null
  rawAcceptProb?: number | null
  isotonicApplied?: boolean | null
  verdict?: string | null
  grade?: string | null
  confidenceScore?: number | null
  driverSet?: Array<{ id: string; evidence?: string }> | null
  mode: TradeOfferMode
  isSuperFlex?: boolean | null
  leagueFormat?: string | null
  scoringType?: string | null
  /** Real idempotency key for live-captured offers (AfLeagueTrade.id) — see
   * docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md §1.3. Omit for
   * hypothetical-evaluation-tool calls (unchanged, existing behavior). */
  afLeagueTradeId?: string | null
}

function computeInputHash(input: TradeOfferEventInput): string {
  const payload = JSON.stringify({
    g: input.assetsGiven.map(a => a.name).sort(),
    r: input.assetsReceived.map(a => a.name).sort(),
    m: input.mode,
    l: input.leagueId,
    // Real trades are already uniquely identified by afLeagueTradeId. Folding
    // it in here (only when present) prevents two DISTINCT real trades that
    // happen to have identical give/receive assets from colliding on this
    // content hash — discovered via real staging validation (Trade Learning
    // Phase 9): every real trade after the first with the same test assets
    // failed to log at all, since inputHash alone can't tell two such trades
    // apart. `JSON.stringify` drops an `undefined` key entirely, so this is a
    // no-op (byte-identical hash) for every existing, non-live caller.
    t: input.afLeagueTradeId ?? undefined,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export async function logTradeOfferEvent(input: TradeOfferEventInput): Promise<string | null> {
  try {
    const featuresJson: Record<string, any> = { ...(input.features ?? {}) }
    if (input.segmentParts) {
      featuresJson.segmentParts = input.segmentParts
    }
    if (input.isotonicApplied != null) {
      featuresJson.isotonicApplied = input.isotonicApplied
      if (input.rawAcceptProb != null) {
        featuresJson.rawAcceptProb = input.rawAcceptProb
      }
    }

    const driversJson = input.driverSet ?? []
    const confidenceDriversJson = input.confidenceScore != null
      ? [{ score: input.confidenceScore }]
      : []

    const inputHash = computeInputHash(input)

    const event = await prisma.tradeOfferEvent.create({
      data: {
        leagueId: input.leagueId ?? null,
        season: input.season ?? null,
        week: input.week ?? null,
        senderUserId: input.senderUserId ?? null,
        opponentUserId: input.opponentUserId ?? null,
        assetsGiven: input.assetsGiven,
        assetsReceived: input.assetsReceived,
        featuresJson,
        driversJson,
        confidenceDriversJson,
        inputHash,
        acceptProb: input.acceptProb ?? 0,
        verdict: input.verdict ?? 'UNKNOWN',
        lean: input.verdict ?? 'NEUTRAL',
        grade: input.grade ?? null,
        confidenceScore: input.confidenceScore ?? null,
        mode: toPrismaTradeOfferMode(input.mode),
        isSuperFlex: input.isSuperFlex ?? null,
        leagueFormat: input.leagueFormat ?? null,
        scoringType: input.scoringType ?? null,
        afLeagueTradeId: input.afLeagueTradeId ?? null,
        modelVersion: CURRENT_MODEL_VERSION,
      },
    })
    return event.id
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // Idempotent retry: if this was a live-capture call keyed by
      // afLeagueTradeId, return the already-captured event's id instead of
      // null, so the caller can still link an outcome to it later.
      if (input.afLeagueTradeId) {
        const existing = await prisma.tradeOfferEvent.findUnique({
          where: { afLeagueTradeId: input.afLeagueTradeId },
          select: { id: true },
        }).catch(() => null)
        return existing?.id ?? null
      }
      return null
    }
    console.error('[TradeEventLogger] Failed to log trade offer event:', err)
    return null
  }
}

export type TradeOutcomeStatus =
  | 'accepted' | 'rejected' | 'expired' | 'countered' | 'unknown'
  | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'COUNTERED' | 'UNKNOWN'

export interface TradeOutcomeEventInput {
  offerEventId?: string | null
  leagueId?: string | null
  week?: number | null
  season?: number | null
  outcome: TradeOutcomeStatus
  timeToDecisionMinutes?: number | null
  finalTradeId?: string | null
  /** Real idempotency key for live-captured outcomes (AfLeagueTrade.id) — see
   * docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md §1.3. */
  afLeagueTradeId?: string | null
}

export async function logTradeOutcomeEvent(input: TradeOutcomeEventInput): Promise<string | null> {
  try {
    const event = await prisma.tradeOutcomeEvent.create({
      data: {
        offerEventId: input.offerEventId ?? null,
        leagueId: input.leagueId ?? null,
        week: input.week ?? null,
        season: input.season ?? null,
        outcome: input.outcome.toUpperCase() as 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'COUNTERED' | 'UNKNOWN',
        timeToDecisionMin: input.timeToDecisionMinutes ?? null,
        leagueTradeId: input.finalTradeId ?? null,
        afLeagueTradeId: input.afLeagueTradeId ?? null,
      },
    })
    return event.id
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // Idempotent retry: already captured for this afLeagueTradeId (or this
      // offerEventId already has an outcome) — treat as success, not an error.
      if (input.afLeagueTradeId) {
        const existing = await prisma.tradeOutcomeEvent.findUnique({
          where: { afLeagueTradeId: input.afLeagueTradeId },
          select: { id: true },
        }).catch(() => null)
        return existing?.id ?? null
      }
      return null
    }
    console.error('[TradeEventLogger] Failed to log trade outcome event:', err)
    return null
  }
}

export async function logAcceptedTradesAsOutcomes(
  season?: number,
): Promise<number> {
  try {
    const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()
    const trades = await prisma.leagueTrade.findMany({
      where: {
        analyzed: true,
        season: resolvedSeason,
        valueGiven: { not: null },
        valueReceived: { not: null },
      },
      select: {
        id: true,
        historyId: true,
        week: true,
        season: true,
        tradeDate: true,
        createdAt: true,
      },
    })

    const existingOutcomes = await prisma.tradeOutcomeEvent.findMany({
      where: {
        leagueTradeId: { in: trades.map(t => t.id) },
      },
      select: { leagueTradeId: true },
    })
    const existingIds = new Set(existingOutcomes.map((o: { leagueTradeId: string | null }) => o.leagueTradeId))

    const newTrades = trades.filter(t => !existingIds.has(t.id))
    if (newTrades.length === 0) return 0

    const history = await prisma.leagueTradeHistory.findMany({
      where: {
        id: { in: [...new Set(newTrades.map(t => t.historyId))] },
      },
      select: { id: true, sleeperLeagueId: true },
    })
    const historyMap = new Map(history.map(h => [h.id, h]))

    let logged = 0
    for (const trade of newTrades) {
      const h = historyMap.get(trade.historyId)
      await logTradeOutcomeEvent({
        leagueId: h?.sleeperLeagueId ?? null,
        week: trade.week,
        season: trade.season,
        outcome: 'accepted',
        finalTradeId: trade.id,
      })
      logged++
    }

    if (logged > 0) {
      console.log(`[TradeEventLogger] Logged ${logged} accepted trade outcomes from imported LeagueTrade records`)
    }

    return logged
  } catch (err) {
    console.error('[TradeEventLogger] Failed to backfill trade outcomes:', err)
    return 0
  }
}
