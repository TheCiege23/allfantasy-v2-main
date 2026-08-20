import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeSportForPsych } from './SportBehaviorResolver'

/**
 * TransactionFactBackfill — normalise recorded trades into `dw_transaction_facts`.
 *
 * WHAT THIS DOES AND DOES NOT BUY. The behaviour aggregator already reads trades
 * through a LeagueTradeHistory fallback, and that fallback carries MORE detail
 * than a transaction fact does (pick movement and player ages, which drive the
 * rebuild/contention and acquisition-mix signals). So this does not widen
 * psychological coverage on its own, and it would be wrong to claim it does.
 *
 * What it buys is that the PRIMARY path stops being permanently empty. The
 * warehouse table every other consumer expects to read has held 0 rows, so
 * anything built against it silently sees a league with no transactions — the
 * same class of failure as the profile engine having no caller. It also gives the
 * aggregator its cheap path: counting facts instead of loading up to 200 nested
 * trade rows per manager.
 *
 * IDENTITY. Three id spaces meet here and none of them match by accident:
 *   LeagueTradeHistory.sleeperUsername -> the numeric Sleeper USER id
 *   LeagueTeam.platformUserId          -> the same user id space
 *   LeagueTeam.externalId              -> the roster id, which is what profiles key on
 */

export type TransactionFactBackfillResult = {
  leaguesConsidered: number
  factsWritten: number
  tradesCovered: number
  skippedNoLeague: number
  skippedNoManager: number
}

/**
 * A Sleeper transaction id is shared by both sides of the trade, but a
 * transaction FACT is per manager — the aggregator filters by managerId and then
 * counts distinct transaction ids. TransactionFact.transactionId is the primary
 * key, so it has to carry the manager to keep both sides.
 */
function factId(transactionId: string, managerId: string): string {
  return `${transactionId}:${managerId}`
}

export async function backfillTransactionFactsFromTradeHistory(input?: {
  /** Restrict to these canonical League ids. Omit to sweep everything mappable. */
  leagueIds?: string[]
  maxLeagues?: number
  dryRun?: boolean
}): Promise<TransactionFactBackfillResult> {
  const result: TransactionFactBackfillResult = {
    leaguesConsidered: 0,
    factsWritten: 0,
    tradesCovered: 0,
    skippedNoLeague: 0,
    skippedNoManager: 0,
  }

  const leagues = await prisma.league.findMany({
    where: {
      ...(input?.leagueIds?.length ? { id: { in: input.leagueIds } } : {}),
      platformLeagueId: { not: '' },
    },
    select: { id: true, platformLeagueId: true, sport: true },
    take: input?.maxLeagues ?? 50,
  })
  if (leagues.length === 0) return result

  const externalIds = leagues
    .map((l) => l.platformLeagueId)
    .filter((v): v is string => Boolean(v))

  const histories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperLeagueId: { in: externalIds } },
    select: {
      sleeperLeagueId: true,
      sleeperUsername: true,
      trades: {
        select: {
          transactionId: true,
          week: true,
          season: true,
          playersGiven: true,
          playersReceived: true,
          picksGiven: true,
          picksReceived: true,
        },
      },
    },
  })
  if (histories.length === 0) return result

  const leagueByExternal = new Map(leagues.map((l) => [l.platformLeagueId as string, l]))

  // user id -> roster id, per league
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: { in: leagues.map((l) => l.id) } },
    select: { leagueId: true, externalId: true, platformUserId: true },
  })
  const rosterByLeagueUser = new Map<string, string>()
  for (const t of teams) {
    if (t.platformUserId && t.externalId) {
      rosterByLeagueUser.set(`${t.leagueId}:${t.platformUserId}`, t.externalId)
    }
  }

  const seenTrades = new Set<string>()
  const rows: Array<{
    transactionId: string
    leagueId: string
    sport: string
    type: string
    managerId: string
    rosterId: string
    season: number | null
    weekOrPeriod: number | null
    payload: object
  }> = []

  for (const history of histories) {
    const league = leagueByExternal.get(history.sleeperLeagueId)
    if (!league) {
      result.skippedNoLeague += 1
      continue
    }
    const managerId = rosterByLeagueUser.get(`${league.id}:${history.sleeperUsername}`)
    if (!managerId) {
      result.skippedNoManager += 1
      continue
    }

    // The aggregator filters on the NORMALISED sport ('NFL'), so writing the raw
    // league value would make every row invisible to the only reader that exists.
    const sport = normalizeSportForPsych(league.sport) ?? String(league.sport ?? 'NFL')

    for (const trade of history.trades) {
      const playersGiven = Array.isArray(trade.playersGiven) ? trade.playersGiven.length : 0
      const playersReceived = Array.isArray(trade.playersReceived) ? trade.playersReceived.length : 0
      const picksGiven = Array.isArray(trade.picksGiven) ? trade.picksGiven.length : 0
      const picksReceived = Array.isArray(trade.picksReceived) ? trade.picksReceived.length : 0

      rows.push({
        transactionId: factId(trade.transactionId, managerId),
        leagueId: league.id,
        sport,
        type: 'trade',
        managerId,
        rosterId: managerId,
        season: trade.season ?? null,
        weekOrPeriod: trade.week ?? null,
        payload: {
          sleeperTransactionId: trade.transactionId,
          playersGiven,
          playersReceived,
          picksGiven,
          picksReceived,
          source: 'league_trade_history_backfill',
        },
      })
      seenTrades.add(`${league.id}:${trade.transactionId}`)
    }
  }

  result.leaguesConsidered = leagues.length
  result.tradesCovered = seenTrades.size

  if (input?.dryRun) {
    result.factsWritten = rows.length
    return result
  }

  // Idempotent: re-running replaces rather than duplicating, since the id is
  // derived from the transaction and the manager rather than generated.
  for (const row of rows) {
    await prisma.transactionFact.upsert({
      where: { transactionId: row.transactionId },
      create: row,
      update: {
        leagueId: row.leagueId,
        sport: row.sport,
        type: row.type,
        managerId: row.managerId,
        rosterId: row.rosterId,
        season: row.season,
        weekOrPeriod: row.weekOrPeriod,
        payload: row.payload,
      },
    })
    result.factsWritten += 1
  }

  return result
}
