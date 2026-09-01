/**
 * The fourth sibling: Sleeper transactions -> `TransactionFact`.
 *
 * ── 🛑 THE DATA WAS ALREADY BOUGHT AND THROWN AWAY ───────────────────────────────────────────
 *
 * `SleeperLeagueFetchService` fetches `/league/{id}/transactions/{week}` for 18 weeks of every
 * league, and `SleeperHistoryMapper` normalises the result with the right discriminator
 * (`trade | waiver | free_agent`). Nothing then persisted it. `SleeperHistoricalBackfillService`
 * orchestrates draft, matchup and season-state; transactions is the sibling nobody wrote.
 *
 * ── ⚠ WHAT THE SCOPE DOC GOT WRONG, AND IT CHANGES WHAT THIS FILE IS FOR ────────────────────
 *
 * docs/decision-os/SLEEPER_HISTORY_SCOPE.md §4 says a trade made in Sleeper "never arrives", and
 * that the league brief's trade count came from a hand-run script. That is not true, and the
 * census that found it wrong is the one this repo keeps having to redo:
 *
 *   /api/cron/import-players  (every six hours; cron literal omitted — it contains the
 *                              two characters that end a block comment, which is how the
 *                              first draft of this header silently became executable code)
 *     -> refreshStaleLeagueProfiles({ maxLeagues: 3 })
 *       -> ingestSleeperTradeFacts()          lib/psychological-profiles/SleeperTradeFactIngest.ts
 *         -> prisma.transactionFact.upsert()
 *
 * So Sleeper TRADES are scheduled and do land. Two things are still true and are why this exists:
 *
 *   1. ⚠ THE ROTATION IS THREE LEAGUES EVERY SIX HOURS. Twelve a day against 543 imported
 *      leagues is a ~45-day lap. That is "eventually", not "up to date", and the product rule is
 *      that a user must never feel they are reading stale information.
 *   2. 🛑 WAIVERS AND FREE AGENTS ARE WRITTEN BY NOBODY. `SleeperTradeFactIngest` opens with
 *      `if (tx.type !== 'trade' ...) continue`. Every other provider — ESPN, Fantrax, MFL,
 *      Yahoo — writes all types from its historical backfill. Sleeper was the only one that did
 *      not, which is why `MetaAnalysisService` reads `transactionFact` next to `waiverClaims`
 *      and finds nothing for Sleeper leagues.
 *
 * ── ✅ NO MIGRATION. THIS WAS THE PART THAT LOOKED BLOCKING AND IS NOT ───────────────────────
 *
 * `TransactionFact` (`dw_transaction_facts`) already exists and is already the imported-history
 * table for four providers. It is NOT `AfLeagueTrade`, which is the native engine's table — and
 * per the user's decision that separation is the point: the native engine accepts, rejects,
 * counters, vetoes and PROCESSES trades, and there is nowhere to write an acceptance back to for
 * a trade that happened in Sleeper. Imported history is read-only by nature and the table
 * boundary is what makes that structural instead of a convention someone has to remember.
 *
 * ── ⚠ THE KEY IS DELIBERATE: THIS CONVERGES WITH THE EXISTING WRITER RATHER THAN RACING IT ──
 *
 * `transactionId` is the model's `@id`, and `SleeperTradeFactIngest` composes it as
 * `${sleeperTransactionId}:${rosterId}`. This service uses the SAME composition, so when both
 * paths see the same trade they upsert the SAME ROW. Inventing a second key here would have put
 * duplicate trades into a warehouse table that `MetaAnalysisService` counts, and nothing would
 * have failed — the numbers would simply have been wrong.
 */

import { normalizeSportForWarehouse } from '@/lib/data-warehouse/types'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { getLeagueTransactions, getNflState, type SleeperTransaction } from '@/lib/sleeper-client'
import { getSleeperHistoricalLeagueChain } from './SleeperHistoricalLeagueChain'
import { shouldSkipImportedSeason } from '../seasonCompletion'

/** Sleeper reports a regular season plus playoffs inside 18 legs. */
const MAX_WEEK = 18

/**
 * The first week worth re-reading for a season we already hold rows for.
 *
 * ── ⚠ WHY NOT JUST THE CURRENT WEEK ─────────────────────────────────────────────────────────
 * Sleeper backdates a late waiver settlement into the week it belonged to, so a strict
 * "current week only" window would lose those permanently rather than merely late. One week of
 * overlap costs a single request and removes that whole class of miss.
 *
 * 🛑 AND AN UNKNOWN WEEK WIDENS, NEVER NARROWS. `getNflState()` returning null is not evidence
 * that nothing changed — it is the absence of evidence, and the two must not read the same. The
 * expensive direction is the safe one, so this falls back to walking everything.
 *
 * Pure so every branch is testable without a database or a provider.
 */
export function firstWeekToFetch(args: {
  hasExistingRows: boolean
  currentWeek: number | null
}): number {
  // A first pass has nothing to be incremental about.
  if (!args.hasExistingRows) return 1
  const wk = args.currentWeek
  if (typeof wk !== 'number' || !Number.isFinite(wk) || wk <= 1) return 1
  return Math.max(1, Math.min(wk, MAX_WEEK) - 1)
}

export interface SleeperHistoricalTransactionSyncSummary {
  attempted: boolean
  refreshed: boolean
  skipped: boolean
  reason?: string
  seasonsImported?: number
  importedTransactionCount?: number
  importedFactCount?: number
  /** Split out because the two are different products, per the user's standing instruction. */
  tradeCount?: number
  waiverCount?: number
  freeAgentCount?: number
  error?: string
  /** Completion-gate counters, mirroring the draft and season-state siblings. */
  seasonsConsidered?: number
  seasonsSkippedAlreadyComplete?: number
  providerCallsAvoided?: number
}

type PendingTransactionFact = {
  transactionId: string
  leagueId: string
  sport: string
  type: string
  playerId: string | null
  managerId: string
  rosterId: string
  season: number
  weekOrPeriod: number
  payload: Record<string, unknown>
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Unknown error'
}

/**
 * The rosters a transaction touched.
 *
 * ⚠ `roster_ids` is the authority and `adds`/`drops` are the fallback. A commissioner move can
 * carry an empty `roster_ids` while still naming a roster in `adds`, and a row with no manager is
 * a fact nobody can be asked about.
 */
function rostersInvolved(tx: SleeperTransaction): string[] {
  const ids = new Set<string>()
  for (const r of tx.roster_ids ?? []) ids.add(String(r))
  for (const r of Object.values(tx.adds ?? {})) ids.add(String(r))
  for (const r of Object.values(tx.drops ?? {})) ids.add(String(r))
  /*
   * ⚠ A ROSTER THAT ONLY MOVED FAAB STILL PARTICIPATED. Caught by a test rather than by reading:
   * the first version scanned roster_ids/adds/drops only, so the RECEIVER of a FAAB-only transfer
   * got no row at all. In practice both sides of a FAAB trade are usually in `roster_ids` too,
   * which is exactly why this would have sat undetected — it is the unusual transaction that
   * loses a participant, and a missing row is not something a consumer can notice.
   */
  for (const b of tx.waiver_budget ?? []) {
    ids.add(String(b.sender))
    ids.add(String(b.receiver))
  }
  return [...ids]
}

/**
 * A waiver claim's winning bid.
 *
 * ⚠ THIS IS NOT `waiver_budget`, AND CONFLATING THEM WOULD MISREPORT BOTH. `waiver_budget` is
 * FAAB moving BETWEEN two rosters (a trade). `settings.waiver_bid` is FAAB a roster spent TO THE
 * LEAGUE to win a claim. A waiver captured without its bid is a half-fact — the whole point of
 * FAAB history is what people were willing to pay — so it is read here rather than left behind.
 */
function waiverBidFor(tx: SleeperTransaction): number | null {
  const raw = (tx.settings ?? {}).waiver_bid
  const bid = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(bid) ? bid : null
}

/** The players this roster added and dropped in this transaction. */
function playersFor(
  tx: SleeperTransaction,
  rosterId: string,
): { adds: string[]; drops: string[] } {
  const adds = Object.entries(tx.adds ?? {})
    .filter(([, r]) => String(r) === rosterId)
    .map(([playerId]) => playerId)
  const drops = Object.entries(tx.drops ?? {})
    .filter(([, r]) => String(r) === rosterId)
    .map(([playerId]) => playerId)
  return { adds, drops }
}

/** FAAB moved to or from this roster, when the league runs a budget. */
function budgetFor(tx: SleeperTransaction, rosterId: string): number | null {
  let net = 0
  let touched = false
  for (const b of tx.waiver_budget ?? []) {
    if (String(b.receiver) === rosterId) {
      net += b.amount
      touched = true
    }
    if (String(b.sender) === rosterId) {
      net -= b.amount
      touched = true
    }
  }
  return touched ? net : null
}

export function buildTransactionFacts(args: {
  tx: SleeperTransaction
  internalLeagueId: string
  sport: string
  season: number
}): PendingTransactionFact[] {
  const { tx, internalLeagueId, sport, season } = args
  const rows: PendingTransactionFact[] = []

  for (const rosterId of rostersInvolved(tx)) {
    const { adds, drops } = playersFor(tx, rosterId)
    /*
     * ⚠ ONE ROW PER (TRANSACTION, ROSTER), NOT PER PLAYER — because that is the shape
     * `SleeperTradeFactIngest` already writes, and the id must collide with it to converge.
     * The players ride in the payload. ESPN splits per player instead; the two providers
     * genuinely differ here and reconciling them is not this change.
     */
    rows.push({
      transactionId: `${tx.transaction_id}:${rosterId}`,
      leagueId: internalLeagueId,
      sport,
      type: tx.type,
      // A single playerId is only meaningful when the move concerned exactly one player; the
      // column is an index, and guessing a representative for a 3-player trade would make that
      // index lie. The full list is always in the payload.
      playerId: adds.length + drops.length === 1 ? (adds[0] ?? drops[0] ?? null) : null,
      managerId: rosterId,
      rosterId,
      season,
      weekOrPeriod: tx.leg,
      payload: {
        sleeperTransactionId: tx.transaction_id,
        status: tx.status,
        adds,
        drops,
        rosterIds: (tx.roster_ids ?? []).map(String),
        draftPicks: tx.draft_picks ?? [],
        faabNet: budgetFor(tx, rosterId),
        // Kept as its own field, never folded into faabNet — see `waiverBidFor`. One is a
        // transfer between managers, the other is a purchase from the league.
        waiverBid: waiverBidFor(tx),
        createdAt: tx.created ? new Date(tx.created).toISOString() : null,
        creator: tx.creator ?? null,
        source: 'sleeper_historical_transaction_sync',
      },
    })
  }

  return rows
}

export async function syncSleeperHistoricalTransactionsAfterImport(args: {
  leagueId: string
  force?: boolean
  maxPreviousSeasons?: number
}): Promise<SleeperHistoricalTransactionSyncSummary> {
  const league = await prisma.league
    .findUnique({
      where: { id: args.leagueId },
      select: { id: true, sport: true, platform: true, platformLeagueId: true },
    })
    .catch(() => null)

  if (!league) {
    return { attempted: false, refreshed: false, skipped: true, reason: 'League not found.' }
  }
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return {
      attempted: false,
      refreshed: false,
      skipped: true,
      reason:
        'Historical transaction sync only applies to Sleeper leagues with a platformLeagueId.',
    }
  }

  const sport = normalizeSportForWarehouse(league.sport)

  try {
    const chain = await getSleeperHistoricalLeagueChain(
      league.platformLeagueId,
      args.maxPreviousSeasons ?? 10,
    )

    const rows: PendingTransactionFact[] = []
    const seasons: number[] = []
    let seasonsConsidered = 0
    let seasonsSkippedAlreadyComplete = 0
    let providerCallsAvoided = 0
    let transactionCount = 0

    for (const seasonLeague of chain) {
      seasonsConsidered += 1

      /*
       * The same completion gate the draft and season-state siblings carry, and for the same
       * reason it had to be rewritten: an "already has rows" test freezes the season being
       * PLAYED at the moment of import. `shouldSkipImportedSeason` asks the provider whether the
       * season is actually over. See lib/league-import/seasonCompletion.ts.
       */
      const existingRowsForSeason = Boolean(
        await prisma.transactionFact.findFirst({
          where: { leagueId: league.id, season: seasonLeague.season },
          select: { transactionId: true },
        }),
      )

      if (shouldSkipImportedSeason({ force: args.force, league: seasonLeague.league })) {
        if (existingRowsForSeason) {
          seasonsSkippedAlreadyComplete += 1
          providerCallsAvoided += MAX_WEEK
          continue
        }
      }

      /*
       * ── ⚠ AN IN-PROGRESS SEASON WE ALREADY HOLD ONLY GAINS TRANSACTIONS IN RECENT WEEKS ────
       *
       * Re-reading weeks 1-18 of the LIVE season every four hours re-learns seventeen weeks of
       * settled history to discover one week of new rows. The completion gate already skips
       * FINISHED seasons entirely; this is the same idea one level down, for the season that
       * cannot be skipped.
       *
       * Only applied when rows already exist for the season — a first pass still walks all 18,
       * because there is nothing to be incremental about. And it deliberately re-reads the
       * PREVIOUS week as well as the current one: Sleeper backdates a late waiver settlement into
       * the week it belonged to, so a strict "current week only" window would lose those
       * permanently rather than late.
       *
       * ⚠ IF THE WEEK IS UNKNOWN, IT WALKS EVERYTHING. `getNflState` returning null must widen
       * the window, never narrow it — a missing state read is not evidence that nothing changed,
       * and the expensive direction is the safe one.
       */
      const nflState = existingRowsForSeason ? await getNflState() : null
      const firstWeek = firstWeekToFetch({
        hasExistingRows: existingRowsForSeason,
        currentWeek: typeof nflState?.week === 'number' ? nflState.week : null,
      })
      if (firstWeek > 1) providerCallsAvoided += firstWeek - 1

      let sawAnyFeed = false
      for (let week = firstWeek; week <= MAX_WEEK; week++) {
        const weekly = await getLeagueTransactions(seasonLeague.externalLeagueId, week)
        if (!Array.isArray(weekly)) continue
        sawAnyFeed = true
        for (const tx of weekly) {
          /*
           * ⚠ COMPLETED ONLY, MATCHING THE EXISTING WRITER. A failed waiver bid is real
           * behavioural signal and it is deliberately NOT here: this is a fact table of what
           * happened, `SleeperTradeFactIngest` already filters the same way, and writing rows
           * one path produces and the other never updates would make the two diverge on
           * re-run. Failed bids are worth capturing — as their own thing, not by loosening this.
           */
          if (tx?.status !== 'complete') continue
          transactionCount += 1
          rows.push(
            ...buildTransactionFacts({
              tx,
              internalLeagueId: league.id,
              sport,
              season: seasonLeague.season,
            }),
          )
        }
      }

      if (sawAnyFeed) seasons.push(seasonLeague.season)
    }

    if (rows.length === 0) {
      const allAlreadyComplete =
        seasonsConsidered > 0 && seasonsSkippedAlreadyComplete === seasonsConsidered
      return {
        attempted: true,
        refreshed: false,
        skipped: true,
        reason: allAlreadyComplete
          ? 'All discovered seasons already have imported transactions; nothing to refetch.'
          : 'No historical Sleeper transactions were available to import.',
        seasonsImported: 0,
        importedTransactionCount: 0,
        importedFactCount: 0,
        seasonsConsidered,
        seasonsSkippedAlreadyComplete,
        providerCallsAvoided,
      }
    }

    /*
     * 🛑 UPSERT, NOT deleteMany + createMany — WHICH IS WHERE THE OTHER SIBLINGS' SHAPE HAD TO BE
     * BROKEN FROM. The draft sync owns every DraftFact row for its league, so replacing a season
     * wholesale is safe there. This table is SHARED: `SleeperTradeFactIngest` writes trades into
     * it on its own schedule, and a season-scoped delete here would silently drop that writer's
     * rows every time this ran. Same id, converging writes, nothing destroyed.
     */
    let written = 0
    for (const row of rows) {
      const { transactionId, payload, ...rest } = row
      /*
       * ⚠ `Record<string, unknown>` is NOT assignable to Prisma's `InputJsonValue`, and this
       * repo carries ~30 pre-existing errors of exactly that shape — which is precisely why the
       * two this file added were easy to wave through as "more of the known baseline". They were
       * not: they were new, they were mine, and the fix already existed in the writer this
       * service was modelled on. `SleeperTradeFactIngest` wraps the same way.
       */
      const data = { ...rest, payload: toPrismaJsonInput(payload) }
      try {
        await prisma.transactionFact.upsert({
          where: { transactionId },
          create: { transactionId, ...data },
          update: data,
        })
        written += 1
      } catch {
        // One bad row must not lose the rest of a season's history.
      }
    }

    return {
      attempted: true,
      refreshed: written > 0,
      skipped: false,
      seasonsImported: seasons.length,
      importedTransactionCount: transactionCount,
      importedFactCount: written,
      tradeCount: rows.filter((r) => r.type === 'trade').length,
      waiverCount: rows.filter((r) => r.type === 'waiver').length,
      freeAgentCount: rows.filter((r) => r.type === 'free_agent').length,
      seasonsConsidered,
      seasonsSkippedAlreadyComplete,
      providerCallsAvoided,
    }
  } catch (error) {
    return {
      attempted: true,
      refreshed: false,
      skipped: false,
      error: getErrorMessage(error),
    }
  }
}
