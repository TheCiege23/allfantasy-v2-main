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
 * plainly. Trades and waiver adds so far; start/sit and Chimmy advice follow.
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
export const MAX_WAIVER_RECEIPTS = 5
/** Leagues read for waiver receipts per render. */
export const MAX_WAIVER_LEAGUES = 12

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

export type WaiverReceipt = {
  id: string
  leagueId: string
  leagueName: string
  season: number
  /** The week he was added. */
  week: number
  playerId: string
  playerName: string
  position: string | null
  via: 'waiver' | 'free_agent'
  /** The winning bid, when the league runs FAAB. */
  faab: number | null
  /** Points he scored ON YOUR ROSTER from the add week until he left it. */
  points: number
  /** Of those weeks, how many he was in your starting lineup. */
  starts: number
  weeksScored: number
  /** The week you dropped or traded him, when you did. */
  leftWeek: number | null
  /** Core's waiver screen for that league. */
  href: string
}

export type DecisionReceiptsData = {
  trades: TradeReceipt[]
  /** Your trades left off because it is too early to call them. */
  tooEarly: number
  /** Your leagues on a platform the trade grades do not cover yet. */
  uncoveredLeagues: number
  /** Your adds (Sleeper leagues whose transaction history has synced). Absent = not read. */
  waivers?: WaiverReceipt[]
  /** Adds fewer than MIN_WEEKS_FOR_RECEIPT weeks old, or with the current week unknown. */
  waiversTooEarly?: number
  /** Adds old enough to call but with no weekly score on file for any week he was yours. */
  waiversUnscored?: number
}

export type ReceiptsLeague = {
  id: string
  name: string | null
  platform: string | null
  platformLeagueId: string | null
  /** The league's season; waiver receipts read this season's adds. */
  season?: number | string | null
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

const isSleeper = (l: ReceiptsLeague) => String(l.platform ?? '').toLowerCase() === 'sleeper' && Boolean(l.platformLeagueId)

export async function getTradeReceipts(args: {
  leagues: readonly ReceiptsLeague[]
  /** Your Sleeper user id — the only way to tell which side of a trade was yours. */
  ownerSleeperId: string | null
  currentWeek: number | null
}): Promise<DecisionReceiptsData | null> {
  if (!args.ownerSleeperId) return null

  const sleeper = args.leagues.filter(isSleeper)
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

/* ── Waiver adds ──────────────────────────────────────────────────────────────── */

type FactRow = {
  transactionId: string
  leagueId: string
  type: string
  rosterId: string | null
  weekOrPeriod: number | null
  payload: unknown
}

type FactPayload = { adds?: unknown; drops?: unknown; waiverBid?: unknown; createdAt?: unknown }

const idsIn = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : [])

/**
 * Your waiver and free-agent adds this season, and what each player scored for you after.
 *
 * ⚠ CREDIT ONLY WHILE HE WAS YOURS — the trade grader's tenure rule, restated rather than
 * imported (its `stintWindows`/`findDeparture` are private and score raw stat lines): from
 * the add week, up to the week before the first later transaction of yours that drops or
 * trades him away. And a weekly score counts only when its `rosterId` is YOUR roster that
 * week, so a week he spent elsewhere is never credited to you.
 *
 * ⚠ SHARED LEAGUES STORE THEIR FACTS UNDER ONE `League` ROW. `dw_transaction_facts` is keyed
 * `${sleeperTxId}:${rosterId}` with no league id, so when league-mates imported the same
 * Sleeper league, its facts sit under whichever `League` row synced last. So every `League`
 * row sharing the platform id is read, filtered to YOUR roster id (unique within one Sleeper
 * league). Never re-run a backfill to "fix" this — it moves the rows off the sibling.
 *
 * ⚠ NO SCORES IS NOT ZERO POINTS. `league_player_weekly_scores` is Sleeper-only, written for
 * recent weeks only, and was empty through preseason. An add old enough to call with no
 * score row for any week he was yours is counted in `waiversUnscored` — never printed as
 * "0.0 pts". A player dropped before his first week is a real 0 and is shown.
 *
 * Reads: your claimed teams, the sibling league rows, this season's facts for your rosters,
 * the weekly scores of the added players, and their names — five queries for up to
 * MAX_WAIVER_LEAGUES leagues.
 */
export async function getWaiverReceipts(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  currentWeek: number | null
}): Promise<{ waivers: WaiverReceipt[]; tooEarly: number; unscored: number } | null> {
  // A missing season must exclude the league: Number(null) is 0, which is finite.
  const sleeper = args.leagues
    .filter((l) => isSleeper(l) && l.season != null && String(l.season).trim() !== '' && Number.isFinite(Number(l.season)))
    .slice(0, MAX_WAIVER_LEAGUES)
  if (!args.userId || sleeper.length === 0) return null

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: { in: sleeper.map((l) => l.id) }, claimedByUserId: args.userId },
    select: { leagueId: true, externalId: true },
  })
  // One claimed team per league; a league with two is ambiguous and is skipped.
  const teamByLeague = new Map<string, string>()
  const twice = new Set<string>()
  for (const t of teams) {
    if (teamByLeague.has(t.leagueId)) twice.add(t.leagueId)
    if (t.externalId) teamByLeague.set(t.leagueId, String(t.externalId))
  }
  for (const id of twice) teamByLeague.delete(id)
  const mine = sleeper.filter((l) => teamByLeague.has(l.id))
  if (mine.length === 0) return null

  const siblings = await prisma.league.findMany({
    where: { platformLeagueId: { in: mine.map((l) => l.platformLeagueId as string) } },
    select: { id: true, platformLeagueId: true },
  })
  const siblingIds = new Map<string, string[]>()
  for (const l of mine) siblingIds.set(l.id, [l.id])
  for (const s of siblings) {
    for (const l of mine) {
      if (s.platformLeagueId === l.platformLeagueId && !siblingIds.get(l.id)!.includes(s.id)) siblingIds.get(l.id)!.push(s.id)
    }
  }

  const facts = (await prisma.transactionFact.findMany({
    where: {
      OR: mine.map((l) => ({
        leagueId: { in: siblingIds.get(l.id)! },
        rosterId: teamByLeague.get(l.id)!,
        season: Number(l.season),
      })),
      type: { in: ['waiver', 'free_agent', 'trade'] },
    },
    select: { transactionId: true, leagueId: true, type: true, rosterId: true, weekOrPeriod: true, payload: true },
  })) as FactRow[]

  type Add = {
    league: ReceiptsLeague
    rosterId: string
    playerId: string
    week: number
    at: string
    via: 'waiver' | 'free_agent'
    faab: number | null
    leftWeek: number | null
  }

  // Which of your leagues a fact belongs to: the one whose sibling set holds its league id.
  const leagueOfFact = (f: FactRow) =>
    mine.find((l) => siblingIds.get(l.id)!.includes(f.leagueId) && teamByLeague.get(l.id) === String(f.rosterId ?? ''))

  const adds: Add[] = []
  const byLeague = new Map<string, FactRow[]>()
  for (const f of facts) {
    const l = leagueOfFact(f)
    if (!l || f.weekOrPeriod == null) continue
    const list = byLeague.get(l.id) ?? []
    list.push(f)
    byLeague.set(l.id, list)
  }

  const orderOf = (f: FactRow) => {
    const p = (f.payload ?? {}) as FactPayload
    return `${String(f.weekOrPeriod).padStart(3, '0')}|${typeof p.createdAt === 'string' ? p.createdAt : ''}`
  }

  for (const l of mine) {
    const list = [...(byLeague.get(l.id) ?? [])].sort((a, b) => orderOf(a).localeCompare(orderOf(b)))
    list.forEach((f, i) => {
      if (f.type !== 'waiver' && f.type !== 'free_agent') return
      const p = (f.payload ?? {}) as FactPayload
      for (const playerId of idsIn(p.adds)) {
        // The first LATER transaction of yours that sends him away ends the stint.
        const exit = list.slice(i + 1).find((g) => idsIn(((g.payload ?? {}) as FactPayload).drops).includes(playerId))
        const bid = typeof p.waiverBid === 'number' ? p.waiverBid : null
        adds.push({
          league: l,
          rosterId: teamByLeague.get(l.id)!,
          playerId,
          week: f.weekOrPeriod as number,
          at: orderOf(f),
          via: f.type as 'waiver' | 'free_agent',
          faab: bid,
          leftWeek: exit?.weekOrPeriod ?? null,
        })
      }
    })
  }
  if (adds.length === 0) return { waivers: [], tooEarly: 0, unscored: 0 }

  let early = 0
  const callable = adds.filter((a) => {
    const ok = args.currentWeek != null && args.currentWeek - a.week >= MIN_WEEKS_FOR_RECEIPT
    if (!ok) early += 1
    return ok
  })
  if (callable.length === 0) return { waivers: [], tooEarly: early, unscored: 0 }

  const playerIds = [...new Set(callable.map((a) => a.playerId))]
  const [scores, players] = await Promise.all([
    prisma.leaguePlayerWeeklyScore.findMany({
      where: {
        OR: [...new Set(callable.map((a) => a.league.id))].map((id) => {
          const l = mine.find((m) => m.id === id)!
          return {
            leagueId: l.platformLeagueId as string,
            seasonYear: Number(l.season),
            week: { gte: Math.min(...callable.filter((a) => a.league.id === id).map((a) => a.week)) },
          }
        }),
        playerId: { in: playerIds },
      },
      select: { leagueId: true, week: true, playerId: true, rosterId: true, isStarter: true, points: true },
    }),
    prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: playerIds } },
      select: { sleeperId: true, name: true, position: true },
    }),
  ])
  const nameOf = new Map<string, { name: string; position: string | null }>()
  for (const p of players) {
    if (p.sleeperId && !nameOf.has(p.sleeperId)) nameOf.set(p.sleeperId, { name: p.name, position: p.position ?? null })
  }

  let unscored = 0
  const receipts: WaiverReceipt[] = []
  for (const a of callable) {
    const lastWeek = a.leftWeek != null ? a.leftWeek - 1 : Number.POSITIVE_INFINITY
    const inWindow = scores.filter(
      (s) =>
        s.leagueId === a.league.platformLeagueId &&
        s.playerId === a.playerId &&
        s.week >= a.week &&
        s.week <= lastWeek &&
        String(s.rosterId ?? '') === a.rosterId,
    )
    const droppedBeforePlaying = a.leftWeek != null && a.leftWeek <= a.week
    if (inWindow.length === 0 && !droppedBeforePlaying) {
      unscored += 1
      continue
    }
    const who = nameOf.get(a.playerId)
    receipts.push({
      id: `${a.league.id}:${a.playerId}:${a.week}`,
      leagueId: a.league.id,
      leagueName: a.league.name ?? 'Your league',
      season: Number(a.league.season),
      week: a.week,
      playerId: a.playerId,
      playerName: who?.name ?? 'Unmatched player',
      position: who?.position ?? null,
      via: a.via,
      faab: a.faab,
      points: round1(inWindow.reduce((sum, s) => sum + s.points, 0)),
      starts: inWindow.filter((s) => s.isStarter).length,
      weeksScored: inWindow.length,
      leftWeek: a.leftWeek,
      href: `/core/waivers?league=${encodeURIComponent(a.league.id)}`,
    })
  }

  receipts.sort((x, y) => y.week - x.week || y.points - x.points)
  return { waivers: receipts.slice(0, MAX_WAIVER_RECEIPTS), tooEarly: early, unscored }
}

/**
 * Every receipt the home card shows. Each kind fails on its own: a trade-cache miss never
 * hides your waiver receipts, and the reverse. Null only when neither kind has anything
 * to read.
 */
export async function getDecisionReceipts(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  ownerSleeperId: string | null
  currentWeek: number | null
}): Promise<DecisionReceiptsData | null> {
  const [trades, waivers] = await Promise.all([
    getTradeReceipts(args).catch(() => null),
    getWaiverReceipts(args).catch(() => null),
  ])
  if (!trades && !waivers) return null
  return {
    trades: trades?.trades ?? [],
    tooEarly: trades?.tooEarly ?? 0,
    uncoveredLeagues: trades?.uncoveredLeagues ?? args.leagues.filter((l) => !isSleeper(l)).length,
    ...(waivers
      ? { waivers: waivers.waivers, waiversTooEarly: waivers.tooEarly, waiversUnscored: waivers.unscored }
      : {}),
  }
}
