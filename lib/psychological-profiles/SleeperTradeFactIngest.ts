import 'server-only'

import { prisma } from '@/lib/prisma'
import { jitterSleep, runWithConcurrency, sleep } from '@/lib/async-utils'
import { toPrismaJsonInput } from '@/lib/prisma-json'
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

/**
 * Rate-limited requests in the current sweep.
 *
 * Reported rather than swallowed: a run that was throttled saw less of the provider than it
 * thinks it did, and a caller reading `tradesFound` without knowing that would treat a partial
 * sweep as a complete one.
 */
let rateLimitHits = 0
const MAX_WEEKS = 18
/** Dynasty leagues chain back a season at a time; six covers every league here. */
const MAX_PRIOR_SEASONS = 6

export type SleeperTradeIngestResult = {
  leaguesConsidered: number
  leaguesWithTrades: number
  tradesFound: number
  factsWritten: number
  feedUnavailable: number
  /** Requests that stayed rate-limited after every retry. Non-zero ⇒ this sweep is partial. */
  rateLimited: number
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

/**
 * The payload for one side of one trade.
 *
 * ⚠ THE PLAYER IDS USED TO BE COUNTED AND THROWN AWAY. `playersIn: 1, playersOut: 1` records
 * that a trade happened and nothing about what was in it, which makes every downstream
 * question about VALUE unanswerable — what a manager actually paid, what the market inside a
 * league says a position is worth, whether a deal was lopsided. The counts stay for the
 * readers that already depend on them; the ids are now kept beside them.
 *
 * ⚠ AND THEY GO IN THE PAYLOAD, NOT INTO NEW ROWS. `TransactionFact` has a `playerId` column
 * and it is tempting to write one row per player, but three readers count this table
 * UNFILTERED by type — `LeagueHistoryAggregator`, `WarehouseQueryService` and
 * `AnalyticsQueryLayer` — so a four-player trade would silently triple a league's reported
 * transaction volume. Enriching the payload adds no rows and changes no count.
 *
 * Sleeper's convention: `adds` maps a player id to the roster that RECEIVED him, `drops` to
 * the roster that gave him up. Read from this roster's side, that is in and out respectively.
 *
 * Pure, so the mapping is testable without a network or a database.
 */
export function buildTradeFactPayload(
  tx: SleeperTransaction,
  rosterId: number,
  transactionId: string,
  rosterIds: number[],
): Record<string, unknown> {
  const idsFor = (map: Record<string, number> | null | undefined) =>
    Object.entries(map ?? {})
      .filter(([, r]) => r === rosterId)
      .map(([playerId]) => playerId)

  const playersInIds = idsFor(tx.adds)
  const playersOutIds = idsFor(tx.drops)

  return {
    sleeperTransactionId: transactionId,
    rosterIds,
    // Kept identical to the pre-enrichment shape — existing readers consume these.
    playersIn: playersInIds.length,
    playersOut: playersOutIds.length,
    picks: (tx.draft_picks ?? []).length,
    playersInIds,
    playersOutIds,
    /*
     * Verbatim, and deliberately not interpreted. Naming the fields inside a draft-pick object
     * would be asserting a shape nobody here has verified; storing the provider's own record
     * keeps the information without inventing a schema for it.
     */
    pickDetail: tx.draft_picks ?? [],
    source: 'sleeper_transactions',
  }
}

/**
 * Requests in flight at once, across the whole sweep.
 *
 * ⚠ THIS USED TO BE EIGHTEEN. Every week of a season was fired with one `Promise.all`, which
 * is rude at one league and indefensible at eighty — the full sweep is on the order of ten
 * thousand requests against a free endpoint. Four keeps the run polite and still finishes a
 * league in seconds.
 */
const MAX_CONCURRENT_REQUESTS = 4
/** Attempts per request before a rate-limited week is reported as rate-limited. */
const MAX_ATTEMPTS = 3

/** Statuses worth trying again: rate limiting and transient upstream failures. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504])

type FetchOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'rate_limited' }
  | { status: 'unavailable' }

/**
 * One throttled, retrying GET against Sleeper.
 *
 * ⚠ A 429 IS NOT AN EMPTY WEEK, AND CONFLATING THEM IS A CORRECTNESS BUG, NOT A POLITENESS
 * ONE. The previous version returned null for any non-OK response, so a rate-limited week was
 * indistinguishable from a week with no trades in it — and the caller's `anyFeed` check would
 * then record a perfectly healthy league as having no trade feed at all. Under a sweep large
 * enough to actually get throttled, that failure mode writes silence into the warehouse and
 * looks like data.
 *
 * `Retry-After` is honoured when the server sends it, because a server that has told us how
 * long to wait should not be guessed at.
 */
async function fetchSleeper<T>(url: string): Promise<FetchOutcome<T>> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // db-first-exception: trade ingestion writer — provider fetch -> dw_transaction_facts, not a read path
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (res.ok) return { status: 'ok', value: (await res.json()) as T }

      if (!RETRYABLE.has(res.status)) return { status: 'unavailable' }
      if (attempt === MAX_ATTEMPTS) {
        return { status: res.status === 429 ? 'rate_limited' : 'unavailable' }
      }
      const retryAfter = Number(res.headers.get('retry-after'))
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** (attempt - 1)
      await sleep(backoff)
    } catch {
      if (attempt === MAX_ATTEMPTS) return { status: 'unavailable' }
      await sleep(500 * 2 ** (attempt - 1))
    }
  }
  return { status: 'unavailable' }
}

async function getWeek(leagueId: string, week: number): Promise<SleeperTransaction[] | null> {
  try {
    const url = `${SLEEPER}/league/${leagueId}/transactions/${week}`
    // Polite spacing on top of the concurrency cap, so a burst does not arrive as a spike.
    await jitterSleep(40, 120)
    const out = await fetchSleeper<unknown>(url)
    if (out.status === 'rate_limited') {
      rateLimitHits += 1
      return null
    }
    if (out.status !== 'ok') return null
    return Array.isArray(out.value) ? (out.value as SleeperTransaction[]) : []
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
      const url = `${SLEEPER}/league/${id}`
      const out = await fetchSleeper<{
        league_id?: string
        season?: string
        previous_league_id?: string | null
      }>(url)
      if (out.status === 'rate_limited') rateLimitHits += 1
      if (out.status !== 'ok') break
      const league = out.value as {
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
    rateLimited: 0,
    errors: [],
  }
  rateLimitHits = 0

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
      const weeks = await runWithConcurrency(
        Array.from({ length: MAX_WEEKS }, (_, i) => i + 1),
        MAX_CONCURRENT_REQUESTS,
        (week) => getWeek(link.leagueId, week),
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
            payload: toPrismaJsonInput(
              buildTradeFactPayload(tx, rosterId, transactionId, rosterIds),
            ),
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

  // Carried out of the module counter so a throttled sweep announces itself.
  result.rateLimited = rateLimitHits
  return result
}
