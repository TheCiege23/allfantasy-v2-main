/**
 * Loads Competitive Edge for a trade decision (./tradeEdge.ts holds the rule and the contract).
 *
 * ⚠ READS THE TRADE-HISTORY CACHE, NEVER BUILDS IT. `getTradeGrades` rebuilds a league's whole
 * trade life from Sleeper on a miss — seconds of provider calls — and a trade analysis must not pay
 * that. The Trades list on the same /core/trades page warms `trade-grades:v2:<platformLeagueId>`
 * on every load, so the cache is there in practice; when it is not, the section says so rather than
 * reading as "no trades". An EXPIRED entry is still read, and marked stale.
 *
 * ⚠ SLEEPER ONLY, AND IT SAYS SO. That history is the one store that knows, per trade and per
 * manager, which POSITIONS moved (lib/trade-intel/sleeperTradeGradeService.ts). Other platforms
 * get an honest "not connected yet", not an empty section that reads as a quiet trader.
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import { TRADE_GRADES_CACHE_PREFIX, type TradeGradesPayload } from '@/lib/trade-intel/sleeperTradeGradeService'
import { platformLabel } from '@/lib/core-app/platformLinks'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { buildTradeEdge, type EdgeDealAsset, type TradeEdge } from './tradeEdge'

export async function loadTradeEdge(input: {
  leagueId: string
  userId: string
  /** `LeagueTeam.externalId` of the other side — what the Trade Center sends as the partner. */
  opponentTeamExternalId: string
  deal: { theyGet: EdgeDealAsset[]; theySend: EdgeDealAsset[] }
  now?: Date
}): Promise<SectionState<TradeEdge>> {
  const now = input.now ?? new Date()
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { platform: true, platformLeagueId: true },
  })
  if (!league) return { available: false, reason: 'This league could not be read.' }

  const platform = String(league.platform ?? '').toLowerCase()
  if (platform !== 'sleeper' || !league.platformLeagueId) {
    return {
      available: false,
      reason: `Competitive Edge reads Sleeper trade history today. ${platformLabel(platform)} leagues aren't connected yet.`,
    }
  }

  const [opponent, viewer, cached] = await Promise.all([
    prisma.leagueTeam.findUnique({
      where: { leagueId_externalId: { leagueId: input.leagueId, externalId: input.opponentTeamExternalId } },
      select: { externalId: true, platformUserId: true, ownerName: true, teamName: true },
    }),
    prisma.leagueTeam.findFirst({
      where: { leagueId: input.leagueId, claimedByUserId: input.userId },
      select: { platformUserId: true },
    }),
    prisma.sportsDataCache.findUnique({ where: { cacheKey: `${TRADE_GRADES_CACHE_PREFIX}${league.platformLeagueId}` } }),
  ])

  const ownerId = opponent?.platformUserId?.trim()
  if (!opponent || !ownerId) {
    return {
      available: false,
      reason: "We can't match this team to a Sleeper manager, so there is no trade history to read for them.",
    }
  }

  const payload =
    cached?.data && typeof cached.data === 'object' ? (cached.data as unknown as TradeGradesPayload) : null
  if (!payload || payload.version !== 2 || !Array.isArray(payload.trades)) {
    return {
      available: false,
      reason:
        "This league's trade history hasn't been read yet. It loads with the Trades list on this page — analyze again in a moment.",
    }
  }

  const stale = Boolean(payload.staleAsOf) || (cached ? cached.expiresAt.getTime() < now.getTime() : false)

  return {
    available: true,
    data: buildTradeEdge({
      trades: payload.trades,
      managerOwnerId: ownerId,
      managerName: opponent.ownerName?.trim() || opponent.teamName?.trim() || 'This manager',
      teamExternalId: opponent.externalId,
      viewerOwnerId: viewer?.platformUserId?.trim() || null,
      deal: input.deal,
      seasonsScanned: payload.seasonsScanned ?? [],
      historyGaps: payload.missing ?? [],
      asOf: payload.fetchedAt,
      stale,
    }),
  }
}
