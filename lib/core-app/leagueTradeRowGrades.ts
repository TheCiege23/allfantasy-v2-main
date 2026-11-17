import 'server-only'

import { prisma } from '@/lib/prisma'
import { playerIdSpaceFor, resolveTradePlayers, type ResolvedTradePlayer } from '@/lib/decision-os/trade/tradePlayers'
import { getPlayerAnalyticsBatch } from '@/lib/player-analytics'
import { gradeArchivedTradeRows, type ArchivedTradeGrade } from './archivedTradeGrade'
import { LATEST_TRADE_ORDER } from './tradePicks'
import { collapseMirroredTradeRows } from './tradeHistorySelection'

/**
 * A league's stored, completed trades (`LeagueTrade`), one row per trade, each with THE letter.
 *
 * Moved out of `lib/core-app/trades.ts` (`resolveGrades`) on 2026-11-17, unchanged, so the Trade Center's
 * provider-completed history reads the SAME rows through the SAME grader and the SAME frozen originals as
 * /core Trades. Two copies of this read would be two places for one trade's letter to drift, and the frozen
 * table is earliest-wins: whichever copy froze first would decide the other's letter.
 *
 * Read only, DB-first: no provider is called. Every platform whose sync writes `LeagueTrade` rows is covered
 * (Sleeper, ESPN, Yahoo, MFL, Fleaflicker); a league with none answers `available: false` with the reason.
 */
export type LeagueTradeRow = {
  transactionId: string
  season: number | null
  week: number | null
  playersGiven: unknown
  playersReceived: unknown
  picksGiven: unknown
  picksReceived: unknown
  partnerName: string | null
  partnerRosterId: number | null
  tradeDate: Date | null
  history: { sleeperUsername: string | null }
}

export type GradedLeagueTradeRows =
  | { available: false; reason: string }
  | {
      available: true
      /** One row per trade, newest first, the viewer's own copy where one exists. At most `limit`. */
      rows: LeagueTradeRow[]
      /** THE grade per `transactionId`, from that row's point of view. */
      graded: Map<string, ArchivedTradeGrade>
      /** A stored player id to its display name, or null when it could not be named. */
      nameOf: (storedId: string) => string | null
      /** A stored player id to its position, or null. */
      positionOf: (storedId: string) => string | null
      /** True when the stored ids are a provider's own (not Sleeper's) — they have no Sleeper headshot. */
      providerIds: boolean
    }

export async function loadGradedLeagueTradeRows(args: {
  /** The AllFantasy league id — the one grader reads this league's chart and scoring through it. */
  leagueId: string
  platformLeagueId: string | null
  viewerPlatformUserId: string | null
  /** The league's sport, so a Sleeper id is named from its own sport's pool. */
  sport: string | null
  /** The league's platform: which id space its stored player ids are in (`playerIdSpaceFor`). */
  platform: string | null
}): Promise<GradedLeagueTradeRows> {
  const { leagueId, platformLeagueId, viewerPlatformUserId, sport, platform } = args
  if (!platformLeagueId) {
    return { available: false, reason: 'this league has no source platform id, so its trades cannot be matched' }
  }

  const histories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperLeagueId: platformLeagueId },
    select: { id: true, sleeperUsername: true },
  })
  if (histories.length === 0) {
    return { available: false, reason: 'no trade history has been synced for this league' }
  }

  const trades = await prisma.leagueTrade.findMany({
    where: { historyId: { in: histories.map((h) => h.id) } },
    select: {
      transactionId: true, season: true, week: true,
      playersGiven: true, playersReceived: true,
      /*
       * ⚠ THE PICK COLUMNS, WHICH THIS GRADE LIST NEVER READ. Grading "a player and a
       * 2027 1st for a player" on the two players alone is not neutral — it values the
       * pick at zero and favours whichever side gave it. See `gradeableSide`.
       */
      picksGiven: true, picksReceived: true,
      /* The other manager's display name, for the breakdown's labels. */
      partnerName: true,
      /* Which side of the graded ledger is the OTHER one — see `draftedPickNamesForRow`. */
      partnerRosterId: true,
      /* When it completed: a provider league's original is priced at the time of the trade from it. */
      tradeDate: true,
      /* Waiver budget each way — priced on the league's own budget, or the letter is withheld. */
      budgetGiven: true, budgetReceived: true,
      history: { select: { sleeperUsername: true } },
    },
    /*
     * 🛑 `tradeDate` FIRST — see `LATEST_TRADE_ORDER`. Ordering by `(season, week)` is
     * ordering by the LEG Sleeper served a trade under, not by when it happened, and
     * every offseason trade in a league shares one leg.
     */
    orderBy: [...LATEST_TRADE_ORDER],
    /* One source row exists per manager involved. Read enough rows to return
       sixty distinct trades after the mirrored copies are collapsed. */
    take: 240,
  })
  if (trades.length === 0) {
    return { available: false, reason: 'no trades on file for this league' }
  }

  /*
   * One grade per platform transaction. Prefer the viewer's mirrored row so
   * "received" and "gave" are from the same point of view as the page. Before
   * this collapse the grade list could contain two or more entries for one deal
   * while Completed trades contained none, which made the two sections look as
   * though they described different leagues.
   */
  const distinctTrades = collapseMirroredTradeRows(trades, viewerPlatformUserId, 60)

  // Latest snapshot per player. Ranks, not raw values — see tradeGrading.
  const ids = new Set<string>()
  for (const t of distinctTrades) {
    for (const arr of [t.playersGiven, t.playersReceived]) {
      if (Array.isArray(arr)) arr.forEach((x) => ids.add(String(x)))
    }
  }
  /*
   * ⚠ `source: 'FANTASYCALC'` IS AN EXPLICIT LICENCE BOUNDARY, NOT A TIDY FILTER.
   * DynastyProcess's value files are derived from FantasyPros ECR and carry
   * FantasyPros ids and page paths; FantasyPros' terms prohibit commercial use of
   * any portion of their site, and a permissive licence on the redistributing repo
   * cannot relicense third-party data inside it. FantasyCalc is the one source in
   * use here with no such encumbrance.
   *
   * Today only FantasyCalc rows exist, so this filter is currently a no-op — which
   * is exactly why it is written down. The moment a second source is ingested, an
   * unfiltered query would silently start pricing trades on data we may not be
   * licensed to use commercially, and nothing would fail.
   */
  /*
   * ⚠ NEWEST ROW PER ID ONLY, AND ONE EDGE THAT MOVES WITH IT. The old read fetched every dated
   * snapshot and kept the first with a NON-NULL rank — so a player whose newest row carried no rank
   * silently borrowed one from an older day. Now he is unranked, which is what the newest data
   * says. The ingest writes `overallRank ?? null`, so the case is possible; staging held zero such
   * rows on 2026-09-16 (0 of 15,375), so it changes no grade that exists today.
   */

  /*
   * Names and positions, for the breakdown only.
   *
   * ⚠ THIS PATH DELIBERATELY HELD NO NAMES UNTIL NOW — the comment on `withheldReason`
   * below says so, and it was right: a counts-only summary list needs none. The breakdown
   * does, so it is one bounded query over the ids already collected above, issued in
   * parallel with the snapshot read rather than after it. A failure degrades to
   * `Player <id>` in a sentence, never to a wrong name or a missing asset.
   */
  /*
   * 🛑 A PROVIDER LEAGUE'S IDS ARE NOT SLEEPER IDS (Trade OS, 2026-11-16). ESPN, Yahoo, MFL and Fleaflicker
   * leagues keep their `LeagueTrade` rows in the provider's own id space, and this read looked every one up as a
   * Sleeper id — so an MFL "13604" was named and PRICED as whichever Sleeper player holds 13604, and that letter
   * was frozen as the trade's permanent original. Those ids now go through the provider identity map; a
   * player it cannot match is unnamed, which withholds the letter rather than borrowing a stranger's value.
   */
  const space = playerIdSpaceFor({ platform, sport: sport ?? 'NFL' })
  const providerIds = space !== 'sleeper'
  const resolvedProvider: Map<string, ResolvedTradePlayer> = providerIds && ids.size > 0
    ? await resolveTradePlayers([...ids], { space, sport: sport ?? 'NFL' }).catch(() => new Map())
    : new Map()
  const playersPromise =
    ids.size > 0 && !providerIds
      ? prisma.sportsPlayer
          .findMany({
            // Scoped to the league's sport when known: Sleeper numbers its NFL and NBA pools independently.
            where: { ...(sport ? { sport: sport.toUpperCase() } : {}), sleeperId: { in: [...ids] } },
            select: { sleeperId: true, name: true, position: true },
          })
          .catch(() => [] as Array<{ sleeperId: string; name: string; position: string | null }>)
      : Promise.resolve([] as Array<{ sleeperId: string; name: string; position: string | null }>)

  const playerById = new Map((await playersPromise).map((p) => [p.sleeperId, p] as const))

  /*
   * 🛑 THE LETTER IS THE ONE GRADE (2026-09-25). This list used to grade in RANK space — each
   * player's FantasyCalc overall rank pushed through a curve, picks from a separate pick book,
   * defenders from the IDP board, letters on share-of-value bands (65/55/45/35) — a rule of its own
   * beside the Trade Center's. A deal read one letter here and another on every other screen.
   *
   * Now each trade is graded by the one grader (`lib/decision-os/trade/completedTradeGrade.ts`) on
   * this league's own chart and scoring, TODAY, from the row's point of view, without roster need
   * (the trade has happened). The honesty rule survives unchanged: any asset that cannot be priced
   * — an unnamed player, a pick whose draft has been held — withholds the letter; it is never zero.
   */
  const providerHit = (id: string) => {
    const r = resolvedProvider.get(id)
    return r?.ok ? r : null
  }
  const nameOf = (id: string) => (providerIds ? providerHit(id)?.name?.trim() || null : playerById.get(id)?.name?.trim() || null)
  // A provider id prices as the Sleeper id it is linked to, or by name — never as itself.
  const sleeperIdOf = providerIds ? (id: string) => providerHit(id)?.sleeperId ?? null : undefined
  // Warm the per-player analytics cache the pricer reads, in ONE query, before sixty deals hit it.
  const warmNames = providerIds
    ? [...resolvedProvider.values()].flatMap((r) => (r.ok ? [r.name] : []))
    : [...playerById.values()].map((p) => p.name)
  await getPlayerAnalyticsBatch(warmNames).catch(() => null)

  /*
   * 🛑 A USED PICK IS THE PLAYER DRAFTED WITH IT (Guap's ruling, 2026-09-25). The grading itself —
   * drafted-pick names from the league's ledger, then the one grader — lives in
   * `archivedTradeGrade.ts`, shared with the player card so one trade reads one letter on both.
   */
  const gradedRows = await gradeArchivedTradeRows({ afLeagueId: leagueId, platformLeagueId, rows: distinctTrades, nameOf, ...(sleeperIdOf ? { sleeperIdOf } : {}) })

  return {
    available: true,
    rows: distinctTrades,
    graded: gradedRows,
    nameOf,
    positionOf: (id: string) => (providerIds ? providerHit(id)?.position ?? null : playerById.get(id)?.position ?? null),
    providerIds,
  }
}
