import 'server-only'
import { getSleeperTradeHistory } from './sleeperTradeHistory'
import { valueBookFor, type ValueBook } from './valueBook'
import { resolveSourceScreenLink, type SourceScreenLink } from '@/lib/league-links/sourceLinkResolver'

import { prisma } from '@/lib/prisma'
import { loadLatestPickValueSnapshots } from '@/lib/player-values/latestPickValueSnapshots'
import { defenderPricerFrom, type DefenderPricer } from './tradeDefenders'
import { currentSeasonOf } from './todayStrip'
import { readCanonicalDefenderBoard } from '@/lib/values/canonicalDefenderBoardCache'
import { hasIdpScoring } from './scoringNotes'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
import { loadLatestPlayerValueSnapshots } from '@/lib/player-values/latestPlayerValueSnapshots'
import { leagueDisplayName, type SectionState } from './leagueHome'
import { gradeTrade } from '@/lib/projections/tradeGrading'
import {
  LATEST_TRADE_ORDER,
  gradeableSide,
  pickAssets,
  pickPricerFrom,
  withheldTradeReason,
  type UnpricedAsset,
  type TradeAsset,
} from './tradePicks'
import { buildTradeBreakdown, type BreakdownAsset } from './tradeBreakdown'
import {
  scanPendingSleeperTrades,
  type PendingTradeAsset,
} from '@/lib/provider-trades/scanPendingSleeperTrades'
import { createLeagueTradeGrader, gradeDeal } from '@/lib/decision-os/trade/leagueTradeGrader'
import { gradeInputsFromPending } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { collapseMirroredTradeRows } from './tradeHistorySelection'
import { leagueContextFor, type LeagueContext } from './leagueContext'

/**
 * Trades — "offer, grade, counter, all scored against this league's own rules".
 *
 * Sleeper now returns early through sleeperTradeHistory, sharing the email's
 * ledger and projections. The warehouse/import notes below describe the
 * remaining fallback path, not the current Sleeper screen.
 *
 * WHAT IS REAL: completed trade history, from dw_transaction_facts. 7,124 trade
 * rows across the imported leagues, each carrying the transaction id, the two
 * roster ids, the season and week, and how many players and picks moved each way.
 *
 * ⚠ WHAT IS NOT IN THAT PAYLOAD: WHICH players moved. It stores counts
 * (`playersIn: 1, playersOut: 1, picks: 0`), not identities.
 *
 * 🛑 BUT "WE DO NOT KNOW WHICH PLAYERS" WAS TOO STRONG, AND THIS COMMENT SAID IT
 * FOR MONTHS. `LeagueTrade` holds the Sleeper id arrays for the same trades, and
 * 17,501 of 17,657 trade facts — 99.1%, measured 2026-09-07 — join to it on
 * `payload.sleeperTransactionId`. The names were one join away the whole time.
 * `TradeRecord.players` now carries them, and the screen renders them as
 * clickable player cards.
 *
 * 🛑 AND THE FIRST FIX UNDER-CLAIMED IN THE SAME WAY. It said direction was
 * unrecoverable — while naming, in that very sentence, the mechanism that
 * recovers it. `playersGiven` / `playersReceived` ARE directional with respect to
 * `LeagueTradeHistory.sleeperUsername`, which is the same join that supplies the
 * rows. Measured on a real mirrored pair:
 *
 *   tx 1022535786568249344  owner 411273464511479808  got  ["9756"]
 *   tx 1022535786568249344  owner 671391748378935296  gave ["9756"]
 *
 * So `TradeRecord.players` carries one entry PER SIDE, named by the manager who
 * received it. Twice now the honest-looking move was to declare data absent; both
 * times it was one join away. Check the join before writing the refusal.
 *
 * ⚠ NO LETTER GRADE IS STILL SHOWN, AND THE REASON IS COVERAGE, NOT DIRECTION.
 * `gradeTrade(received, gave)` works fine now. What withholds the letter is that
 * a grade needs EVERY asset on both sides priced, and `PlayerValueSnapshot`
 * covers ~475 dynasty players — so the withheld reason renders where the letter
 * would be, and it fires often. That is a pricing limit, not an unknowable one. lib/trade-intel exists and will
 * happily return one, but its own hasNoSignal() documents the trap: when no
 * points are credited to either side, every net is 0, every side lands in the C
 * band, and the engine reports a tie it has not earned. A "C" from this data
 * would mean ZERO DATA while reading as "an average trade". The grade slot is
 * rendered as explicitly ungradable instead — refusing the letter is the whole
 * point, and it is easier to add a real grade later than to retract a wrong one.
 */

/** A named player in a trade, enough to open his card. */
export type TradePlayerRef = {
  sleeperId: string
  name: string
  position: string | null
  team: string | null
  headshotUrl?: string | null
  teamLogoUrl?: string | null
}

export type TradeRecord = {
  transactionId: string
  season: number | null
  week: number | null
  /** Roster ids on each side, as stored. */
  rosterIds: string[]
  yourSide: 'in' | 'out' | 'unknown'
  playersIn: number
  playersOut: number
  picks: number
  partnerTeamName: string | null
  at: Date
  /**
   * Who received what, per side.
   *
   * ⚠ THIS WAS SHIPPED AS ONE UNORDERED SET AND THAT WAS UNDER-CLAIMING. The
   * first version said direction was unrecoverable — while naming, in the same
   * comment, the exact mechanism that recovers it. `playersGiven` /
   * `playersReceived` on a `LeagueTrade` row are directional **with respect to
   * its history's `sleeperUsername`**, and that history is the join that already
   * supplies the rows. Measured 2026-09-07 on a real mirrored pair:
   *
   *   tx 1022535786568249344  owner 411273464511479808  got  ["9756"]
   *   tx 1022535786568249344  owner 671391748378935296  gave ["9756"]
   *
   * So each side is named by the manager who RECEIVED it. Caught by the
   * core-boards session, whose board had been grading on this the whole time.
   *
   * ⚠ `manager` IS NULL WHEN THE ID DOES NOT RESOLVE, and that is a real case:
   * `sleeperUsername` holds a numeric Sleeper user id, which maps to
   * `LeagueTeam.platformUserId` for 3,413 of 4,362 histories (78%) and to
   * `externalId` for ZERO. An unresolved side renders as "another manager"
   * rather than as a raw id or a guessed name.
   *
   * Empty when the `LeagueTrade` join missed entirely — never a partial side,
   * which would read as "these are the only players in it".
   */
  players: Array<{
    /** Team name, else owner name, else null. */
    manager: string | null
    avatarUrl?: string | null
    isYou: boolean
    received: TradePlayerRef[]
    picks?: string[]
    grade?: 'A' | 'B' | 'C' | 'D' | 'F' | null
    gradeBasis?: 'Market' | 'Realized'
    gradeNote?: string
  }>
}

export type GradedTrade = {
  transactionId: string
  season: number | null
  week: number | null
  /** Present only when every asset on both sides could be priced. */
  letter: 'A' | 'B' | 'C' | 'D' | 'F' | null
  sharePct: number | null
  /** Why no letter — shown INSTEAD of a grade, never alongside one. */
  withheldReason: string | null
  playersIn: number
  playersOut: number
  /**
   * Picks each way. Counts only — `pickAssets` can name them, but this list's row is a
   * one-line summary and a count is what it has room for. They are here because a "2 for
   * 1" that was really "2 for 1 plus a first" reads as a different trade.
   */
  picksIn: number
  picksOut: number
  /**
   * Why it graded that way, in sentences.
   *
   * ⚠ EMPTY UNLESS THIS ROW IS THE VIEWER'S OWN. `collapseMirroredTradeRows` keeps the
   * viewer's copy of a mirrored trade where one exists, and only then do we hold a name for
   * both sides — "You" plus `partnerName`. For a trade between two OTHER managers this path
   * holds a platform user id for one side and no display name at all, and captioning a real
   * manager's trade with an invented label is worse than saying nothing.
   */
  breakdown: string[]
}

/**
 * Grade this league's trades from real player values.
 *
 * ⚠ THE COUNTS-ONLY COMMENT ABOVE IS TRUE OF THE FACTS TABLE, NOT OF ALL TRADE
 * DATA. `history` above is built from behavioural facts whose payload really does
 * carry only playersIn/playersOut counts — so grading THAT source is impossible,
 * exactly as documented. `LeagueTrade` is a different table holding the actual
 * Sleeper player ids (6,813 rows, 835 distinct players), and that is what is
 * priced here. Two sources, two answers; conflating them is what made grading look
 * permanently blocked.
 *
 * ⚠ A LETTER APPEARS ONLY WITH FULL COVERAGE ON BOTH SIDES. Measured on
 * production: 944 of 3,221 two-sided trades are only partially valued. Grading
 * those would treat every unpriced player as worthless, which is not neutral — it
 * mechanically favours whichever manager received him.
 */
async function resolveGrades(
  platformLeagueId: string | null,
  book: ValueBook,
  viewerPlatformUserId: string | null,
  /*
   * This league's raw settings, for the IDP gate only.
   *
   * ⚠ PASSED RATHER THAN RE-QUERIED. `resolveLeagueIdpScoring` is the named authority and
   * costs a `league` read; the caller already holds these settings to build `book`, and
   * `hasIdpScoring` reaches the same verdict from them.
   */
  leagueSettings: unknown,
): Promise<SectionState<GradedTrade[]>> {
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
  /* Free: the settings are already loaded for the value book. See `resolveLeagueIdpScoring`. */
  const idpScoring = hasIdpScoring(extractScoringSettings(leagueSettings) ?? {})

  /*
   * Names and positions, for the breakdown only.
   *
   * ⚠ THIS PATH DELIBERATELY HELD NO NAMES UNTIL NOW — the comment on `withheldReason`
   * below says so, and it was right: a counts-only summary list needs none. The breakdown
   * does, so it is one bounded query over the ids already collected above, issued in
   * parallel with the snapshot read rather than after it. A failure degrades to
   * `Player <id>` in a sentence, never to a wrong name or a missing asset.
   */
  const playersPromise =
    ids.size > 0
      ? prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: [...ids] } },
            select: { sleeperId: true, name: true, position: true },
          })
          .catch(() => [] as Array<{ sleeperId: string; name: string; position: string | null }>)
      : Promise.resolve([] as Array<{ sleeperId: string; name: string; position: string | null }>)

  const snaps = await loadLatestPlayerValueSnapshots({
    sleeperIds: ids,
    /*
     * 🛑 THE BOOK IS THIS LEAGUE'S, NOT A HARDCODED DYNASTY/SUPERFLEX PAIR.
     * These three literals used to be pinned here and copied verbatim into the
     * player card and the cross-league trades board, so that the three could
     * not disagree. They agreed and were jointly wrong: a redraft league was
     * graded off the dynasty book, which prices a 22-year-old rookie above a
     * 30-year-old who will outscore him this season. `valueBook.ts` carries the
     * one derivation and the licence reasoning for `source`.
     */
    source: book.source,
    format: book.format,
    qbFormat: book.qbFormat,
  })
  const playerById = new Map((await playersPromise).map((p) => [p.sleeperId, p] as const))

  const rankById = new Map<string, number>()
  for (const s of snaps) {
    if (!rankById.has(s.sleeperId) && s.overallRank != null) rankById.set(s.sleeperId, s.overallRank)
  }

  /*
   * 🛑 PICK PRICES FOR THIS BOOK — A SEPARATE READ, BECAUSE THERE IS NO ID TO ASK FOR.
   * A trade stores a pick as `{ season, round }` and FantasyCalc keys it by a synthetic token
   * (`FP_2027_early_0`), so the NAME is the whole join and `loadLatestPlayerValueSnapshots`,
   * which takes the ids it returns, structurally cannot serve it.
   *
   * ⚠ FAILURE HERE LEAVES PICKS UNPRICED, WHICH WITHHOLDS LETTERS RATHER THAN INVENTING THEM.
   * That is the same outcome this screen had before picks were stored at all, so a read error
   * costs grades and never correctness.
   */
  const pickRows = await loadLatestPickValueSnapshots({
    source: book.source,
    format: book.format,
    qbFormat: book.qbFormat,
  }).catch(() => [])
  /*
   * Dated by the board being quoted, with no clock fallback — see `tradesBoard.ts` for the
   * cacheability contract that forbids one there, and for why an undated market should make
   * no claim about age rather than borrow the reader's wall clock.
   */
  const newestCapture = snaps.reduce<Date | null>(
    (acc, s) => (acc == null || s.capturedAt > acc ? s.capturedAt : acc),
    null,
  )
  const marketSeason = newestCapture ? currentSeasonOf(newestCapture) : null

  const pickPrice = pickPricerFrom(pickRows)

  /*
   * Defenders, from the board that already prices them — and ONLY where this league starts
   * them. FantasyCalc publishes no defenders at any tier, so before this every IDP trade in
   * the league withheld its letter. Replacement level is a function of starting requirements,
   * so a league that starts none must keep seeing them unpriced rather than be handed a
   * number describing a slot it does not have.
   */
  const defenders: DefenderPricer = idpScoring
    ? defenderPricerFrom(
        await readCanonicalDefenderBoard({ prisma, isDynasty: book.format === 'DYNASTY' }).catch(() => null),
      )
    : () => null

  /*
   * What this league's book could not price, by kind.
   *
   * ⚠ `rankById` IS THE PREDICATE, because grading counts an asset as covered only when it
   * carries a RANK. `overallRank` is nullable, so a stored value is not the same claim.
   */
  const unpricedOf = (
    recv: readonly string[],
    gave: readonly string[],
    picksIn: readonly { pickSeason?: string; pickRound?: number; name: string }[],
    picksOut: readonly { pickSeason?: string; pickRound?: number; name: string }[],
  ): UnpricedAsset[] => {
    const out: UnpricedAsset[] = []
    for (const id of [...recv, ...gave]) {
      /* Same predicate the grade uses — see `rankOf`. Diverging here is how the reason
         names an asset the grader just counted. */
      if (rankById.get(id) == null && defenders(id) == null) out.push({ kind: 'player' })
    }
    for (const p of [...picksIn, ...picksOut]) {
      const priced = p.pickSeason && p.pickRound != null ? pickPrice(p.pickSeason, p.pickRound) : null
      if (!priced) out.push({ kind: 'pick', name: p.name })
    }
    return out
  }

  const graded: GradedTrade[] = distinctTrades.map((t) => {
    const recv = (Array.isArray(t.playersReceived) ? t.playersReceived : []).map(String)
    const gave = (Array.isArray(t.playersGiven) ? t.playersGiven : []).map(String)
    const picksIn = pickAssets(t.picksReceived, pickPrice)
    const picksOut = pickAssets(t.picksGiven, pickPrice)
    const rankOf = (id: string) => rankById.get(id) ?? defenders(id)?.rank ?? null
    const g = gradeTrade(
      { label: 'received', assets: gradeableSide(recv, rankOf, picksIn, pickPrice) },
      { label: 'gave', assets: gradeableSide(gave, rankOf, picksOut, pickPrice) },
    )

    /*
     * 🛑 ONLY THE VIEWER'S OWN ROW, because only there do we hold a name for both sides.
     * `collapseMirroredTradeRows` keeps the viewer's copy when one exists; where it did not,
     * `history.sleeperUsername` is a PLATFORM USER ID rather than a display name, and
     * captioning another manager's trade with an id — or with an invented label — is worse
     * than the silence it would replace.
     */
    const mine = viewerPlatformUserId != null && t.history.sleeperUsername === viewerPlatformUserId

    /*
     * ⚠ THE RANKS ARE THE GRADER'S OWN, VIA `rankOf` — the same function `gradeableSide`
     * was just handed, not a second predicate over the same maps. `buildTradeBreakdown`
     * takes a rank rather than a value precisely so the display price cannot be passed here
     * by mistake; see its header.
     */
    const breakdownAssets = (
      playerIds: readonly string[],
      picks: readonly TradeAsset[],
    ): BreakdownAsset[] => [
      ...playerIds.flatMap((id) => {
        const rank = rankOf(id)
        if (rank == null) return []
        const p = playerById.get(id)
        return [{
          name: p?.name ?? `Player ${id}`,
          kind: 'player' as const,
          position: p?.position ?? null,
          rank,
        }]
      }),
      ...picks.flatMap((p) => {
        const rank = p.pickSeason && p.pickRound != null ? pickPrice(p.pickSeason, p.pickRound)?.rank ?? null : null
        return rank == null ? [] : [{ name: p.name, kind: 'pick' as const, position: null, rank }]
      }),
    ]

    const breakdown =
      g.graded && mine
        ? buildTradeBreakdown({
            received: breakdownAssets(recv, picksIn),
            gave: breakdownAssets(gave, picksOut),
            letter: g.letter,
            sharePct: g.sharePct,
            receiverLabel: 'You',
            partnerLabel: t.partnerName?.trim() || 'the other side',
          })
        : []

    return {
      transactionId: t.transactionId,
      season: t.season ?? null,
      week: t.week ?? null,
      letter: g.graded ? g.letter : null,
      sharePct: g.graded ? g.sharePct : null,
      /*
       * ⚠ KINDS, NOT NAMES, AND NOT A COUNT. This path never loads player names — it
       * produces counts for a summary list — so it cannot say "DeMarvion Overshown" the way
       * the cross-league board can. It can still say whether the gap is a PLAYER or a PICK,
       * which is the part the old count-matching guess got wrong.
       */
      withheldReason: g.graded ? null : withheldTradeReason(g, unpricedOf(recv, gave, picksIn, picksOut), {
              tradeSeason: t.season ?? null,
              currentSeason: marketSeason,
            }),
      playersIn: recv.length,
      playersOut: gave.length,
      picksIn: picksIn.length,
      picksOut: picksOut.length,
      breakdown,
    }
  })

  return { available: true, data: graded }
}

export type TradesData = {
  canonicalHistory?: boolean
  historyNotice?: string
  league: {
    id: string
    name: string
    platform: string
    /**
     * Where the trade is actually SENT.
     *
     * 🛑 AllFantasy CANNOT SEND A TRADE, AND THIS SCREEN NEVER SAID SO. Sleeper's
     * API is read-only and the ESPN/Yahoo integrations are read-only too, so a
     * trade built here has to be re-entered on the source platform to exist. My
     * Team and Matchup both carry a `sourceLink` for exactly that reason; the
     * trade builder — the one screen whose whole output is an action the user
     * must take elsewhere — was the one that did not, so the flow dead-ended on
     * a proposal with nowhere to go.
     *
     * Resolved server-side through the one hardened resolver (exact-host HTTPS
     * allowlist), with `screen: 'trade'` so it lands on the platform's own trade
     * page rather than the league home. Null for a native league, where there is
     * no source to open.
     */
    sourceLink: SourceScreenLink | null
  }
  /** Grading context the handoff prints above every grade. */
  gradingContext: SectionState<{ leagueName: string; format: string | null; teamCount: number }>
  history: SectionState<TradeRecord[]>
  /**
   * Offers waiting on the source platform, read LIVE.
   *
   * 🛑 THESE WERE `UnavailableSection` — "no data path at all, always" — and the
   * reason they printed said `pending offers are not ingested`. That was FALSE,
   * and had been since `scanPendingSleeperTrades` shipped: the Trade Center reads
   * exactly these offers on every load, off `platformLeagueId`, on a 5-minute
   * cache. The capability existed; this screen simply never called it, and told
   * the manager the product could not do a thing it was already doing one screen
   * over.
   *
   * ⚠ `SectionState`, NOT `UnavailableSection`, AND THE DISTINCTION IS THE POINT.
   * The latter is a permanent claim about the product. The former can say "we
   * looked and there is nothing", which is a fact about the league — and those two
   * must never render as the same sentence.
   */
  inbox: SectionState<PendingOffer[]>
  sent: SectionState<PendingOffer[]>
  grades: SectionState<GradedTrade[]>
  deadline: SectionState<TradeDeadline>
}

/** One asset on one side of a pending offer, already in display form. */
export type PendingOfferLine = {
  label: string
  /** Position · team, or "Draft pick". Null when the provider named neither. */
  sublabel: string | null
}

/**
 * An offer sitting unanswered on the source platform.
 *
 * ⚠ READ-ONLY BY CONSTRUCTION, AND THE SCREEN MUST NOT OFFER ACTIONS. Sleeper's
 * public API has no write endpoint, so AllFantasy can show and grade these and
 * can never accept, reject or counter one. `sourceLink` on `TradesData.league`
 * is how a manager gets to the place they can answer it.
 */
export type PendingOffer = {
  /** Sleeper's transaction id — stable, and the natural React key. */
  id: string
  /** Who sent it. "You" on an outgoing offer. */
  partnerName: string
  proposedAt: string | null
  /** Leaving the viewer's roster — on BOTH directions, so an outgoing offer
      is not rendered back to front. */
  give: PendingOfferLine[]
  /** Arriving on the viewer's roster. */
  get: PendingOfferLine[]
  /**
   * THE grade for this offer, from the viewer's side — the same letter the Trade Center, the league
   * page and Chimmy show for the same deal (`lib/decision-os/trade/tradeGrade.ts`). It replaced a
   * share-of-traded-value letter (65/55/45/35) that graded a 1.5x deal B while the builder said A.
   */
  evaluation: TradeGradeView
}

export type TradeDeadline = {
  /** Null when the league is configured to allow trades all season. */
  week: number | null
  /** The league's regular season length, when known — context for the week number. */
  regularSeasonLength: number | null
  none: boolean
}

/**
 * The trade deadline, read from the canonical import snapshot.
 *
 * ⚠ `trade_deadline_week` OF 99 MEANS "NO DEADLINE", NOT WEEK 99. Four production
 * leagues carry 99 against regular seasons of 14 and 18 weeks — it is the
 * platform's sentinel for "trades stay open". Printing "Deadline: Week 99" would
 * be a confident, checkable falsehood on a screen people plan around, so the
 * sentinel is translated rather than rendered.
 *
 * Present on 54 of 120 production leagues. The other 66 stay unavailable: the
 * setting was simply never read for them, and "no deadline shown" must not be
 * mistaken for "no deadline exists".
 */
function resolveDeadline(settings: unknown): SectionState<TradeDeadline> {
  if (!settings || typeof settings !== 'object') {
    return { available: false, reason: 'this league’s trade deadline is not ingested' }
  }
  const s = settings as Record<string, unknown>
  const raw = s.trade_deadline_week
  const week = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  if (week == null) {
    return { available: false, reason: 'this league’s trade deadline is not ingested' }
  }

  const rsRaw = s.regular_season_length
  const regularSeasonLength =
    typeof rsRaw === 'number' && Number.isFinite(rsRaw) && rsRaw > 0 ? rsRaw : null

  // Either the explicit sentinel, or a deadline past the end of the season —
  // both mean trades never close.
  const none = week >= 99 || (regularSeasonLength != null && week > regularSeasonLength)

  return { available: true, data: { week: none ? null : week, regularSeasonLength, none } }
}

/** A provider asset in display form. Mirrors the Trade Center's own mapping. */
function offerLine(a: PendingTradeAsset): PendingOfferLine {
  const sub = a.isPick
    ? 'Draft pick'
    : [a.position, a.team].filter((v) => v && v !== '—').join(' · ') || null
  return { label: a.playerName, sublabel: sub }
}

/**
 * Offers waiting on the platform, split into what the viewer received and what
 * they sent.
 *
 * ⚠ FOUR OUTCOMES, AND COLLAPSING ANY TWO OF THEM IS THE BUG THIS REPLACES.
 * "we never looked", "we could not tell whose offers to read", "the provider
 * refused" and "we looked and nothing is waiting" are different facts, and only
 * the middle two are things a manager can act on. An empty inbox that means
 * "not scanned" is a claim about their league we never checked.
 */
async function resolvePendingOffers(
  league: { id: string; platform: string | null; platformLeagueId: string | null; sport: string | null },
  userId: string,
  /** The loader's league context, so the claimed team is not read a second time. */
  lc: LeagueContext,
): Promise<{ inbox: SectionState<PendingOffer[]>; sent: SectionState<PendingOffer[]> }> {
  const platform = String(league.platform ?? 'manual').toLowerCase()

  /*
   * Sleeper only, and said plainly. The Trade Center also reads Yahoo, through
   * that platform's OAuth refresh path; wiring it here means carrying the same
   * auth failure modes onto a server-rendered screen, which is a bigger change
   * than this one and does not belong in it. Naming Sleeper specifically is
   * honest about what this screen does rather than about what the product can.
   */
  if (platform !== 'sleeper' || !league.platformLeagueId) {
    const reason = `pending offers are only readable on Sleeper — open ${platform} to see anything waiting`
    return { inbox: { available: false, reason }, sent: { available: false, reason } }
  }

  /*
   * The viewer's Sleeper id, resolved the way every other league surface
   * resolves it: the claim FIRST because it is an explicit statement about this
   * league, the linked profile second because it is an inference from an id
   * space shared across all of them.
   */
  const viewerSleeperId = await (async () => {
    const claimed = await lc.claimedTeam().catch(() => null)
    const fromClaim = claimed?.platformUserId?.trim()
    if (fromClaim) return fromClaim
    const profile = await prisma.userProfile
      .findUnique({ where: { userId }, select: { sleeperUserId: true } })
      .catch(() => null)
    return profile?.sleeperUserId?.trim() || null
  })()

  if (!viewerSleeperId) {
    const reason = 'claim your team, or link the account you play on, so we know whose offers to read'
    return { inbox: { available: false, reason }, sent: { available: false, reason } }
  }

  const scan = await scanPendingSleeperTrades({
    platformLeagueId: league.platformLeagueId,
    ownerSleeperId: viewerSleeperId,
    sport: league.sport,
  }).catch(() => null)

  /* A throw and a refusal are the same fact to a reader: we did not look. */
  if (!scan || !scan.scanned) {
    const reason = scan?.reason ?? 'Sleeper could not be reached'
    return { inbox: { available: false, reason }, sent: { available: false, reason } }
  }

  /*
   * One grader for every offer on the screen: the league's chart is read once, and each offer is
   * priced and graded on it by the same code the Trade Center runs. Loaded only when there is an
   * offer to grade.
   */
  const grader = scan.trades.length > 0
    ? await createLeagueTradeGrader({ leagueId: league.id, userId }).catch(() => null)
    : null
  const grades = new Map<string, TradeGradeView>()
  await Promise.all(scan.trades.map(async (t) => {
    grades.set(t.transactionId, await gradeDeal(grader, {
      give: gradeInputsFromPending(t.assetsGiven),
      get: gradeInputsFromPending(t.assetsReceived),
      viewerSide: true,
    }))
  }))

  const map = (t: (typeof scan.trades)[number]): PendingOffer => ({
    id: t.transactionId,
    partnerName: t.proposedByViewer ? 'You' : t.proposedBy,
    proposedAt: t.proposedAt,
    /* `assetsGiven` is already viewer-relative in BOTH directions, so an offer
       the manager sent is not rendered back to front. */
    give: t.assetsGiven.map(offerLine),
    get: t.assetsReceived.map(offerLine),
    evaluation: grades.get(t.transactionId) ?? { graded: false, reason: 'This offer could not be graded.', basis: null },
  })

  return {
    inbox: { available: true, data: scan.trades.filter((t) => !t.proposedByViewer).map(map) },
    sent: { available: true, data: scan.trades.filter((t) => t.proposedByViewer).map(map) },
  }
}

export async function getTradesData(
  leagueId: string,
  userId: string,
  /** The render's shared league context — see `leagueContext.ts`. */
  ctx?: LeagueContext | null,
): Promise<TradesData | null> {
  const lc = leagueContextFor(leagueId, userId, ctx)
  /* The shared row. `sport` matters to the pending-offer scan: Sleeper's player
     dictionary is NFL-only, so a non-NFL league must not be handed one. */
  const league = await lc.league()
  if (!league) return null

  const [teamCount, myTeam] = await Promise.all([
    prisma.leagueTeam.count({ where: { leagueId } }),
    lc.claimedTeam(),
  ])
  const book = valueBookFor(league.settings, league.leagueType)
  const grades = await resolveGrades(
    league.platformLeagueId ?? null,
    book,
    myTeam?.platformUserId?.trim() || null,
    league.settings,
  )

  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
      sourceLink: resolveSourceScreenLink({
        platform: league.platform,
        sourceLeagueId: league.platformLeagueId,
        leagueName: leagueDisplayName(league.name),
        season: league.season,
        screen: 'trade',
        action: 'trade',
      }),
    },
    gradingContext: {
      available: true as const,
      data: { leagueName: leagueDisplayName(league.name), format: league.leagueType ?? null, teamCount },
    },
    /*
     * Read LIVE off the platform, not from a table.
     *
     * 🛑 THE COMMENT THAT STOOD HERE SAID "Nothing ingests them", AND IT WAS
     * WRONG THE DAY IT WAS WRITTEN — or became wrong and nobody came back. The
     * reasoning was sound and the premise was false, which is the worst
     * combination: it reads as a considered decision rather than a stale fact,
     * so nobody re-checks it. `scanPendingSleeperTrades` has been serving the
     * Trade Center's inbox this whole time.
     *
     * Nothing INGESTS them, which is true and irrelevant — they are never
     * written to a table, and should not be. A pending offer is answered on the
     * platform, and a cached copy would go stale the moment it was accepted.
     */
    ...(await resolvePendingOffers(league, userId, lc)),
    grades,
    deadline: resolveDeadline(league.settings),
  }

  if (String(league.platform ?? '').toLowerCase() === 'sleeper' && league.platformLeagueId) {
    const current = await getSleeperTradeHistory(
      league.platformLeagueId,
      myTeam?.platformUserId?.trim() || null,
    ).catch(() => null)
    return {
      ...base,
      canonicalHistory: true,
      historyNotice: current?.notice,
      history: current
        ? { available: true, data: current.history }
        : { available: false, reason: 'Trade history could not be refreshed from Sleeper. Please try again.' },
    }
  }

  const facts = await prisma.transactionFact.findMany({
    where: { leagueId, type: 'trade' },
    orderBy: [{ season: 'desc' }, { weekOrPeriod: 'desc' }],
    take: 400,
    select: {
      transactionId: true,
      managerId: true,
      season: true,
      weekOrPeriod: true,
      payload: true,
      createdAt: true,
    },
  })

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: { externalId: true, platformUserId: true, teamName: true, ownerName: true, claimedByUserId: true },
  })
  const teamByExternal = new Map(teams.map((t) => [String(t.externalId), t.teamName]))
  /*
   * ⚠ KEYED ON `platformUserId`, NOT `externalId`. `LeagueTradeHistory.sleeperUsername`
   * is a numeric Sleeper USER id; measured on production it matches `platformUserId`
   * on 3,413 of 4,362 histories and `externalId` on **zero**. Keying this the
   * obvious way would leave every trade side anonymous with nothing to say why.
   */
  const teamByPlatformUser = new Map(
    teams.flatMap((t) =>
      t.platformUserId ? [[String(t.platformUserId), t] as const] : [],
    ),
  )

  // Each trade writes one fact PER SIDE, so collapse on the sleeper transaction
  // id to get one row per trade rather than listing every deal twice.
  const bySleeperTx = new Map<string, typeof facts>()
  for (const f of facts) {
    const payload = (f.payload ?? {}) as Record<string, unknown>
    const key = String(payload.sleeperTransactionId ?? f.transactionId.split(':')[0])
    const bucket = bySleeperTx.get(key) ?? []
    bucket.push(f)
    bySleeperTx.set(key, bucket)
  }

  const mine = myTeam?.externalId != null ? String(myTeam.externalId) : null

  /*
   * Name the players each trade moved.
   *
   * `dw_transaction_facts` carries counts only; `LeagueTrade` carries the Sleeper
   * id arrays. Two bounded queries for the whole page — one for the trades, one
   * to resolve every referenced id to a name — rather than a lookup per row.
   */
  const txIds = [...bySleeperTx.keys()]
  /*
   * Completed history and grades now share LeagueTrade as a source. Transaction
   * facts remain the richer warehouse path for every provider, but a Sleeper
   * league whose historical importer populated LeagueTrade first must not show
   * "no trades" above grades created from those exact rows.
   */
  const tradeRows = league.platformLeagueId || txIds.length
    ? await prisma.leagueTrade
        .findMany({
          where: league.platformLeagueId
            ? {
                OR: [
                  ...(txIds.length ? [{ transactionId: { in: txIds } }] : []),
                  { history: { sleeperLeagueId: league.platformLeagueId } },
                ],
              }
            : { transactionId: { in: txIds } },
          /*
           * ⚠ ORDERED BEFORE IT IS GROUPED, DELIBERATELY. The two mirror rows for
           * one trade tie on every payload field, so without a deterministic key
           * the order Postgres happens to return decides which manager appears
           * first — and a trade could read one way round on one render and the
           * other way on the next. `historyId` is stable and unique per side.
           */
          orderBy: [{ transactionId: 'asc' }, { historyId: 'asc' }],
          select: {
            transactionId: true,
            season: true,
            week: true,
            playersGiven: true,
            playersReceived: true,
            picksGiven: true,
            picksReceived: true,
            partnerName: true,
            tradeDate: true,
            createdAt: true,
            history: { select: { sleeperUsername: true } },
          },
          take: 400,
        })
        .catch(() => [])
    : []

  const asIds = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []

  /*
   * One entry per SIDE, named by the manager who received it — see the note on
   * `TradeRecord.players`. A side with an empty `received` (picks-only, or the
   * giving half of a one-way move) is dropped rather than rendered as a manager
   * who got nothing.
   */
  const sidesByTx = new Map<string, Array<{ username: string | null; ids: string[] }>>()
  for (const r of tradeRows) {
    const got = asIds(r.playersReceived)
    if (got.length === 0) continue
    const list = sidesByTx.get(r.transactionId) ?? []
    list.push({ username: r.history?.sleeperUsername ?? null, ids: got })
    sidesByTx.set(r.transactionId, list)
  }

  const allTradeIds = [...new Set([...sidesByTx.values()].flatMap((sides) => sides.flatMap((x) => x.ids)))]
  const namedRows = allTradeIds.length
    ? await prisma.sportsPlayer
        .findMany({
          where: { sleeperId: { in: allTradeIds } },
          distinct: ['sleeperId'],
          orderBy: [{ sleeperId: 'asc' }, { fetchedAt: 'desc' }],
          select: { sleeperId: true, name: true, position: true, team: true },
        })
        .catch(() => [])
    : []
  const playerBySleeperId = new Map(
    namedRows.flatMap((p) =>
      p.sleeperId
        ? [[p.sleeperId, { sleeperId: p.sleeperId, name: p.name, position: p.position, team: p.team }] as const]
        : [],
    ),
  )

  const history: TradeRecord[] = []
  for (const [txId, sides] of bySleeperTx) {
    // Prefer the user's own side so "in / out" is from their point of view.
    const ourSide = mine ? sides.find((s) => s.managerId === mine) : undefined
    const side = ourSide ?? sides[0]
    const payload = (side.payload ?? {}) as Record<string, unknown>
    const rosterIds = Array.isArray(payload.rosterIds) ? payload.rosterIds.map(String) : []
    const partnerId = rosterIds.find((r) => r !== side.managerId) ?? null

    history.push({
      transactionId: txId,
      season: side.season ?? null,
      week: side.weekOrPeriod ?? null,
      rosterIds,
      yourSide: ourSide ? 'in' : 'unknown',
      playersIn: Number(payload.playersIn ?? 0),
      playersOut: Number(payload.playersOut ?? 0),
      picks: Number(payload.picks ?? 0),
      partnerTeamName: partnerId ? teamByExternal.get(partnerId) ?? `Roster ${partnerId}` : null,
      at: side.createdAt,
      // An id we cannot name is dropped rather than printed raw — a bare
      // "9221" in a trade row is noise the reader cannot act on.
      players: (sidesByTx.get(txId) ?? []).map((sideRow) => {
        const team = sideRow.username ? teamByPlatformUser.get(sideRow.username) : undefined
        return {
          manager: team ? (team.teamName ?? team.ownerName ?? null) : null,
          isYou: !!(team && userId && team.claimedByUserId === userId),
          // An id we cannot name is dropped rather than printed raw — a bare
          // "9221" in a trade row is noise the reader cannot act on.
          received: sideRow.ids.flatMap((id) => {
            const hit = playerBySleeperId.get(id)
            return hit ? [hit] : []
          }),
        }
      }).filter((sideRow) => sideRow.received.length > 0),
    })
    if (history.length >= 60) break
  }

  /*
   * Fill any transaction missing from the warehouse facts from the same
   * mirrored LeagueTrade rows used by the grade section. This is an additive
   * fallback: ESPN/Yahoo/Fantrax/MFL facts keep their existing path, while
   * Sleeper history becomes complete as soon as either importer has seen it.
   */
  const renderedIds = new Set(history.map((trade) => trade.transactionId))
  const legacyByTransaction = new Map<string, typeof tradeRows>()
  for (const row of tradeRows) {
    const bucket = legacyByTransaction.get(row.transactionId) ?? []
    bucket.push(row)
    legacyByTransaction.set(row.transactionId, bucket)
  }

  const countJsonArray = (value: unknown): number => Array.isArray(value) ? value.length : 0
  for (const [txId, rows] of legacyByTransaction) {
    if (history.length >= 60) break
    if (renderedIds.has(txId)) continue

    const ownRow = rows.find((row) =>
      myTeam?.platformUserId
        ? row.history.sleeperUsername === myTeam.platformUserId
        : false,
    ) ?? rows[0]
    if (!ownRow) continue

    const namedSides = (sidesByTx.get(txId) ?? []).map((sideRow) => {
      const team = sideRow.username ? teamByPlatformUser.get(sideRow.username) : undefined
      return {
        manager: team ? (team.teamName ?? team.ownerName ?? null) : null,
        isYou: !!(team && team.claimedByUserId === userId),
        received: sideRow.ids.flatMap((id) => {
          const hit = playerBySleeperId.get(id)
          return hit ? [hit] : []
        }),
      }
    }).filter((sideRow) => sideRow.received.length > 0)

    const otherTeam = rows
      .map((row) => teamByPlatformUser.get(row.history.sleeperUsername))
      .find((team) => team && team.platformUserId !== myTeam?.platformUserId)

    history.push({
      transactionId: txId,
      season: ownRow.season ?? null,
      week: ownRow.week ?? null,
      rosterIds: rows.flatMap((row) => {
        const team = teamByPlatformUser.get(row.history.sleeperUsername)
        return team?.externalId ? [String(team.externalId)] : []
      }),
      yourSide: ownRow.history.sleeperUsername === myTeam?.platformUserId ? 'in' : 'unknown',
      playersIn: countJsonArray(ownRow.playersReceived),
      playersOut: countJsonArray(ownRow.playersGiven),
      picks: countJsonArray(ownRow.picksGiven) + countJsonArray(ownRow.picksReceived),
      partnerTeamName:
        ownRow.partnerName?.trim() || otherTeam?.teamName || otherTeam?.ownerName || null,
      at: ownRow.tradeDate ?? ownRow.createdAt,
      players: namedSides,
    })
    renderedIds.add(txId)
  }

  history.sort((a, b) => b.at.getTime() - a.at.getTime())

  if (history.length === 0) {
    return { ...base, history: { available: false, reason: 'no completed trades are on file for this league' } }
  }

  return { ...base, history: { available: true, data: history } }
}
