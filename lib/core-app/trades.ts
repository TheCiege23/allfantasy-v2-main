import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'
import { describeNoSignal, gradeTrade } from '@/lib/projections/tradeGrading'

/**
 * Trades — "offer, grade, counter, all scored against this league's own rules".
 *
 * WHAT IS REAL: completed trade history, from dw_transaction_facts. 7,124 trade
 * rows across the imported leagues, each carrying the transaction id, the two
 * roster ids, the season and week, and how many players and picks moved each way.
 *
 * ⚠ WHAT IS NOT IN THAT DATA: WHICH players moved. The payload stores counts
 * (`playersIn: 1, playersOut: 1, picks: 0`), not identities. So a trade can be
 * listed, dated and attributed to two managers — but it cannot be valued, and
 * nothing on this screen may imply otherwise.
 *
 * ⚠ AND THIS IS WHY NO LETTER GRADE IS SHOWN. lib/trade-intel exists and will
 * happily return one, but its own hasNoSignal() documents the trap: when no
 * points are credited to either side, every net is 0, every side lands in the C
 * band, and the engine reports a tie it has not earned. A "C" from this data
 * would mean ZERO DATA while reading as "an average trade". The grade slot is
 * rendered as explicitly ungradable instead — refusing the letter is the whole
 * point, and it is easier to add a real grade later than to retract a wrong one.
 */

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
  platformLeagueId: string | null
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
      source: 'FANTASYCALC',
      format: 'DYNASTY',
      qbFormat: 'SUPERFLEX',
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
  league: { id: string; name: string; platform: string }
  /** Grading context the handoff prints above every grade. */
  gradingContext: SectionState<{ leagueName: string; format: string | null; teamCount: number }>
  history: SectionState<TradeRecord[]>
  inbox: UnavailableSection
  sent: UnavailableSection
  grades: SectionState<GradedTrade[]>
  deadline: SectionState<TradeDeadline>
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

export async function getTradesData(leagueId: string, userId: string): Promise<TradesData | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, leagueType: true, settings: true, platformLeagueId: true },
  })
  if (!league) return null

  const teamCount = await prisma.leagueTeam.count({ where: { leagueId } })
  const grades = await resolveGrades(league.platformLeagueId ?? null)

  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
    },
    gradingContext: {
      available: true as const,
      data: { leagueName: leagueDisplayName(league.name), format: league.leagueType ?? null, teamCount },
    },
    // Pending offers are a live platform concept. Nothing ingests them, and a
    // trade screen that shows an empty inbox implies none are waiting.
    inbox: {
      available: false as const,
      reason: 'pending offers are not ingested — open your platform to see anything waiting',
    },
    sent: { available: false as const, reason: 'outgoing offers are not ingested' },
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
    select: { externalId: true, teamName: true },
  })
  const teamByExternal = new Map(teams.map((t) => [String(t.externalId), t.teamName]))

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
    })
    if (history.length >= 60) break
  }

  return { ...base, history: { available: true, data: history } }
}
