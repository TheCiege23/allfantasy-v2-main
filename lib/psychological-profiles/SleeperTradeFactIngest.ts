import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeSportForPsych } from './SportBehaviorResolver'

/**
 * SleeperTradeFactIngest — trades straight from the provider, for every league.
 *
 * WHY, given TransactionFactBackfill already exists. That one normalises what is
 * already in LeagueTradeHistory, so its reach is bounded by which leagues someone
 * happened to run the legacy trade importer against: 29 of 57 Sleeper leagues.
 * The other 28 have no history rows at all, so no amount of re-normalising
 * reaches them — measured, one of the first three sampled had 10 completed
 * trades sitting in Sleeper that AF had never fetched.
 *
 * Trade psychology is the dimension the Trade surface and War Room most want, and
 * it was the thinnest, because the data was never asked for rather than because
 * managers had not traded.
 *
 * Idempotent: the fact id is derived from (transaction, manager), so re-running
 * upserts in place. Both sides of a trade become their own row — the aggregator
 * filters by managerId and then counts distinct transactions, so a single shared
 * row would make one side of every trade invisible.
 */

const SLEEPER = 'https://api.sleeper.app/v1'
const MAX_WEEKS = 18
/** Dynasty leagues chain back a season at a time; six covers every league here. */
const MAX_PRIOR_SEASONS = 6

export type SleeperTradeIngestResult = {
  leaguesConsidered: number
  leaguesWithTrades: number
  tradesFound: number
  factsWritten: number
  feedUnavailable: number
  errors: string[]
}

type SleeperTransaction = {
  transaction_id?: string
  type?: string
  status?: string
  roster_ids?: number[]
  leg?: number
  adds?: Record<string, number> | null
  drops?: Record<string, number> | null
  draft_picks?: Array<Record<string, unknown>> | null
}

async function getWeek(leagueId: string, week: number): Promise<SleeperTransaction[] | null> {
  try {
    // db-first-exception: trade ingestion writer — provider fetch -> dw_transaction_facts, not a read path
    const url = `${SLEEPER}/league/${leagueId}/transactions/${week}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const json = (await res.json()) as unknown
    return Array.isArray(json) ? (json as SleeperTransaction[]) : []
  } catch {
    return null
  }
}

/**
 * The league id for each season, walking Sleeper's previous_league_id chain.
 *
 * Trade psychology is CUMULATIVE, like draft — the aggregator counts everything
 * up to the current season. Fetching only the current league id made the
 * warehouse disagree with the legacy history table by an order of magnitude: 1-7
 * trades per manager against 170, for the same people. Two sources describing
 * the same thing with different numbers is worse than one, because whichever the
 * caller happens to read decides the answer.
 */
async function resolveSeasonChain(
  currentId: string
): Promise<Array<{ leagueId: string; season: number | null }>> {
  const chain: Array<{ leagueId: string; season: number | null }> = []
  let id: string | null = currentId
  for (let depth = 0; id && depth <= MAX_PRIOR_SEASONS; depth += 1) {
    try {
      // db-first-exception: trade ingestion writer — provider fetch -> dw_transaction_facts, not a read path
      const url = `${SLEEPER}/league/${id}`
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) break
      const league = (await res.json()) as {
        league_id?: string
        season?: string
        previous_league_id?: string | null
      } | null
      if (!league?.league_id) break
      const season = league.season ? Number(league.season) : null
      chain.push({ leagueId: league.league_id, season: Number.isFinite(season) ? season : null })
      id = league.previous_league_id || null
    } catch {
      break
    }
  }
  return chain.length > 0 ? chain : [{ leagueId: currentId, season: null }]
}

export async function ingestSleeperTradeFacts(input?: {
  /** Canonical League ids. Omit to sweep every Sleeper league. */
  leagueIds?: string[]
  maxLeagues?: number
}): Promise<SleeperTradeIngestResult> {
  const result: SleeperTradeIngestResult = {
    leaguesConsidered: 0,
    leaguesWithTrades: 0,
    tradesFound: 0,
    factsWritten: 0,
    feedUnavailable: 0,
    errors: [],
  }

  const leagues = await prisma.league.findMany({
    where: {
      ...(input?.leagueIds?.length ? { id: { in: input.leagueIds } } : {}),
      platform: { equals: 'sleeper', mode: 'insensitive' },
      platformLeagueId: { not: '' },
    },
    select: { id: true, platformLeagueId: true, sport: true, season: true },
    take: input?.maxLeagues ?? 25,
  })
  result.leaguesConsidered = leagues.length
  if (leagues.length === 0) return result

  for (const league of leagues) {
    const externalId = league.platformLeagueId
    if (!externalId) continue

    // The aggregator filters on the normalised sport, so writing the raw league
    // value would make every row invisible to the only reader there is.
    const sport = normalizeSportForPsych(league.sport) ?? String(league.sport ?? 'NFL')
    const season = league.season ?? new Date().getFullYear()

    const chain = await resolveSeasonChain(externalId)
    let leagueTrades = 0
    let anyFeed = false

    for (const link of chain) {
      const weeks = await Promise.all(
        Array.from({ length: MAX_WEEKS }, (_, i) => getWeek(link.leagueId, i + 1))
      )
      if (weeks.some((w) => w != null)) anyFeed = true
      const linkSeason = link.season ?? season

      for (let i = 0; i < weeks.length; i += 1) {
      const week = i + 1
      for (const tx of weeks[i] ?? []) {
        if (tx.type !== 'trade' || tx.status !== 'complete') continue
        const transactionId = tx.transaction_id
        const rosterIds = Array.isArray(tx.roster_ids) ? tx.roster_ids : []
        if (!transactionId || rosterIds.length === 0) continue
        leagueTrades += 1

        for (const rosterId of rosterIds) {
          const managerId = String(rosterId)
          const row = {
            leagueId: league.id,
            sport,
            type: 'trade',
            managerId,
            rosterId: managerId,
            season: linkSeason,
            weekOrPeriod: week,
            payload: {
              sleeperTransactionId: transactionId,
              rosterIds,
              playersIn: Object.values(tx.adds ?? {}).filter((r) => r === rosterId).length,
              playersOut: Object.values(tx.drops ?? {}).filter((r) => r === rosterId).length,
              picks: (tx.draft_picks ?? []).length,
              source: 'sleeper_transactions',
            },
          }
          try {
            await prisma.transactionFact.upsert({
              where: { transactionId: `${transactionId}:${managerId}` },
              create: { transactionId: `${transactionId}:${managerId}`, ...row },
              update: row,
            })
            result.factsWritten += 1
          } catch (e) {
            if (result.errors.length < 5) {
              result.errors.push(
                `${externalId}/${transactionId}: ${e instanceof Error ? e.message : String(e)}`
              )
            }
          }
        }
      }
    }
  }

    // Every week of every season failing is a dead feed, which is different from
    // a league that simply has no trades.
    if (!anyFeed) {
      result.feedUnavailable += 1
      continue
    }

    result.tradesFound += leagueTrades
    if (leagueTrades > 0) result.leaguesWithTrades += 1
  }

  return result
}
