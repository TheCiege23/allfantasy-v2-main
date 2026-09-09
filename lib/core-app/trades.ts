import 'server-only'
import { valueBookFor, type ValueBook } from './valueBook'
import { resolveSourceScreenLink, type SourceScreenLink } from '@/lib/league-links/sourceLinkResolver'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState } from './leagueHome'
import { describeNoSignal, gradeTrade } from '@/lib/projections/tradeGrading'
import {
  scanPendingSleeperTrades,
  type PendingTradeAsset,
} from '@/lib/provider-trades/scanPendingSleeperTrades'

/**
 * Trades — "offer, grade, counter, all scored against this league's own rules".
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
    isYou: boolean
    received: TradePlayerRef[]
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
  book: ValueBook
): Promise<SectionState<GradedTrade[]>> {
  if (!platformLeagueId) {
    return { available: false, reason: 'this league has no source platform id, so its trades cannot be matched' }
  }

  const histories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperLeagueId: platformLeagueId },
    select: { id: true },
  })
  if (histories.length === 0) {
    return { available: false, reason: 'no trade history has been synced for this league' }
  }

  const trades = await prisma.leagueTrade.findMany({
    where: { historyId: { in: histories.map((h) => h.id) } },
    select: {
      transactionId: true, season: true, week: true,
      playersGiven: true, playersReceived: true,
    },
    orderBy: [{ season: 'desc' }, { week: 'desc' }],
    take: 60,
  })
  if (trades.length === 0) {
    return { available: false, reason: 'no trades on file for this league' }
  }

  // Latest snapshot per player. Ranks, not raw values — see tradeGrading.
  const ids = new Set<string>()
  for (const t of trades) {
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
  const snaps = await prisma.playerValueSnapshot.findMany({
    where: {
      sleeperId: { in: [...ids] },
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
    },
    select: { sleeperId: true, overallRank: true, capturedAt: true },
    orderBy: { capturedAt: 'desc' },
  })
  const rankById = new Map<string, number>()
  for (const s of snaps) {
    if (!rankById.has(s.sleeperId) && s.overallRank != null) rankById.set(s.sleeperId, s.overallRank)
  }

  const graded: GradedTrade[] = trades.map((t) => {
    const recv = (Array.isArray(t.playersReceived) ? t.playersReceived : []).map(String)
    const gave = (Array.isArray(t.playersGiven) ? t.playersGiven : []).map(String)
    const toSide = (label: string, list: string[]) => ({
      label,
      assets: list.map((id) => ({ id, rank: rankById.get(id) ?? null, rawValue: null })),
    })
    const g = gradeTrade(toSide('received', recv), toSide('gave', gave))

    return {
      transactionId: t.transactionId,
      season: t.season ?? null,
      week: t.week ?? null,
      letter: g.graded ? g.letter : null,
      sharePct: g.graded ? g.sharePct : null,
      withheldReason: g.graded ? null : describeNoSignal(g),
      playersIn: recv.length,
      playersOut: gave.length,
    }
  })

  return { available: true, data: graded }
}

export type TradesData = {
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
    const claimed = await prisma.leagueTeam
      .findFirst({ where: { leagueId: league.id, claimedByUserId: userId }, select: { platformUserId: true } })
      .catch(() => null)
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

  const map = (t: (typeof scan.trades)[number]): PendingOffer => ({
    id: t.transactionId,
    partnerName: t.proposedByViewer ? 'You' : t.proposedBy,
    proposedAt: t.proposedAt,
    /* `assetsGiven` is already viewer-relative in BOTH directions, so an offer
       the manager sent is not rendered back to front. */
    give: t.assetsGiven.map(offerLine),
    get: t.assetsReceived.map(offerLine),
  })

  return {
    inbox: { available: true, data: scan.trades.filter((t) => !t.proposedByViewer).map(map) },
    sent: { available: true, data: scan.trades.filter((t) => t.proposedByViewer).map(map) },
  }
}

export async function getTradesData(leagueId: string, userId: string): Promise<TradesData | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    /* `sport` is selected for the pending-offer scan: Sleeper's player
       dictionary is NFL-only, so a non-NFL league must not be handed one. */
    select: { id: true, name: true, platform: true, leagueType: true, settings: true, platformLeagueId: true, season: true, sport: true },
  })
  if (!league) return null

  const teamCount = await prisma.leagueTeam.count({ where: { leagueId } })
  const grades = await resolveGrades(league.platformLeagueId ?? null, valueBookFor(league.settings, league.leagueType))

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
    ...(await resolvePendingOffers(league, userId)),
    grades,
    deadline: resolveDeadline(league.settings),
  }

  const myTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: { externalId: true },
  })

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

  if (facts.length === 0) {
    return { ...base, history: { available: false, reason: 'no trades ingested for this league' } }
  }

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
  const tradeRows = txIds.length
    ? await prisma.leagueTrade
        .findMany({
          where: { transactionId: { in: txIds } },
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
            playersGiven: true,
            playersReceived: true,
            history: { select: { sleeperUsername: true } },
          },
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

  return { ...base, history: { available: true, data: history } }
}
