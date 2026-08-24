import 'server-only'

import { prisma } from '@/lib/prisma'
import type { TradeGradesPayload, GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'

/**
 * Trades that landed in your leagues recently.
 *
 * ⚠ THE DATA WAS NEVER MISSING. The /core home carries a coverage note saying
 * trades are not ingested, and the league home hard-codes its activity feed
 * unavailable "because league transactions are not ingested for this platform
 * yet". Both statements are false: the trade-grade sweep runs every 30 minutes
 * over every imported Sleeper league, resolves BOTH sides down to individual
 * players and draft picks, grades them, and caches the result. Two surfaces
 * have been declining to look, and one of them says so in words that are
 * wrong.
 *
 * This reads that cache. One `in` query over the account's Sleeper league ids,
 * no provider call, no per-league fan-out, nothing recomputed — the cron has
 * already paid for all of it.
 *
 * ⚠ WHAT IS DELIBERATELY NOT SHOWN. The sweep's letter grade is a RETROSPECTIVE
 * verdict scored on points already realised, so for a trade made days ago it is
 * measuring almost nothing, and a 2027 pick contributes exactly zero because
 * that draft has not happened. Publishing a letter over an empty measurement
 * would be the "C means we have no data" failure this codebase has already been
 * bitten by. So a recent trade shows WHO GOT WHAT, and no grade at all until
 * enough of the season has been played for the number to mean something.
 */

/** A trade older than this is history, not news. */
const RECENT_DAYS = 14
const CACHE_PREFIX = 'trade-grades:v2:'

export type RecentTradeAsset = {
  kind: 'player' | 'pick'
  name: string
  position: string | null
}

export type RecentTradeSide = {
  rosterId: number
  managerName: string
  teamName: string | null
  received: RecentTradeAsset[]
}

export type RecentTrade = {
  id: string
  leagueId: string
  leagueName: string
  platformLeagueId: string
  acceptedAt: string
  sides: RecentTradeSide[]
  /** True when a side's assets could not all be named — the card says so. */
  partial: boolean
}

export type RecentTradesLeague = {
  id: string
  name: string
  platformLeagueId: string | null
}

function assetsOf(side: GradedTrade['sides'][number]): RecentTradeAsset[] {
  const players: RecentTradeAsset[] = side.playersIn.map((p) => ({
    kind: 'player' as const,
    name: p.name,
    position: p.position,
  }))
  /*
   * A pick is named by its own label ("2027 4th"), never by whoever it later
   * became — the trade was made for the pick, and resolving it to a player
   * would rewrite what the two managers actually agreed.
   */
  const picks: RecentTradeAsset[] = side.picksIn.map((p) => ({
    kind: 'pick' as const,
    name: p.label,
    position: null,
  }))
  return [...players, ...picks]
}

export async function getRecentTrades(
  leagues: RecentTradesLeague[],
  now: Date = new Date(),
  limit = 3,
): Promise<RecentTrade[]> {
  const byPlatformId = new Map<string, RecentTradesLeague>()
  for (const l of leagues) {
    if (l.platformLeagueId) byPlatformId.set(l.platformLeagueId, l)
  }
  if (byPlatformId.size === 0) return []

  const keys = [...byPlatformId.keys()].map((id) => `${CACHE_PREFIX}${id}`)
  const rows = await prisma.sportsDataCache
    .findMany({ where: { cacheKey: { in: keys } }, select: { cacheKey: true, data: true } })
    .catch(() => [] as { cacheKey: string; data: unknown }[])

  const cutoff = now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000
  const out: RecentTrade[] = []

  for (const row of rows) {
    const payload =
      row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as unknown as TradeGradesPayload)
        : null
    if (!payload || payload.version !== 2) continue

    const platformLeagueId = row.cacheKey.slice(CACHE_PREFIX.length)
    const league = byPlatformId.get(platformLeagueId)
    if (!league) continue

    for (const trade of payload.trades ?? []) {
      const at = new Date(trade.createdIso).getTime()
      if (!Number.isFinite(at) || at < cutoff) continue

      const sides: RecentTradeSide[] = (trade.sides ?? []).map((s) => ({
        rosterId: s.rosterId,
        managerName: s.managerName,
        teamName: s.teamName,
        received: assetsOf(s),
      }))
      /*
       * A side that received nothing we can name is not renderable as a swap —
       * saying so beats drawing an arrow into an empty column.
       */
      const partial = sides.some((s) => s.received.length === 0)
      if (sides.length < 2) continue

      out.push({
        id: trade.id,
        leagueId: league.id,
        leagueName: league.name,
        platformLeagueId,
        acceptedAt: new Date(at).toISOString(),
        sides,
        partial,
      })
    }
  }

  out.sort((a, b) => new Date(b.acceptedAt).getTime() - new Date(a.acceptedAt).getTime())
  return out.slice(0, limit)
}
