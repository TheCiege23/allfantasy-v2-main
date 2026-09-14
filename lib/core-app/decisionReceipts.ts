import 'server-only'

import { prisma } from '@/lib/prisma'
import { TIE_BAND } from '@/lib/trade-intel/gradeScale'
import { hasNoSignal } from '@/lib/trade-intel/tradeGradeEmail'
import {
  TRADE_GRADES_CACHE_PREFIX,
  type GradedTrade,
  type TradeGradesPayload,
  type TradeSideGrade,
} from '@/lib/trade-intel/sleeperTradeGradeService'

/**
 * Decision receipts — how your past moves turned out (retention item 6, user decisions
 * 2026-09-14): a weekly "receipts" card on the /core home, good and bad outcomes stated
 * plainly. Trades first; waiver adds, start/sit and Chimmy advice follow.
 *
 * TRADES read the grade cache the 30-minute sweep already fills (`trade-grades:v2:*`),
 * the same one `recentTrades` reads — one `in` query, no provider call, nothing recomputed.
 *
 * ⚠ A RECEIPT IS NET POINTS, NEVER THE SWEEP'S LETTER. The letter's C band spans −40..40
 * per season, so a trade that has produced nothing grades C and reads as "average trade"
 * (the email's `hasNoSignal` exists for exactly that). A receipt states what actually
 * accrued — points credited to what you got minus what you gave, only while each asset
 * stayed on the roster — and says which way it went.
 *
 * ⚠ TOO EARLY IS WITHHELD, NOT SHOWN AS EVEN. A trade nobody has scored for yet, or one
 * made fewer than MIN_WEEKS_FOR_RECEIPT weeks into a season still being played, is counted
 * in `tooEarly` and left off the list — a +1.2 after one week is noise that reads as a
 * verdict. When the current week is unknown, a current-season trade is withheld too.
 */

export const MIN_WEEKS_FOR_RECEIPT = 3
export const MAX_TRADE_RECEIPTS = 5

export type TradeReceipt = {
  id: string
  leagueId: string
  leagueName: string
  season: string
  week: number
  createdIso: string
  /** The other side(s), by team name when set. */
  counterparty: string | null
  got: string[]
  gave: string[]
  gotPoints: number
  gavePoints: number
  netPoints: number
  /** Inside the engine's own tie band (±TIE_BAND) is "about even"; outside it, a side won. */
  outcome: 'ahead' | 'behind' | 'even'
  /** A graded season is still being played, so the number can still move. */
  ongoing: boolean
  /** Picks not yet drafted (or flipped before the draft) — they add nothing yet. */
  unsettledPicks: number
  /** Core's trades screen for that league. */
  href: string
}

export type DecisionReceiptsData = {
  trades: TradeReceipt[]
  /** Your trades left off because it is too early to call them. */
  tooEarly: number
  /** Your leagues on a platform the trade grades do not cover yet. */
  uncoveredLeagues: number
}

export type ReceiptsLeague = {
  id: string
  name: string | null
  platform: string | null
  platformLeagueId: string | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Points credited to one side's incoming / outgoing assets, across every graded season. */
function sidePoints(side: TradeSideGrade): { got: number; gave: number } {
  const players = (assets: TradeSideGrade['playersIn']) =>
    assets.reduce((acc, a) => acc + Object.values(a.creditedBySeason ?? {}).reduce((s, v) => s + (v ?? 0), 0), 0)
  const picks = (list: TradeSideGrade['picksIn']) =>
    list.reduce(
      (acc, p) => acc + Object.values(p.resolved?.creditedBySeason ?? {}).reduce((s, v) => s + (v ?? 0), 0),
      0,
    )
  return {
    got: round1(players(side.playersIn ?? []) + picks(side.picksIn ?? [])),
    gave: round1(players(side.playersOut ?? []) + picks(side.picksOut ?? [])),
  }
}

function tooEarly(trade: GradedTrade, mine: TradeSideGrade, currentWeek: number | null): boolean {
  if (hasNoSignal(trade)) return true
  // Only the trade's OWN season (seasonNets[0]) being in progress makes it "early"; a trade
  // from a finished season has a full season behind it however the current one is going.
  if (!mine.seasonNets?.[0]?.partial) return false
  return currentWeek == null || currentWeek - trade.week < MIN_WEEKS_FOR_RECEIPT
}

export async function getTradeReceipts(args: {
  leagues: readonly ReceiptsLeague[]
  /** Your Sleeper user id — the only way to tell which side of a trade was yours. */
  ownerSleeperId: string | null
  currentWeek: number | null
}): Promise<DecisionReceiptsData | null> {
  if (!args.ownerSleeperId) return null

  const sleeper = args.leagues.filter(
    (l) => String(l.platform ?? '').toLowerCase() === 'sleeper' && l.platformLeagueId,
  )
  const uncoveredLeagues = args.leagues.length - sleeper.length
  if (sleeper.length === 0) return null

  const byPlatformId = new Map(sleeper.map((l) => [l.platformLeagueId as string, l]))
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { in: [...byPlatformId.keys()].map((id) => `${TRADE_GRADES_CACHE_PREFIX}${id}`) } },
    select: { cacheKey: true, data: true },
  })

  const receipts: TradeReceipt[] = []
  let early = 0

  for (const row of rows) {
    const payload =
      row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as unknown as TradeGradesPayload)
        : null
    if (!payload || payload.version !== 2) continue
    const league = byPlatformId.get(row.cacheKey.slice(TRADE_GRADES_CACHE_PREFIX.length))
    if (!league) continue

    for (const trade of payload.trades ?? []) {
      const mine = (trade.sides ?? []).find((s) => s.ownerId && s.ownerId === args.ownerSleeperId)
      if (!mine) continue
      if (tooEarly(trade, mine, args.currentWeek)) {
        early += 1
        continue
      }

      const { got, gave } = sidePoints(mine)
      const net = round1(got - gave)
      const others = trade.sides.filter((s) => s !== mine)
      receipts.push({
        id: trade.id,
        leagueId: league.id,
        leagueName: league.name ?? 'Your league',
        season: trade.season,
        week: trade.week,
        createdIso: trade.createdIso,
        counterparty: others.map((s) => s.teamName || s.managerName).filter(Boolean).join(' & ') || null,
        got: [...(mine.playersIn ?? []).map((p) => p.name), ...(mine.picksIn ?? []).map((p) => p.label)],
        gave: [...(mine.playersOut ?? []).map((p) => p.name), ...(mine.picksOut ?? []).map((p) => p.label)],
        gotPoints: got,
        gavePoints: gave,
        netPoints: net,
        outcome: Math.abs(net) <= TIE_BAND ? 'even' : net > 0 ? 'ahead' : 'behind',
        ongoing: (mine.seasonNets ?? []).some((s) => s.partial),
        unsettledPicks: [...(mine.picksIn ?? []), ...(mine.picksOut ?? [])].filter((p) => p.pending || p.rerouted).length,
        href: `/core/trades?league=${encodeURIComponent(league.id)}`,
      })
    }
  }

  receipts.sort((a, b) => b.createdIso.localeCompare(a.createdIso))
  return { trades: receipts.slice(0, MAX_TRADE_RECEIPTS), tooEarly: early, uncoveredLeagues }
}
