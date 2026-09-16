import 'server-only'

import { prisma } from '@/lib/prisma'
import { jitterSleep, runWithConcurrency, sleep } from '@/lib/async-utils'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { shouldSkipImportedSeason } from '@/lib/league-import/seasonCompletion'
import { firstWeekToFetch } from '@/lib/league-import/sleeper/SleeperHistoricalTransactionSyncService'
import { getNflState } from '@/lib/sleeper-client'
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
 *
 * ── 🛑 THIS IS THE SCHEDULED WRITER, AND IT WAS THE ONE WITHOUT A CHECKPOINT ─────────────────
 *
 * There are two Sleeper transaction writers and it is easy to check the wrong one.
 * `SleeperHistoricalTransactionSyncService` has the completion gate and the week window — and
 * runs ONCE, from `SleeperHistoricalBackfillService`, at import. This one is the one on a
 * schedule: `/api/cron/import-players` → `refreshStaleLeagueProfiles({ maxLeagues: 3 })` →
 * here, every six hours. So the module that repeats was the module walking everything.
 *
 * What it cost, before this change: `resolveSeasonChain` walks up to seven seasons and each was
 * read for all 18 weeks, every lap — up to ~126 transaction requests per league to discover the
 * handful of trades made since the last run, against seasons that had been over for years.
 *
 * Both halves of the fix are borrowed, not invented, because both rules already exist and a
 * second copy of either would be the divergence this repo keeps paying for:
 *
 *   `shouldSkipImportedSeason`  a season the provider calls `complete` cannot gain trades
 *   `firstWeekToFetch`          the live season only gains them near the current week
 *
 * ⚠ NEITHER IS A CACHE KNOB. Skipping a FINISHED season is free correctness; narrowing the LIVE
 * one is bounded by a deliberate week of overlap and widens to everything whenever the current
 * week is unknown. An unknown never narrows.
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
  /** Season links walked across every league in this sweep. */
  seasonsConsidered: number
  /** Links skipped because the provider reports the season finished and rows already exist. */
  seasonsSkippedComplete: number
  /**
   * Week requests this sweep did NOT make, versus walking every week of every season.
   *
   * Reported rather than inferred: the whole point of the checkpoint is a number nobody can
   * see from the outside, and a sweep that silently stopped skipping would otherwise look
   * exactly like one that had nothing to skip.
   */
  providerCallsAvoided: number
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
type ChainLink = {
  leagueId: string
  season: number | null
  /**
   * The provider's own league status — `pre_draft | drafting | in_season | complete`.
   *
   * ⚠ CARRIED, NOT DERIVED, AND IT COSTS NOTHING. This chain walk already fetches the whole
   * league object for every season; `status` was being parsed past and dropped. It is what
   * separates a season that can never change again from the one being played, which is the
   * only thing that makes this sweep skippable. `null` when the provider did not report one —
   * never a fabricated default, because an unknown status must read as "not complete".
   */
  status: string | null
}

async function resolveSeasonChain(currentId: string): Promise<ChainLink[]> {
  const chain: ChainLink[] = []
  let id: string | null = currentId
  for (let depth = 0; id && depth <= MAX_PRIOR_SEASONS; depth += 1) {
    try {
      const url = `${SLEEPER}/league/${id}`
      const out = await fetchSleeper<{
        league_id?: string
        season?: string
        status?: string | null
        previous_league_id?: string | null
      }>(url)
      if (out.status === 'rate_limited') rateLimitHits += 1
      if (out.status !== 'ok') break
      const league = out.value as {
        league_id?: string
        season?: string
        status?: string | null
        previous_league_id?: string | null
      } | null
      if (!league?.league_id) break
      const season = league.season ? Number(league.season) : null
      chain.push({
        leagueId: league.league_id,
        season: Number.isFinite(season) ? season : null,
        status: typeof league.status === 'string' ? league.status : null,
      })
      id = league.previous_league_id || null
    } catch {
      break
    }
  }
  return chain.length > 0 ? chain : [{ leagueId: currentId, season: null, status: null }]
}

/**
 * The current NFL week, read at most ONCE per sweep.
 *
 * ⚠ HOISTED DELIBERATELY. The checkpoint needs the same week for every league and every season
 * link in the run, and asking per link would add one request per season per league to a sweep
 * whose entire purpose is to make fewer of them. Memoised on the sweep, not the module: a
 * process that lives for days must not pin week 3 forever.
 *
 * 🛑 `null` IS NOT WEEK ZERO. `getNflState` failing is the absence of evidence about what
 * changed, and `firstWeekToFetch` treats it by walking everything — the expensive direction is
 * the safe one. Nothing here may turn that into a narrow window.
 */
function makeCurrentWeekReader(): () => Promise<number | null> {
  let resolved: Promise<number | null> | null = null
  return () => {
    if (!resolved) {
      resolved = getNflState()
        .then((state) => (typeof state?.week === 'number' ? state.week : null))
        .catch(() => null)
    }
    return resolved
  }
}

export async function ingestSleeperTradeFacts(input?: {
  /** Canonical League ids. Omit to sweep every Sleeper league. */
  leagueIds?: string[]
  maxLeagues?: number
  /**
   * Re-read every season and every week, ignoring both the completion gate and the week
   * checkpoint. The admin escape hatch, for a repair after a bad write — never the default,
   * because the default is what runs twelve times a day.
   */
  force?: boolean
}): Promise<SleeperTradeIngestResult> {
  const result: SleeperTradeIngestResult = {
    leaguesConsidered: 0,
    leaguesWithTrades: 0,
    tradesFound: 0,
    factsWritten: 0,
    feedUnavailable: 0,
    rateLimited: 0,
    seasonsConsidered: 0,
    seasonsSkippedComplete: 0,
    providerCallsAvoided: 0,
    errors: [],
  }
  rateLimitHits = 0
  const currentWeek = makeCurrentWeekReader()

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
    /*
     * 🛑 A SKIPPED SEASON IS NOT A DEAD FEED, AND CONFLATING THEM WOULD BE A WORSE BUG THAN THE
     * ONE THIS CHANGE FIXES. `anyFeed` is set by actually reading a week, so a league whose every
     * season is finished and already held reads zero weeks and would be reported as
     * `feedUnavailable` — a perfectly healthy league announced as broken, by the very success of
     * the skip. Deliberate silence has to be tracked separately from silence we did not choose.
     */
    let anySkipped = false

    for (const link of chain) {
      result.seasonsConsidered += 1
      const linkSeason = link.season ?? season

      /*
       * ── THE COMPLETION GATE ────────────────────────────────────────────────────────────────
       * The same predicate the import-side siblings use, for the same reason it had to be a
       * named predicate rather than an inlined `=== 'complete'`: a FINISHED season's trades
       * cannot change, and re-reading them every lap is the whole cost. See
       * lib/league-import/seasonCompletion.ts.
       *
       * ⚠ ROWS MUST ALREADY EXIST. "Complete" alone is not enough — a finished season we have
       * never read is exactly the history this ingest exists to collect, and skipping it would
       * mean never collecting it at all.
       */
      const hasExistingRows = Boolean(
        await prisma.transactionFact
          .findFirst({
            where: { leagueId: league.id, season: linkSeason, type: 'trade' },
            select: { transactionId: true },
          })
          .catch(() => null),
      )

      if (hasExistingRows && shouldSkipImportedSeason({ force: input?.force, league: link })) {
        result.seasonsSkippedComplete += 1
        result.providerCallsAvoided += MAX_WEEKS
        anySkipped = true
        continue
      }

      /*
       * ── THE WEEK CHECKPOINT, FOR THE SEASON THAT CANNOT BE SKIPPED ─────────────────────────
       * The live season only gains trades in recent weeks, so re-reading weeks 1-17 to discover
       * week 18 is the same waste one level down. One week of overlap is kept on purpose:
       * Sleeper backdates a late settlement into the week it belonged to, and a strict
       * "current week only" window would lose those permanently rather than merely late.
       *
       * Shared with the import-side sibling rather than reimplemented — two implementations of
       * one rule is the bug, and that one is already covered by its own tests.
       */
      /*
       * ⚠ `force` HAS TO CLEAR BOTH NARROWINGS, AND THE FIRST DRAFT ONLY CLEARED ONE. Passing
       * the real `hasExistingRows` here left the week window narrowed to ~8 weeks on a run whose
       * whole purpose is a full re-read after a bad write — a repair that quietly repairs two
       * thirds of the season. Caught by the test, not by reading: the gate above is the visible
       * half of `force` and it is easy to believe that is all of it.
       */
      const incremental = hasExistingRows && !input?.force
      const firstWeek = firstWeekToFetch({
        hasExistingRows: incremental,
        currentWeek: incremental ? await currentWeek() : null,
      })
      if (firstWeek > 1) result.providerCallsAvoided += firstWeek - 1

      const weekNumbers = Array.from(
        { length: MAX_WEEKS - firstWeek + 1 },
        (_, i) => firstWeek + i,
      )
      const weeks = await runWithConcurrency(
        weekNumbers,
        MAX_CONCURRENT_REQUESTS,
        (week) => getWeek(link.leagueId, week),
      )
      if (weeks.some((w) => w != null)) anyFeed = true

      for (let i = 0; i < weeks.length; i += 1) {
      /*
       * ⚠ PAIRED WITH `weekNumbers`, NOT WITH `i + 1`. The window no longer starts at week 1,
       * and an index-derived week would stamp every row of a checkpointed run with the wrong
       * week — silently, since nothing downstream can tell a mislabelled week from a real one.
       */
      const week = weekNumbers[i]
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
    // a league that simply has no trades — and different again from a league whose
    // seasons were all deliberately skipped, which read nothing because nothing
    // needed reading.
    if (!anyFeed && !anySkipped) {
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
