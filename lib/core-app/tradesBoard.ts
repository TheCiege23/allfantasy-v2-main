import 'server-only'
import { CROSS_LEAGUE_BOOK, valueBookFor, type ValueBook } from './valueBook'

import { prisma } from '@/lib/prisma'
import { describeNoSignal, gradeTrade } from '@/lib/projections/tradeGrading'
import { leagueArtUrl } from './leagueArt'
import { leagueDisplayName } from './leagueHome'

/**
 * Trades, across every league — the cross-league board at `/core/trades`.
 *
 * 2026-09-07 handoff (`AF Core Trades.dc.html`), RE-AIMED, and this note is the
 * whole reason the screen is not what the design drew.
 *
 * ── The design asks for something that cannot exist here ────────────────────
 *
 * 🛑 THERE ARE NO PENDING TRADES TO RANK. The design is "top-10 pending trades,
 * ranked by deadline". Measured on production 2026-08-25:
 *
 *     af_league_trades          0 rows
 *     redraft_trade_proposals   0 rows
 *     trade_block_entries       0 rows
 *     LeagueTrade           7,781 rows, 100% platform='sleeper'
 *
 * `LeagueTrade` has **no status column** — it is COMPLETED trade history
 * reconstructed from Sleeper transactions. And Sleeper's own `pending` state is
 * transient: a 31-league sample saw 247 trades, every one `complete`, despite 24
 * of 25 having an active veto window open. So a board ranking pending trades by
 * deadline would render empty forever, on every account, and look broken rather
 * than honest.
 *
 * ── What it does instead, and what it keeps ─────────────────────────────────
 *
 * The subject moves from "pending trades" to **your trade windows closing**:
 * leagues ranked by how near their deadline is, each showing the most recent
 * real trade in that league with both sides flattened and graded. Every visual
 * element of the design survives — the two-sided hairline asset rows, the
 * fairness grade, the deadline ranking, the reasoning line — and the ranking
 * rule in the section label is still true of what is on screen.
 *
 * ⚠ AND THE PENDING SECTION IS BUILT, NOT DELETED. `AfLeagueTrade` with
 * `status = 'pending'` is read on every call and rendered above the windows the
 * moment a row exists. The feature is wired; the table is empty. Those are
 * different things and this file keeps them different.
 *
 * ⚠ A GRADE APPEARS ONLY WITH FULL COVERAGE ON BOTH SIDES. `gradeTrade` will
 * happily return a "C" when no asset on either side could be priced — every net
 * is 0, both sides land in the middle band, and the letter reads as "an average
 * trade" while meaning ZERO DATA. The withheld reason is rendered instead.
 */

export type TradeAsset = {
  /** Sleeper id, or a synthetic key for a pick. */
  id: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  /** Market value, when a snapshot prices him. Null is common and is not zero. */
  value: number | null
}

export type BoardTrade = {
  transactionId: string
  season: number | null
  week: number | null
  at: string | null
  /** The side belonging to the manager whose history this is. */
  fromName: string
  toName: string
  sent: TradeAsset[]
  received: TradeAsset[]
  /** Null when the trade could not be priced on both sides — see the header. */
  letter: 'A' | 'B' | 'C' | 'D' | 'F' | null
  sharePct: number | null
  withheldReason: string | null
}

export type TradeWindowRow = {
  leagueId: string
  leagueName: string
  platform: string
  logoUrl: string | null
  /**
   * The deadline week, or null when the league keeps trades open all season.
   *
   * ⚠ `trade_deadline_week` OF 99 MEANS "NO DEADLINE", NOT WEEK 99. Four
   * production leagues carry 99 against regular seasons of 14 and 18 weeks — it
   * is the platform's sentinel. Printing "Deadline: week 99" would be a
   * confident, checkable falsehood on a screen people plan around.
   */
  deadlineWeek: number | null
  /** True when the league is configured to allow trades all season. */
  noDeadline: boolean
  /** Weeks from the current week to the deadline. Negative once it has passed. */
  weeksLeft: number | null
  regularSeasonLength: number | null
  /** Trades already done in this league, all seasons on file. */
  tradesOnFile: number
  /** The most recent one, graded. Null when none is on file. */
  latest: BoardTrade | null
  href: string
  reasoning: string
}

export type PendingTrade = {
  id: string
  leagueId: string
  leagueName: string
  platform: string
  logoUrl: string | null
  status: string
  /** When it expires, ISO. Null when the league sets no expiry. */
  expiresAt: string | null
  youProposed: boolean
  items: Array<{ itemType: string; reference: string | null; faabAmount: number | null }>
}

export type TradesBoardData = {
  pending: PendingTrade[]
  windows: TradeWindowRow[]
  considered: number
  /** Leagues with no deadline setting ingested at all — a real gap, stated. */
  deadlineUnknown: number
  currentWeek: number | null
}

const EMPTY: TradesBoardData = {
  pending: [],
  windows: [],
  considered: 0,
  deadlineUnknown: 0,
  currentWeek: null,
}

const ROW_CAP = 10

/** Trades to price per league. Enough to grade the latest without a wide read. */
const TRADES_PER_LEAGUE = 4

type DeadlineInfo = {
  week: number | null
  regularSeasonLength: number | null
  none: boolean
  known: boolean
}

/**
 * The trade deadline, from the canonical import snapshot.
 *
 * Same reading as `trades.ts`'s `resolveDeadline`, deliberately — two surfaces
 * disagreeing about when a league's window shuts is worse than either being
 * absent. Present on 54 of 120 production leagues; the other 66 stay unknown,
 * and "no deadline shown" must never be mistaken for "no deadline exists".
 */
function readDeadline(settings: unknown): DeadlineInfo {
  if (!settings || typeof settings !== 'object') {
    return { week: null, regularSeasonLength: null, none: false, known: false }
  }
  const s = settings as Record<string, unknown>
  const raw = s.trade_deadline_week
  const week = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  if (week == null) return { week: null, regularSeasonLength: null, none: false, known: false }

  const rsRaw = s.regular_season_length
  const regularSeasonLength =
    typeof rsRaw === 'number' && Number.isFinite(rsRaw) && rsRaw > 0 ? rsRaw : null

  const none = week >= 99 || (regularSeasonLength != null && week > regularSeasonLength)
  return { week: none ? null : week, regularSeasonLength, none, known: true }
}

function idsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []
}

/**
 * Collapse the mirrored copies of each trade, per league.
 *
 * 🛑 THE SAME TRADE IS STORED ONCE PER MANAGER. `LeagueTradeHistory` is
 * `@@unique([sleeperLeagueId, sleeperUsername])` — one history per manager per
 * league — and `LeagueTrade` is `@@unique([historyId, transactionId])`. So a
 * league where two managers have both been ingested holds every trade between
 * them TWICE, mirrored, and a per-row count reports "6 trades on file" for
 * three. That is a structural certainty from the two unique constraints, not a
 * guess about the data.
 *
 * ⚠ DEDUPED ON `transactionId` — the platform's own id, and the one field equal
 * across mirrors by definition. The copies are INVERTED (one manager's
 * `playersGiven` is the other's `playersReceived`), so they compare equal on no
 * payload field at all.
 *
 * ⚠ AND THE INPUT MUST ALREADY BE ORDERED, because `firstByLeague` keeps the
 * FIRST row it sees per league and the mirrors are inverted — which copy
 * survives decides which way round the card's two sides read. The caller orders
 * by season, week, then `historyId` so that choice is stable between renders
 * rather than whatever Postgres returned first.
 *
 * Pure and exported so the rule can be asserted without a database; the loader
 * below is the only caller.
 */
export function collapseMirroredTrades<T extends { leagueId: string; transactionId: string }>(
  ordered: readonly T[],
): { counts: Map<string, number>; firstByLeague: Map<string, T> } {
  const counts = new Map<string, number>()
  const firstByLeague = new Map<string, T>()
  const seen = new Map<string, Set<string>>()

  for (const row of ordered) {
    const forLeague = seen.get(row.leagueId) ?? new Set<string>()
    if (forLeague.has(row.transactionId)) continue
    forLeague.add(row.transactionId)
    seen.set(row.leagueId, forLeague)

    counts.set(row.leagueId, (counts.get(row.leagueId) ?? 0) + 1)
    if (!firstByLeague.has(row.leagueId)) firstByLeague.set(row.leagueId, row)
  }

  return { counts, firstByLeague }
}

/**
 * The reader's own Sleeper username, or null when we cannot say who they are.
 *
 * ⚠ THIS IS AN EXACT TWO-HOP LOOKUP, NOT A NAME MATCH, and the distinction is
 * the whole reason this is safe to render. `AppUser.legacyUserId` is `@unique`
 * and points at `LegacyUser.id`; `LegacyUser.sleeperUsername` is `@unique` too.
 * So the chain either resolves to exactly one username or to nothing — there is
 * no scoring, no threshold, and no second-best candidate.
 *
 * ⚠ NULL IS THE COMMON CASE AND MUST STAY CHEAP. An account that never came
 * through the legacy Sleeper import has no `legacyUserId`, and that is not an
 * error — the board simply keeps printing the platform username, which is what
 * it does today. Every failure here (no row, no link, a throw) returns null, so
 * the feature can only ever ADD a correct "You" and never replace a correct
 * username with a wrong one.
 *
 * `lib/core-app/career.ts` already walks the first hop of this same chain.
 */
async function viewerSleeperUsername(userId: string): Promise<string | null> {
  try {
    const appUser = await prisma.appUser.findUnique({
      where: { id: userId },
      select: { legacyUserId: true },
    })
    if (!appUser?.legacyUserId) return null
    const legacy = await prisma.legacyUser.findUnique({
      where: { id: appUser.legacyUserId },
      select: { sleeperUsername: true },
    })
    return legacy?.sleeperUsername?.trim() || null
  } catch {
    return null
  }
}

/**
 * Is this trade history the READER's own?
 *
 * ⚠ BOTH SIDES MUST BE PRESENT. A null on either side is "we do not know", and
 * an unknown must never render as "You" — that would tell a manager they made a
 * trade they did not make, which is worse than the raw username this replaces.
 */
export function isViewersOwnHistory(
  historyUsername: string | null | undefined,
  viewerUsername: string | null | undefined,
): boolean {
  const a = historyUsername?.trim().toLowerCase()
  const b = viewerUsername?.trim().toLowerCase()
  if (!a || !b) return false
  return a === b
}

export async function getTradesBoard(
  userId: string,
  currentWeek: number | null,
): Promise<TradesBoardData> {
  /*
   * ⚠ THE ASSETS ARE ALREADY READER-RELATIVE; ONLY THE LABEL IS NOT.
   * `LeagueTrade.playersGiven` is what the HISTORY OWNER gave — the rows are
   * stored from that manager's perspective, one history per manager per league
   * (`@@unique([sleeperLeagueId, sleeperUsername])`). So nothing about the two
   * sides needs re-orienting; the only thing the board could not say was
   * whether that manager is the person reading the screen.
   */
  const viewerSleeper = await viewerSleeperUsername(userId)
  const claimed = await prisma.leagueTeam
    .findMany({
      where: { claimedByUserId: userId },
      select: {
        leagueId: true,
        league: {
          select: {
            id: true,
            name: true,
            platform: true,
            settings: true,
            leagueType: true,
            platformLeagueId: true,
            logoUrl: true,
            avatarUrl: true,
          },
        },
      },
    })
    .catch(() => [])

  const mine = claimed.filter((c) => c.league != null)
  if (mine.length === 0) return { ...EMPTY, currentWeek }

  const leagueIds = [...new Set(mine.map((c) => c.leagueId))]
  const platformIds = [
    ...new Set(
      mine.map((c) => c.league!.platformLeagueId).filter((x): x is string => !!x && x.length > 0),
    ),
  ]

  const [pendingRows, histories] = await Promise.all([
    /*
     * ⚠ THIS READ IS NOT DEAD CODE, IT IS AN EMPTY TABLE. `af_league_trades` has
     * zero rows in production because only one of 110 leagues is
     * platform='native' — trades happen on Sleeper, not in AllFantasy. Deleting
     * this would mean the first real AF-native trade renders nowhere.
     */
    prisma.afLeagueTrade
      .findMany({
        where: {
          leagueId: { in: leagueIds },
          status: 'pending',
          OR: [
            { proposedByUserId: userId },
            { receiverRoster: { platformUserId: userId } },
          ],
        },
        select: {
          id: true,
          leagueId: true,
          status: true,
          expiresAt: true,
          proposedByUserId: true,
          items: { select: { itemType: true, itemReference: true, faabAmount: true } },
        },
        take: 20,
      })
      .catch(() => []),
    platformIds.length > 0
      ? prisma.leagueTradeHistory
          .findMany({
            where: { sleeperLeagueId: { in: platformIds } },
            select: { id: true, sleeperLeagueId: true, sleeperUsername: true },
          })
          .catch(() => [])
      : Promise.resolve([] as Array<{ id: string; sleeperLeagueId: string; sleeperUsername: string }>),
  ])

  const historyIds = histories.map((h) => h.id)
  const trades =
    historyIds.length > 0
      ? await prisma.leagueTrade
          .findMany({
            where: { historyId: { in: historyIds } },
            /*
             * ⚠ `historyId` IS THE TIEBREAK, AND IT IS THERE FOR DETERMINISM, NOT
             * TIDINESS. The mirrors of one trade share a season and a week, so
             * without a third key which copy survives the dedupe below is
             * whatever Postgres returned first — and the two copies are
             * INVERTED, so the card's "X sent / Y sent" sides would swap
             * between renders of the same trade.
             */
            orderBy: [{ season: 'desc' }, { week: 'desc' }, { historyId: 'asc' }],
            /*
             * Bounded read: enough to give every league on the board a latest
             * trade without pulling all 7,781 rows. Sliced per league below.
             */
            take: TRADES_PER_LEAGUE * Math.max(1, historyIds.length) * 2,
            select: {
              transactionId: true,
              historyId: true,
              season: true,
              week: true,
              tradeDate: true,
              playersGiven: true,
              playersReceived: true,
              partnerName: true,
            },
          })
          .catch(() => [])
      : []

  /*
   * Each league's own value book, and the distinct set the query must cover.
   *
   * ⚠ DERIVED ONCE, FROM `valueBook.ts`, SO THIS BOARD AND THE PER-LEAGUE TRADES
   * SCREEN CANNOT DRIFT. They previously stayed consistent by copying the same
   * two hardcoded literals, which kept them agreeing and made them both wrong on
   * every redraft league.
   */
  const bookByLeagueId = new Map<string, ValueBook>()
  for (const c of mine) {
    if (c.league) bookByLeagueId.set(c.league.id, valueBookFor(c.league.settings, c.league.leagueType))
  }
  const booksInPlay = [...new Map([...bookByLeagueId.values()].map((b) => [`${b.format}:${b.qbFormat}`, b])).values()]
  // A user with no claimed league still runs the query harmlessly rather than
  // building an empty `OR`, which Prisma treats as "match nothing".
  if (booksInPlay.length === 0) booksInPlay.push(CROSS_LEAGUE_BOOK)

  /* Names, faces and values for every asset we are about to print. */
  const assetIds = new Set<string>()
  for (const t of trades) {
    for (const id of [...idsOf(t.playersGiven), ...idsOf(t.playersReceived)]) assetIds.add(id)
  }

  const [players, snaps] = await Promise.all([
    assetIds.size > 0
      ? prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: [...assetIds] } },
            select: { sleeperId: true, name: true, position: true, team: true, imageUrl: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
    assetIds.size > 0
      ? prisma.playerValueSnapshot
          .findMany({
            where: {
              sleeperId: { in: [...assetIds] },
              /*
               * ⚠ `source: 'FANTASYCALC'` IS A LICENCE BOUNDARY, NOT A TIDY
               * FILTER. DynastyProcess's value files carry FantasyPros ECR
               * derivatives, and FantasyPros' terms prohibit commercial use of
               * any portion of their site. Today only FantasyCalc rows exist so
               * this is a no-op — which is exactly why it is written down: the
               * moment a second source lands, an unfiltered query would start
               * pricing trades on data we may not be licensed to use, and
               * nothing would fail.
               */
              source: 'FANTASYCALC',
              /*
               * 🛑 EVERY BOOK THIS USER'S LEAGUES NEED, NOT A PINNED
               * DYNASTY/SUPERFLEX. This was two literals copied from
               * `lib/core-app/trades.ts` so the board and the per-league screen
               * could not disagree — they did not, and both graded a redraft
               * league off the dynasty book. A cross-league board is precisely
               * where this bites: one query priced a dynasty superflex league
               * and a redraft 1QB league identically.
               *
               * Still ONE query. The OR is over the distinct books in play
               * (at most four), and the rows carry `format`/`qbFormat` so each
               * row can be filed under the book it belongs to.
               */
              OR: booksInPlay.map((b) => ({ format: b.format, qbFormat: b.qbFormat })),
            },
            select: {
              sleeperId: true,
              value: true,
              overallRank: true,
              capturedAt: true,
              format: true,
              qbFormat: true,
            },
            orderBy: { capturedAt: 'desc' },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ])

  const playerById = new Map(players.map((p) => [p.sleeperId, p]))
  /*
   * ⚠ KEYED ON BOOK + PLAYER, NOT PLAYER. Two of this user's leagues can want
   * different books for the same man, so a `Map<sleeperId, …>` silently served
   * whichever row sorted first to both of them.
   */
  const valueByBookAndId = new Map<string, { value: number; rank: number | null }>()
  for (const s of snaps) {
    const k = `${s.format}:${s.qbFormat}:${s.sleeperId}`
    if (!valueByBookAndId.has(k)) {
      valueByBookAndId.set(k, { value: s.value, rank: s.overallRank ?? null })
    }
  }

  function toAsset(id: string, book: ValueBook): TradeAsset {
    const p = playerById.get(id)
    const v = valueByBookAndId.get(`${book.format}:${book.qbFormat}:${id}`)
    return {
      id,
      /*
       * ⚠ AN UNRESOLVED ID IS NAMED AS UNRESOLVED, NOT DROPPED. Dropping it
       * would make a 2-for-1 render as a 1-for-1 — a trade the manager never
       * made, shown as fact.
       */
      name: p?.name ?? `Player ${id}`,
      position: p?.position ?? null,
      team: p?.team ?? null,
      imageUrl: p?.imageUrl ?? null,
      value: v?.value ?? null,
    }
  }

  const historyById = new Map(histories.map((h) => [h.id, h]))
  const leagueByPlatformId = new Map(
    mine.map((c) => [c.league!.platformLeagueId ?? '', c.league!] as const),
  )

  /*
   * Resolve each row to its league, then collapse the mirrors. `trades` arrives
   * ordered by season, week and historyId, which is what makes the surviving
   * copy — and therefore which way round the card's two sides read — stable.
   */
  const resolved = trades.flatMap((t) => {
    const h = historyById.get(t.historyId)
    if (!h) return []
    const league = leagueByPlatformId.get(h.sleeperLeagueId)
    if (!league) return []
    return [{ ...t, leagueId: league.id, username: h.sleeperUsername }]
  })

  const { counts: countByLeague, firstByLeague } = collapseMirroredTrades(resolved)

  /* Latest graded trade per league, built from the surviving copy. */
  const latestByLeague = new Map<string, BoardTrade>()

  for (const t of firstByLeague.values()) {
    const league = { id: t.leagueId }
    const h = { sleeperUsername: t.username }
    /*
     * This league's book. Falls back to the cross-league default only when the
     * trade's league is not among the user's claimed ones, which the loader's
     * own filter makes unreachable — kept so a future caller widening that
     * filter gets a stated default rather than an undefined lookup.
     */
    const leagueBook = bookByLeagueId.get(t.leagueId) ?? CROSS_LEAGUE_BOOK

    const sentIds = idsOf(t.playersGiven)
    const recvIds = idsOf(t.playersReceived)

    const g = gradeTrade(
      {
        label: 'received',
        assets: recvIds.map((id) => ({
          id,
          rank: valueByBookAndId.get(`${leagueBook.format}:${leagueBook.qbFormat}:${id}`)?.rank ?? null,
          rawValue: null,
        })),
      },
      {
        label: 'gave',
        assets: sentIds.map((id) => ({
          id,
          rank: valueByBookAndId.get(`${leagueBook.format}:${leagueBook.qbFormat}:${id}`)?.rank ?? null,
          rawValue: null,
        })),
      },
    )

    latestByLeague.set(league.id, {
      transactionId: t.transactionId,
      season: t.season ?? null,
      week: t.week ?? null,
      at: t.tradeDate ? t.tradeDate.toISOString() : null,
      /*
       * "You sent" only when the identity is certain — see `isViewersOwnHistory`.
       * An unresolved reader keeps the platform username, which is exactly what
       * this board printed before, so the fallback is the previous behaviour
       * rather than a degraded one.
       */
      fromName: isViewersOwnHistory(h.sleeperUsername, viewerSleeper) ? 'You' : h.sleeperUsername,
      toName: t.partnerName?.trim() || 'the other manager',
      /*
       * ⚠ NOT `.map(toAsset)`. With a second parameter that form passes the
       * array INDEX as the book — the classic `map` arity trap, and here it
       * would have priced asset 0 against one book and asset 1 against another.
       */
      sent: sentIds.map((id) => toAsset(id, leagueBook)),
      received: recvIds.map((id) => toAsset(id, leagueBook)),
      letter: g.graded ? g.letter : null,
      sharePct: g.graded ? g.sharePct : null,
      withheldReason: g.graded ? null : describeNoSignal(g),
    })
  }

  let deadlineUnknown = 0
  const windows: TradeWindowRow[] = []

  for (const c of mine) {
    const l = c.league!
    const d = readDeadline(l.settings)
    if (!d.known) deadlineUnknown++

    const weeksLeft =
      d.week != null && currentWeek != null ? d.week - currentWeek : null

    const latest = latestByLeague.get(l.id) ?? null
    const tradesOnFile = countByLeague.get(l.id) ?? 0

    const bits: string[] = []
    if (d.none) {
      bits.push('Trades stay open all season in this league.')
    } else if (d.week != null) {
      bits.push(
        weeksLeft == null
          ? `The deadline is week ${d.week}.`
          : weeksLeft > 0
            ? `${weeksLeft} ${weeksLeft === 1 ? 'week' : 'weeks'} until the week ${d.week} deadline.`
            : weeksLeft === 0
              ? `The deadline is this week (week ${d.week}).`
              : `The week ${d.week} deadline has passed.`,
      )
    } else {
      bits.push('This league has never published a trade deadline, so we do not know when it shuts.')
    }
    bits.push(
      tradesOnFile > 0
        ? `${tradesOnFile} ${tradesOnFile === 1 ? 'trade' : 'trades'} on file here.`
        : 'No trade has been made here on any season we hold.',
    )
    if (latest?.withheldReason) {
      bits.push(`The latest one is ungraded: ${latest.withheldReason}.`)
    }

    windows.push({
      leagueId: l.id,
      leagueName: leagueDisplayName(l.name),
      platform: String(l.platform ?? 'manual').toLowerCase(),
      logoUrl: leagueArtUrl({
        logoUrl: l.logoUrl,
        avatarUrl: l.avatarUrl,
        platform: l.platform,
      }),
      deadlineWeek: d.week,
      noDeadline: d.none,
      weeksLeft,
      regularSeasonLength: d.regularSeasonLength,
      tradesOnFile,
      latest,
      href: `/core/trades?league=${encodeURIComponent(l.id)}`,
      reasoning: bits.join(' '),
    })
  }

  /*
   * ⚠ SOONEST DEADLINE FIRST, WITH THREE DIFFERENT KINDS OF "NO DEADLINE"
   * SORTING BELOW IT AND NOT AMONG IT. A window shutting this week is the most
   * urgent thing on the screen; a league that never closes, a league whose
   * deadline has passed, and a league that never told us are all "not urgent"
   * for three different reasons, and none of them may sort above a live window.
   */
  windows.sort((a, b) => {
    const rank = (w: TradeWindowRow) =>
      w.weeksLeft != null && w.weeksLeft >= 0 ? 0 : w.deadlineWeek != null ? 1 : w.noDeadline ? 2 : 3
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra === 0) return (a.weeksLeft as number) - (b.weeksLeft as number)
    return b.tradesOnFile - a.tradesOnFile
  })

  const pending: PendingTrade[] = pendingRows.map((p) => {
    const l = mine.find((c) => c.leagueId === p.leagueId)?.league
    return {
      id: p.id,
      leagueId: p.leagueId,
      leagueName: l ? leagueDisplayName(l.name) : 'League',
      platform: String(l?.platform ?? 'native').toLowerCase(),
      logoUrl: l
        ? leagueArtUrl({ logoUrl: l.logoUrl, avatarUrl: l.avatarUrl, platform: l.platform })
        : null,
      status: p.status,
      expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
      youProposed: p.proposedByUserId === userId,
      items: p.items.map((i) => ({
        itemType: i.itemType,
        reference: i.itemReference,
        faabAmount: i.faabAmount,
      })),
    }
  })

  return {
    pending,
    windows: windows.slice(0, ROW_CAP),
    considered: mine.length,
    deadlineUnknown,
    currentWeek,
  }
}
