/**
 * Historical Trade Loader — Trade Shadow Backtest, Phase 6.
 *
 * Loads real, completed AllFantasy-native trades (AfLeagueTrade, captured at
 * proposal time into TradeOfferEvent per lib/league-trade-engine/
 * tradeLearningCapture.ts) and normalizes each into evaluateTradeShadow's
 * input shape.
 *
 * Two real, non-obvious translations happen here, both confirmed by reading
 * the actual persistence code before writing this file (not assumed):
 *
 * 1. AfLeagueTrade.proposerRosterId/receiverRosterId are our own internal
 *    Roster.id (uuid). evaluateTradeShadow's sideARosterId/sideBRosterId
 *    must instead be the PROVIDER's source_team_id (e.g. Sleeper's numeric
 *    roster_id as a string) — see LeagueTeamSnapshot.teamId in
 *    league-context-assembler.ts (`teamId: r.sourceTeamId`). That value is
 *    only retrievable per-Roster-row via Roster.playerData.source_team_id
 *    (written by SleeperLeagueCreationBootstrapService.ts) — never via
 *    Roster.platformUserId, which stores the provider's *owner* id instead.
 *    A roster missing this field cannot be backtested and is skipped.
 *
 * 2. Only League rows whose `platform` is a real ImportProvider
 *    (sleeper/espn/yahoo/fantrax/mfl/fleaflicker) can be re-assembled by
 *    evaluateTradeShadow, since it calls runImportedLeagueNormalizationPipeline
 *    under the hood, which has no "native" provider branch. Trades on
 *    natively-created (non-imported) leagues are skipped, not guessed at.
 */

import { prisma } from '@/lib/prisma'
import { IMPORT_PROVIDERS, type ImportProvider } from '@/lib/league-import/types'
import { mapAfTradeStatusToOutcome } from '@/lib/league-trade-engine/tradeLearningCapture'
import type {
  HistoricalTradeLoadResult,
  HistoricalTradeRealOutcome,
  HistoricalTradeSample,
  SkippedTradeSample,
} from './types'

const IMPORT_PROVIDER_SET = new Set<string>(IMPORT_PROVIDERS)

function isImportProvider(platform: string): platform is ImportProvider {
  return IMPORT_PROVIDER_SET.has(platform)
}

/** Parses TradeOfferEvent.assetsGiven/assetsReceived (Json) into asset names, per the real shape written by tradeLearningCapture.ts / trade-event-logger.ts: `Array<{ name: string; value?: number; type?: string }>`. */
function parseAssetNames(json: unknown): string[] {
  if (!Array.isArray(json)) return []
  const names: string[] = []
  for (const entry of json) {
    if (entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string') {
      const name = (entry as { name: string }).name.trim()
      if (name) names.push(name)
    }
  }
  return names
}

/** Reads the provider's source_team_id off a Roster row, per SleeperLeagueCreationBootstrapService.ts's real persistence shape. Returns null (not a guess) when absent. */
function resolveSourceTeamId(playerData: unknown): string | null {
  if (!playerData || typeof playerData !== 'object') return null
  const data = playerData as Record<string, unknown>
  const direct = data.source_team_id
  if (typeof direct === 'string' && direct.length > 0) return direct
  if (typeof direct === 'number') return String(direct)
  const imported = data.import
  if (imported && typeof imported === 'object') {
    const sourceTeamId = (imported as Record<string, unknown>).sourceTeamId
    if (typeof sourceTeamId === 'string' && sourceTeamId.length > 0) return sourceTeamId
    if (typeof sourceTeamId === 'number') return String(sourceTeamId)
  }
  return null
}

function normalizeRealOutcome(outcome: string | null | undefined): HistoricalTradeRealOutcome | null {
  if (!outcome) return null
  const upper = outcome.toUpperCase()
  if (upper === 'ACCEPTED' || upper === 'REJECTED' || upper === 'COUNTERED' || upper === 'EXPIRED' || upper === 'UNKNOWN') {
    return upper
  }
  return null
}

export interface LoadHistoricalTradeSamplesOptions {
  /** Max TradeOfferEvent candidates to consider. Defaults to 200. */
  limit?: number
}

export async function loadHistoricalTradeSamples(
  options: LoadHistoricalTradeSamplesOptions = {}
): Promise<HistoricalTradeLoadResult> {
  const limit = options.limit ?? 200
  const samples: HistoricalTradeSample[] = []
  const skipped: SkippedTradeSample[] = []

  const offerEvents = await prisma.tradeOfferEvent.findMany({
    where: { mode: 'LIVE_PROPOSAL', afLeagueTradeId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  for (const offer of offerEvents) {
    const afLeagueTradeId = offer.afLeagueTradeId
    if (!afLeagueTradeId) {
      // Guarded against by the query's where-clause; kept for type-narrowing only.
      skipped.push({ offerEventId: offer.id, afLeagueTradeId: null, reason: 'missing_af_league_trade_id' })
      continue
    }

    const trade = await prisma.afLeagueTrade.findUnique({
      where: { id: afLeagueTradeId },
      include: { league: true },
    })
    if (!trade) {
      skipped.push({ offerEventId: offer.id, afLeagueTradeId, reason: 'af_league_trade_not_found' })
      continue
    }

    const realOutcomeStatus = mapAfTradeStatusToOutcome(trade.status)
    if (!realOutcomeStatus) {
      skipped.push({ offerEventId: offer.id, afLeagueTradeId, reason: `trade_not_terminal:${trade.status}` })
      continue
    }

    const league = trade.league
    if (!league) {
      skipped.push({ offerEventId: offer.id, afLeagueTradeId, reason: 'league_not_found' })
      continue
    }
    if (!isImportProvider(league.platform)) {
      skipped.push({ offerEventId: offer.id, afLeagueTradeId, reason: `unsupported_platform:${league.platform}` })
      continue
    }

    const [proposerRoster, receiverRoster] = await Promise.all([
      prisma.roster.findUnique({ where: { id: trade.proposerRosterId }, select: { playerData: true } }),
      prisma.roster.findUnique({ where: { id: trade.receiverRosterId }, select: { playerData: true } }),
    ])

    const sideARosterId = proposerRoster ? resolveSourceTeamId(proposerRoster.playerData) : null
    const sideBRosterId = receiverRoster ? resolveSourceTeamId(receiverRoster.playerData) : null
    if (!sideARosterId || !sideBRosterId) {
      skipped.push({ offerEventId: offer.id, afLeagueTradeId, reason: 'missing_source_team_id' })
      continue
    }

    const sideAAssetNames = parseAssetNames(offer.assetsGiven)
    const sideBAssetNames = parseAssetNames(offer.assetsReceived)
    if (sideAAssetNames.length === 0 || sideBAssetNames.length === 0) {
      skipped.push({ offerEventId: offer.id, afLeagueTradeId, reason: 'no_asset_names' })
      continue
    }

    const outcomeEvent = await prisma.tradeOutcomeEvent.findUnique({
      where: { offerEventId: offer.id },
      select: { outcome: true },
    }).catch(() => null)

    samples.push({
      offerEventId: offer.id,
      afLeagueTradeId,
      leagueId: league.id,
      platformLeagueId: league.platformLeagueId,
      platform: league.platform,
      afUserId: league.userId ?? null,
      sideARosterId,
      sideBRosterId,
      sideAAssetNames,
      sideBAssetNames,
      realOutcome: outcomeEvent ? normalizeRealOutcome(outcomeEvent.outcome) : normalizeRealOutcome(realOutcomeStatus),
      capturedAt: offer.createdAt.toISOString(),
    })
  }

  return { samples, skipped, totalCandidates: offerEvents.length }
}
