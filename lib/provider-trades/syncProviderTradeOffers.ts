import 'server-only'

import { prisma } from '@/lib/prisma'
import { runWithConcurrency } from '@/lib/async-utils'
import { sleeperGet } from '@/lib/trade-intel/sleeperTradeSync'
import {
  normalizeSleeperTradeOffer,
  persistProviderTradeOffers,
  type NormalizedOffer,
  type SleeperTradeLike,
} from './providerTradeOfferLedger'

/**
 * The scheduled caller for the provider trade-offer ledger.
 *
 * ── WHY A ROTATION, AND WHY THE COST IS THE DESIGN ────────────────────────────────────────────
 *
 * Retiring an offer requires having read the WHOLE feed — `persistProviderTradeOffers` refuses to
 * mark anything `vanished` without that proof — and a whole feed is 18 requests per league. Doing
 * that for every imported league on a 30-minute cron is ~900 requests a run against a free
 * endpoint, on top of the ~900 the notify path in the same route already makes. That is the same
 * waste this session removed from `ingestSleeperTradeFacts`, and reintroducing it one file over
 * would be absurd.
 *
 * So each run takes a SLICE. The user's call, 2026-09-15: a bounded slice reading the full feed,
 * rather than every league reading a narrow window. The reason is that the narrow-window variant
 * can never retire anything — `feedComplete` would always be false — so a withdrawn offer would
 * sit in a manager's "Needs you" bucket indefinitely, which is precisely the stale badge the
 * buckets exist to prevent. Freshness that lies is worth less than freshness that waits.
 *
 * ⚠ THE FETCHES ARE NOT SHARED WITH THE NOTIFY PATH, DELIBERATELY. `sleeperTradeSync` is uncached
 * on purpose — its header says the completed-trade feed IS the detection signal, so reading it
 * from a cache would detect trades as of the last sync rather than as of now. Routing it through
 * the 5-minute cache to save this sweep some requests would trade someone else's correctness for
 * my convenience.
 */

const MAX_WEEKS = 18
/** Polite against a free endpoint; the same ceiling the trade-fact ingest settled on. */
const MAX_CONCURRENT_REQUESTS = 4
/** One cron slot. Only used to advance the rotation, never to decide freshness. */
const SLOT_MS = 30 * 60 * 1000

/**
 * The slice of leagues this run should sweep.
 *
 * 🛑 STATELESS AND TIME-SLICED, RATHER THAN "LEAST RECENTLY SWEPT", BECAUSE THE OBVIOUS CURSOR
 * STARVES. The natural cursor is `max(lastSeenAt)` per league — but a league that has never had a
 * trade has NO ROWS, so it reads as never-swept forever and is selected on every run, while the
 * leagues behind it are never reached. The bug is invisible: the sweep looks busy and healthy and
 * simply never covers the tail.
 *
 * A deterministic window over a stable ordering cannot starve: every league is reached exactly
 * once per lap, whether or not it has ever traded. It also needs no new state table and no write
 * into `LeagueSyncState`, whose run keys belong to the import collector.
 *
 * ⚠ THE ORDERING MUST BE STABLE OR THE GUARANTEE EVAPORATES. Sorted by id, not by any column that
 * this sweep itself mutates — ordering on `lastSeenAt` would reshuffle the list underneath the
 * window every run and silently reintroduce both starvation and double-coverage.
 *
 * Pure, so the lap can be proven without a database.
 */
export function rotationWindow<T>(items: T[], limit: number, nowMs: number): T[] {
  if (items.length === 0 || limit <= 0) return []
  if (limit >= items.length) return [...items]
  const slot = Math.floor(nowMs / SLOT_MS)
  const start = ((slot * limit) % items.length + items.length) % items.length
  const out: T[] = []
  for (let i = 0; i < limit; i += 1) out.push(items[(start + i) % items.length])
  return out
}

export type LeagueOfferSyncResult = {
  leagueId: string
  offersSeen: number
  offersWritten: number
  vanished: number
  /** False when any week of the feed failed, which is what blocks retiring. */
  feedComplete: boolean
  error?: string
}

export type OfferSweepResult = {
  leaguesEligible: number
  leaguesSwept: number
  offersWritten: number
  vanished: number
  /** Leagues whose feed was incomplete, so nothing was retired for them this run. */
  feedIncomplete: number
  results: LeagueOfferSyncResult[]
}

/**
 * One league's offers, read in full and persisted.
 *
 * ⚠ EVERY TRADE STATUS IS RECORDED, NOT ONLY THE UNSETTLED ONES. The buckets include `completed`
 * and `declined`, and a manager wants to see how the offer they were asked about RESOLVED. This
 * does not duplicate `dw_transaction_facts`: that table answers "what happened in this league"
 * and is counted by ten readers, while this one answers "what became of this offer". Separate
 * tables is what lets both be true at once.
 */
export async function syncProviderTradeOffersForLeague(args: {
  leagueId: string
  sleeperLeagueId: string
  sport: string
  season: number | null
  now?: Date
}): Promise<LeagueOfferSyncResult> {
  const weeks = await runWithConcurrency(
    Array.from({ length: MAX_WEEKS }, (_, i) => i + 1),
    MAX_CONCURRENT_REQUESTS,
    async (week) => ({
      week,
      rows: await sleeperGet<SleeperTradeLike[]>(
        `/league/${args.sleeperLeagueId}/transactions/${week}`,
      ),
    }),
  )

  /*
   * 🛑 THE PROOF, ASSEMBLED HERE AND NOWHERE ELSE. `sleeperGet` returns null for ANY failure, so a
   * single failed week means we did not read the whole feed — and an offer missing from a feed we
   * only partly read is not evidence that it is gone. Every week must have come back.
   */
  const feedComplete = weeks.every((w) => w.rows != null)

  const offers: NormalizedOffer[] = []
  for (const { week, rows } of weeks) {
    for (const tx of rows ?? []) {
      const offer = normalizeSleeperTradeOffer(tx, { week })
      if (offer) offers.push(offer)
    }
  }

  try {
    const persisted = await persistProviderTradeOffers({
      leagueId: args.leagueId,
      sport: args.sport,
      season: args.season,
      provider: 'sleeper',
      offers,
      feedComplete,
      seenAt: args.now,
    })
    return {
      leagueId: args.leagueId,
      offersSeen: offers.length,
      offersWritten: persisted.offersWritten,
      vanished: persisted.vanished,
      feedComplete,
    }
  } catch (e) {
    return {
      leagueId: args.leagueId,
      offersSeen: offers.length,
      offersWritten: 0,
      vanished: 0,
      feedComplete,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * One rotation slice, swept.
 *
 * ⚠ FAILURE-CONTAINED PER LEAGUE. One league's provider hiccup must not end the sweep — the next
 * league's offers are unrelated, and a run that stops at the first error covers the head of the
 * rotation forever and the tail never.
 */
export async function sweepProviderTradeOffers(args?: {
  maxLeagues?: number
  now?: Date
}): Promise<OfferSweepResult> {
  const now = args?.now ?? new Date()
  const limit = args?.maxLeagues ?? 15

  const leagues = await prisma.league
    .findMany({
      where: {
        platform: { equals: 'sleeper', mode: 'insensitive' },
        platformLeagueId: { not: '' },
      },
      select: { id: true, platformLeagueId: true, sport: true, season: true },
      // Stable ordering — see rotationWindow. Never order on a column this sweep writes.
      orderBy: { id: 'asc' },
    })
    .catch(() => [])

  const result: OfferSweepResult = {
    leaguesEligible: leagues.length,
    leaguesSwept: 0,
    offersWritten: 0,
    vanished: 0,
    feedIncomplete: 0,
    results: [],
  }
  if (leagues.length === 0) return result

  for (const league of rotationWindow(leagues, limit, now.getTime())) {
    if (!league.platformLeagueId) continue
    const one = await syncProviderTradeOffersForLeague({
      leagueId: league.id,
      sleeperLeagueId: league.platformLeagueId,
      sport: String(league.sport ?? 'NFL'),
      season: league.season ?? null,
      now,
    })
    result.results.push(one)
    result.leaguesSwept += 1
    result.offersWritten += one.offersWritten
    result.vanished += one.vanished
    if (!one.feedComplete) result.feedIncomplete += 1
  }
  return result
}
