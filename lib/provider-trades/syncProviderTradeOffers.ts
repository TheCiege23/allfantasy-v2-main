import 'server-only'

import { prisma } from '@/lib/prisma'
import { runWithConcurrency } from '@/lib/async-utils'
import { sleeperGet, type FeedTrade } from '@/lib/trade-intel/sleeperTradeSync'
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

/**
 * The trades the notify sweep is about to alert on, written to the ledger the moment they are seen.
 *
 * 🛑 WHY (trade system handoff, Phase 2). The ledger was written ONLY by the rotation above — 15
 * leagues a run, each read in full — so an offer got its first row whenever the rotation happened to
 * reach its league. Measured 2026-09-25: 124 of 124 offers in eight days were first recorded
 * already ACCEPTED (median 4.5–36 h after the fact), so `firstSeenAt` was the acceptance, the
 * `pending` phase was never on the ledger at all, and "sitting for 3 days" could not be computed.
 * The notify sweep sees every new offer within a tick (`detectAndNotifyRecent`), from a feed row
 * already in hand; this writes that row. No extra provider request.
 *
 * ⚠ ONLY WHAT THE SWEEP IS ALERTING ON, not every trade in its slice. Every tick re-reading the
 * same unchanged trades into ~2 upserts and an asset rewrite each, for every AllFantasy copy of
 * every league, would be a steady write load for rows the rotation keeps fresh anyway. New offers
 * and completions are exactly the moments the ledger was missing.
 *
 * ⚠ NEVER MARKS ANYTHING `vanished`. `feedComplete` is false by construction: a slice, or a feed
 * read without the all-weeks proof, is not evidence of absence. Retiring stays with the rotation,
 * which carries that proof.
 *
 * ⚠ ONE ROW SET PER AF LEAGUE ROW, as the rotation writes them — a Sleeper league imported by
 * three people is three AF leagues, and each reads its own ledger.
 *
 * Never throws: an alert must not be lost to a ledger write.
 */
export async function recordSweptTradesOnLedger(args: {
  leagues: ReadonlyArray<{ id: string; sport: string | null; season: number | null }>
  trades: ReadonlyArray<FeedTrade>
  now?: Date
}): Promise<{ offersWritten: number; leaguesFailed: number }> {
  const out = { offersWritten: 0, leaguesFailed: 0 }
  const offers: NormalizedOffer[] = []
  for (const t of args.trades) {
    // The raw row when the feed kept it; otherwise the fields FeedTrade carries, with no payload
    // rather than a reconstructed one that would read as what Sleeper sent.
    const tx: SleeperTradeLike = t.raw
      ? (t.raw as SleeperTradeLike)
      : {
          transaction_id: t.id,
          type: 'trade',
          status: t.status,
          roster_ids: t.rosterIds,
          creator: t.creator,
          created: t.createdMs,
          adds: t.tx.adds ?? null,
          drops: t.tx.drops ?? null,
          draft_picks: (t.tx.draft_picks ?? null) as SleeperTradeLike['draft_picks'],
          waiver_budget: (t.tx.waiver_budget ?? null) as SleeperTradeLike['waiver_budget'],
        }
    const offer = normalizeSleeperTradeOffer(tx, { week: typeof t.week === 'number' ? t.week : null })
    if (offer) offers.push(t.raw ? offer : { ...offer, payload: undefined })
  }
  if (offers.length === 0) return out

  const seenAt = args.now ?? new Date()
  for (const league of args.leagues) {
    try {
      const persisted = await persistProviderTradeOffers({
        leagueId: league.id,
        sport: String(league.sport ?? 'NFL'),
        season: league.season ?? null,
        provider: 'sleeper',
        offers,
        feedComplete: false,
        seenAt,
      })
      out.offersWritten += persisted.offersWritten
    } catch (e) {
      out.leaguesFailed += 1
      console.warn('[offer-ledger] swept trades not recorded', {
        leagueId: league.id,
        name: e instanceof Error ? e.name : typeof e,
      })
    }
  }
  return out
}

