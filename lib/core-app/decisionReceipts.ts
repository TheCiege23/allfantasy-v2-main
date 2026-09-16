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
import { computeWeeklyMaxPf, type WeeklyRosterPlayer } from '@/lib/commissioner-os/efl/maxPfEngine'
import { listAdviceForUser, type ChimmyAdvice } from '@/lib/chimmy-advice/adviceStore'
import { addAdviceKey, startSitAdviceKey } from '@/lib/chimmy-advice/adviceKeys'
import { asIds, rosterCandidates } from './dash3aPanels'
import { composePlayerIdentities } from './playerIdentityCompose'
import { normalizePosition } from './positionNormalization'
import { lineupSeatsFromSettings } from './slotEligibility'

/**
 * Decision receipts — how your past moves turned out (retention item 6, user decisions
 * 2026-09-14): a weekly "receipts" card on the /core home, good and bad outcomes stated
 * plainly: trades, waiver adds, lineups (start/sit), AutoCoach calls, and Chimmy's advice — its
 * start/sit calls and the waiver claims its chat grounded on.
 *
 * TRADES read the grade cache the fifteen-minute grade cron already fills (`trade-grades:v2:*`),
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

export type LineupReceipt = {
  id: string
  leagueId: string
  leagueName: string
  season: number
  week: number
  /** Best possible legal lineup minus what your starters scored. Never negative. */
  pointsLeft: number
  /** You started the best possible lineup. */
  perfect: boolean
  /** The best player you benched who belonged in the best lineup. */
  benched: { name: string; points: number } | null
  /** The weakest starter who did not belong in it. */
  started: { name: string; points: number } | null
  /** Core's lineup screen for that league. */
  href: string
}

/** "Start X over Y" advice, resolved against that week's platform scores. */
export type StartCallReceipt = {
  id: string
  leagueId: string
  leagueName: string
  season: number
  week: number
  slot: string | null
  /** The player the advice said to start, and what he scored that week. */
  recommended: { name: string; points: number }
  /** The player it said to start him over, and what he scored. */
  instead: { name: string; points: number }
  /**
   * What your lineup ON THE PLATFORM did that week. Neither an AutoCoach swap on an imported
   * league nor Chimmy's advice changes the lineup Sleeper scores, so this is read from the
   * platform's own starters, never assumed.
   */
  followed: 'yes' | 'no' | 'unclear'
  /** Did the recommended player outscore the other? Within 1 point is "same". */
  call: 'right' | 'wrong' | 'same'
  href: string
}

export type AutoCoachReceipt = StartCallReceipt

export type ChimmyReceipt = StartCallReceipt & {
  /** How confident Chimmy said it was when it gave the advice. */
  confidencePct: number | null
}

/** "Chimmy said add X" — the waiver claim its chat grounded on, and what came of it. */
export type ChimmyAddReceipt = {
  id: string
  leagueId: string
  leagueName: string
  season: number
  /** The week Chimmy said to add him. */
  week: number
  playerName: string
  confidencePct: number | null
  /**
   * Your add of him within ADD_FOLLOW_WEEKS of the advice, and what he did ON YOUR ROSTER while he
   * was yours (the waiver receipts' tenure rule). Null = you didn't add him.
   */
  added: { week: number; points: number; starts: number; leftWeek: number | null } | null
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
  /** Your lineups in the last few completed weeks. Absent = not read. */
  lineups?: LineupReceipt[]
  /** Completed weeks with no weekly scores on file for your roster. */
  lineupsUnscored?: number
  /** Weeks that could not be checked honestly (a starter's position, or the league's slots). */
  lineupsUnreadable?: number
  /** AutoCoach's recent calls. Absent = you have none (or they could not be read). */
  autocoach?: AutoCoachReceipt[]
  /** Calls for a week still being played. */
  autocoachPending?: number
  /** Calls with no weekly score on file for one of the two players. */
  autocoachUnscored?: number
  /** Calls that could not be tied to a week or to your roster that week. */
  autocoachUnreadable?: number
  /** Chimmy's recent start/sit advice. Absent = none, or advice is unavailable (table not applied). */
  chimmy?: ChimmyReceipt[]
  /** Advice for a week still being played. */
  chimmyPending?: number
  /** Advice with no weekly score on file for one of the two players. */
  chimmyUnscored?: number
  /** Advice that could not be tied to your roster that week. */
  chimmyUnreadable?: number
  /** Chimmy's "add X" calls. Absent = none, or advice is unavailable. */
  chimmyAdds?: ChimmyAddReceipt[]
  /** Add calls fewer than MIN_WEEKS_FOR_RECEIPT weeks old, or with the current week unknown. */
  chimmyAddsTooEarly?: number
  /** Adds you made on Chimmy's call with no weekly score on file for any week he was yours. */
  chimmyAddsUnscored?: number
  /** Add calls that cannot be checked yet — transactions not synced past the week, or no single claimed team. */
  chimmyAddsUnknown?: number
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

/** One of your waiver or free-agent adds, and the week it ended (when it did). */
export type SeasonAdd = {
  league: ReceiptsLeague
  rosterId: string
  playerId: string
  week: number
  at: string
  via: 'waiver' | 'free_agent'
  faab: number | null
  leftWeek: number | null
}

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
export async function loadSeasonAdds(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
}): Promise<{ mine: ReceiptsLeague[]; siblingIds: Map<string, string[]>; adds: SeasonAdd[] } | null> {
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

  // Which of your leagues a fact belongs to: the one whose sibling set holds its league id.
  const leagueOfFact = (f: FactRow) =>
    mine.find((l) => siblingIds.get(l.id)!.includes(f.leagueId) && teamByLeague.get(l.id) === String(f.rosterId ?? ''))

  const adds: SeasonAdd[] = []
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
  return { mine, siblingIds, adds }
}

type AddCredit = { add: SeasonAdd; points: number; starts: number; weeksScored: number; name: string | null; position: string | null }

/**
 * What each add scored ON YOUR ROSTER while he was yours — one read for all of them. Null for an
 * add with no score row for any week he was yours (unless he was dropped before he could play,
 * which is a real 0). Shared by waiver receipts and Chimmy's add calls, so the two can never
 * credit the same add differently.
 */
async function creditAdds(callable: readonly SeasonAdd[], mine: readonly ReceiptsLeague[]): Promise<Array<AddCredit | null>> {
  if (callable.length === 0) return []
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

  return callable.map((a) => {
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
    if (inWindow.length === 0 && !droppedBeforePlaying) return null
    const who = nameOf.get(a.playerId)
    return {
      add: a,
      points: round1(inWindow.reduce((sum, s) => sum + s.points, 0)),
      starts: inWindow.filter((s) => s.isStarter).length,
      weeksScored: inWindow.length,
      name: who?.name ?? null,
      position: who?.position ?? null,
    }
  })
}

/** Your waiver and free-agent adds this season, and what each did for you — see `loadSeasonAdds`. */
export async function getWaiverReceipts(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  currentWeek: number | null
}): Promise<{ waivers: WaiverReceipt[]; tooEarly: number; unscored: number } | null> {
  const loaded = await loadSeasonAdds(args)
  if (!loaded) return null
  const { mine, adds } = loaded
  if (adds.length === 0) return { waivers: [], tooEarly: 0, unscored: 0 }

  let early = 0
  const callable = adds.filter((a) => {
    const ok = args.currentWeek != null && args.currentWeek - a.week >= MIN_WEEKS_FOR_RECEIPT
    if (!ok) early += 1
    return ok
  })
  if (callable.length === 0) return { waivers: [], tooEarly: early, unscored: 0 }

  let unscored = 0
  const receipts: WaiverReceipt[] = []
  for (const c of await creditAdds(callable, mine)) {
    if (!c) {
      unscored += 1
      continue
    }
    const a = c.add
    receipts.push({
      id: `${a.league.id}:${a.playerId}:${a.week}`,
      leagueId: a.league.id,
      leagueName: a.league.name ?? 'Your league',
      season: Number(a.league.season),
      week: a.week,
      playerId: a.playerId,
      playerName: c.name ?? 'Unmatched player',
      position: c.position,
      via: a.via,
      faab: a.faab,
      points: c.points,
      starts: c.starts,
      weeksScored: c.weeksScored,
      leftWeek: a.leftWeek,
      href: `/core/waivers?league=${encodeURIComponent(a.league.id)}`,
    })
  }

  receipts.sort((x, y) => y.week - x.week || y.points - x.points)
  return { waivers: receipts.slice(0, MAX_WAIVER_RECEIPTS), tooEarly: early, unscored }
}

/* ── Lineups (start/sit) ──────────────────────────────────────────────────────── */

/** Completed weeks looked back over. */
export const LINEUP_RECEIPT_WEEKS = 3
export const MAX_LINEUP_RECEIPTS = 5

const isBestBall = (settings: unknown, leagueType: string | null | undefined) => {
  const s = (settings ?? {}) as Record<string, unknown>
  return String(leagueType ?? '').toLowerCase() === 'best_ball' || Boolean(s.best_ball) || Boolean(s.bestBall)
}

/**
 * Points you left on your bench in each of the last few completed weeks.
 *
 * ⚠ THE BEST LINEUP IS THE EXACT OPTIMIZER, NOT A GREEDY PASS. `computeWeeklyMaxPf` (EFL's
 * true Max PF engine) seats your players against the league's own starting slots with an
 * exact matching — FLEX and superflex included — and reports `pointsLeftOnBench`. The Best
 * Ball greedy optimizer can be 20 points wrong and is not used. The number is never called
 * "Max PF": that name already means points scored elsewhere in this repo.
 *
 * ⚠ SCORES ARE THE PLATFORM'S, NEVER OURS. `league_player_weekly_scores` holds Sleeper's own
 * points per player per week for the WHOLE roster (bench included, `isStarter` set).
 *
 * WITHHELD, NEVER SHOWN AS A NUMBER:
 *   - a week with no score rows for your roster (only recent weeks are ingested) → unscored;
 *   - a week where a STARTER has no position on file — his seat cannot be checked, so the
 *     actual total would be compared against a lineup missing him → unreadable;
 *   - a league whose slots are missing or include one we do not recognise, or a week where
 *     the best lineup still leaves a seat empty → unreadable;
 *   - the current week and later (`isFinalized` is never set, so "complete" = before it);
 *   - best-ball leagues, which have no start/sit decision at all.
 *
 * ⚠ IR/TAXI IS APPROXIMATE. Per-week reserve and taxi membership is not stored, so a bench
 * player on your CURRENT reserve/taxi list is left out of the best lineup (he could not have
 * started). Membership that changed since that week is not reconstructed.
 */
export async function getLineupReceipts(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  currentWeek: number | null
}): Promise<{ lineups: LineupReceipt[]; unscored: number; unreadable: number } | null> {
  if (!args.userId || args.currentWeek == null) return null
  const weeks = Array.from({ length: LINEUP_RECEIPT_WEEKS }, (_, i) => args.currentWeek! - 1 - i).filter((w) => w >= 1)
  if (weeks.length === 0) return null

  const sleeper = args.leagues
    .filter((l) => isSleeper(l) && l.season != null && String(l.season).trim() !== '' && Number.isFinite(Number(l.season)))
    .slice(0, MAX_WAIVER_LEAGUES)
  if (sleeper.length === 0) return null

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: { in: sleeper.map((l) => l.id) }, claimedByUserId: args.userId },
    select: { leagueId: true, externalId: true, platformUserId: true },
  })
  const teamByLeague = new Map<string, { externalId: string; platformUserId: string | null }>()
  const twice = new Set<string>()
  for (const t of teams) {
    if (teamByLeague.has(t.leagueId)) twice.add(t.leagueId)
    if (t.externalId) teamByLeague.set(t.leagueId, { externalId: String(t.externalId), platformUserId: t.platformUserId ?? null })
  }
  for (const id of twice) teamByLeague.delete(id)
  const mine = sleeper.filter((l) => teamByLeague.has(l.id) && Number.isFinite(Number(teamByLeague.get(l.id)!.externalId)))
  if (mine.length === 0) return null

  const meta = await prisma.league.findMany({
    where: { id: { in: mine.map((l) => l.id) } },
    select: { id: true, settings: true, leagueType: true },
  })
  const metaById = new Map(meta.map((m) => [m.id, m]))

  let unreadable = 0
  const seatsByLeague = new Map<string, NonNullable<ReturnType<typeof lineupSeatsFromSettings>>>()
  for (const l of mine) {
    const m = metaById.get(l.id)
    if (!m || isBestBall(m.settings, m.leagueType)) continue
    const seats = lineupSeatsFromSettings(m.settings)
    if (!seats) {
      unreadable += weeks.length
      continue
    }
    seatsByLeague.set(l.id, seats)
  }
  const scoreable = mine.filter((l) => seatsByLeague.has(l.id))
  if (scoreable.length === 0) return { lineups: [], unscored: 0, unreadable }

  const [scores, rosters] = await Promise.all([
    prisma.leaguePlayerWeeklyScore.findMany({
      where: {
        OR: scoreable.map((l) => ({
          leagueId: l.platformLeagueId as string,
          seasonYear: Number(l.season),
          rosterId: Number(teamByLeague.get(l.id)!.externalId),
          week: { in: weeks },
        })),
      },
      select: { leagueId: true, week: true, playerId: true, isStarter: true, points: true },
    }),
    prisma.roster.findMany({
      where: {
        OR: scoreable.map((l) => ({
          leagueId: l.id,
          platformUserId: { in: rosterCandidates(teamByLeague.get(l.id)!, args.userId) },
        })),
      },
      select: { leagueId: true, playerData: true },
    }),
  ])

  const inactiveByLeague = new Map<string, Set<string>>()
  for (const r of rosters) {
    if (inactiveByLeague.has(r.leagueId)) continue
    const pd = (r.playerData ?? {}) as Record<string, unknown>
    inactiveByLeague.set(r.leagueId, new Set([...asIds(pd.reserve), ...asIds(pd.taxi)]))
  }

  const ids = [...new Set(scores.map((s) => s.playerId))]
  const identities = composePlayerIdentities(
    ids.length
      ? await prisma.sportsPlayer.findMany({
          where: { sleeperId: { in: ids } },
          select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true },
        })
      : [],
  )

  let unscored = 0
  const receipts: LineupReceipt[] = []
  for (const l of scoreable) {
    const inactive = inactiveByLeague.get(l.id) ?? new Set<string>()
    for (const week of weeks) {
      const rows = scores.filter((s) => s.leagueId === l.platformLeagueId && s.week === week)
      if (rows.length === 0) {
        unscored += 1
        continue
      }
      const players: WeeklyRosterPlayer[] = []
      let starterUnplaced = false
      for (const r of rows) {
        // A player on your reserve/taxi list could not have started, unless he did.
        if (!r.isStarter && inactive.has(r.playerId)) continue
        const who = identities.get(r.playerId)
        const positions = String(who?.position ?? '')
          .split('/')
          .map((p) => normalizePosition(p))
          .filter(Boolean)
        if (positions.length === 0) {
          if (r.isStarter) starterUnplaced = true
          continue
        }
        players.push({ playerId: r.playerId, playerName: who?.name ?? null, positions, points: r.points, wasStarter: r.isStarter })
      }
      if (starterUnplaced) {
        unreadable += 1
        continue
      }
      const row = computeWeeklyMaxPf({ week, slots: seatsByLeague.get(l.id)!, teams: [{ teamId: l.id, players }] }).rows[0]
      if (!row || row.optimal.unfilledSlots.length > 0) {
        unreadable += 1
        continue
      }
      const best = new Set(row.optimal.assignments.map((a) => a.playerId))
      const benched = players.filter((p) => !p.wasStarter && best.has(p.playerId)).sort((a, b) => b.points - a.points)[0]
      const started = players.filter((p) => p.wasStarter && !best.has(p.playerId)).sort((a, b) => a.points - b.points)[0]
      const pointsLeft = Math.max(0, round1(row.pointsLeftOnBench))
      receipts.push({
        id: `${l.id}:${week}`,
        leagueId: l.id,
        leagueName: l.name ?? 'Your league',
        season: Number(l.season),
        week,
        pointsLeft,
        perfect: pointsLeft === 0,
        benched: benched ? { name: benched.playerName ?? 'Unmatched player', points: round1(benched.points) } : null,
        started: started ? { name: started.playerName ?? 'Unmatched player', points: round1(started.points) } : null,
        href: `/core/my-team?league=${encodeURIComponent(l.id)}`,
      })
    }
  }

  receipts.sort((a, b) => b.week - a.week || b.pointsLeft - a.pointsLeft)
  return { lineups: receipts.slice(0, MAX_LINEUP_RECEIPTS), unscored, unreadable }
}

/* ── AutoCoach calls ──────────────────────────────────────────────────────────── */

export const MAX_AUTOCOACH_RECEIPTS = 5
/** How far back AutoCoach swaps are read. */
export const AUTOCOACH_LOOKBACK_DAYS = 45
/** Within this many points, the call is "about the same" either way. */
const AUTOCOACH_SAME_BAND = 1

/**
 * How AutoCoach's recent calls turned out — the first of Chimmy's advice to get receipts
 * (user decisions, 2026-09-14), and the one that needs no new table: `AutoCoachSwapLog`
 * already records each swap with both players' ids.
 *
 * 🛑 ON AN IMPORTED LEAGUE A "SWAP" IS ADVICE, NOT A LINEUP CHANGE. `executeAutoCoachSwap`
 * writes the log and then AllFantasy's own `Roster.playerData`; the Sleeper API has no write
 * endpoint, so the lineup Sleeper actually scored is whatever the manager set there. So the
 * receipt says "AutoCoach said start X", and `followed` comes from Sleeper's own starters that
 * week (`league_player_weekly_scores.isStarter`) — never assumed from the log.
 *
 * ⚠ THE WEEK COMES ONLY FROM AN EXACT GAME MATCH. The log has no week column. It is taken from
 * the regular-season `SportsGame` whose `startTime` equals the swap's `gameStartsAt` — never from
 * `nflWeekForDate`, a calendar estimate its own callers pad by ±1 week. No match is unreadable.
 *
 * Counted, never shown as a number: a week still being played (pending); either player with
 * no score that week (unscored); no game match, no single claimed team, or either player not
 * on your roster that week (unreadable). Duplicate rows for one call count once.
 */
export async function getAutoCoachReceipts(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  currentWeek: number | null
}): Promise<{ autocoach: AutoCoachReceipt[]; pending: number; unscored: number; unreadable: number } | null> {
  if (!args.userId) return null
  const sleeper = args.leagues.filter(isSleeper).slice(0, MAX_WAIVER_LEAGUES)
  if (sleeper.length === 0) return null

  const swaps = await prisma.autoCoachSwapLog.findMany({
    where: {
      userId: args.userId,
      leagueId: { in: sleeper.map((l) => l.id) },
      swapMadeAt: { gte: new Date(Date.now() - AUTOCOACH_LOOKBACK_DAYS * 86_400_000) },
    },
    orderBy: { swapMadeAt: 'desc' },
    take: 60,
    select: {
      leagueId: true,
      slotPosition: true,
      playerOutId: true,
      playerOutName: true,
      playerInId: true,
      playerInName: true,
      gameStartsAt: true,
    },
  })
  if (swaps.length === 0) return null

  const involved = [...new Set(swaps.map((s) => s.leagueId))]
  const starts = [...new Set(swaps.map((s) => s.gameStartsAt?.getTime()).filter((t): t is number => t != null))]
  const [teams, games] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId: { in: involved }, claimedByUserId: args.userId },
      select: { leagueId: true, externalId: true },
    }),
    starts.length > 0
      ? prisma.sportsGame.findMany({
          where: { sport: 'NFL', seasonType: 'regular', startTime: { in: starts.map((t) => new Date(t)) } },
          select: { startTime: true, week: true, season: true },
        })
      : Promise.resolve([] as Array<{ startTime: Date | null; week: number | null; season: number | null }>),
  ])

  const rosterByLeague = claimedRosterIds(teams)

  // One fixture arrives from up to four providers; they must agree on the week or it is unusable.
  const weekByStart = new Map<number, { week: number; season: number } | 'conflict'>()
  for (const g of games) {
    if (!g.startTime || g.week == null || g.season == null) continue
    const key = g.startTime.getTime()
    const held = weekByStart.get(key)
    if (!held) weekByStart.set(key, { week: g.week, season: g.season })
    else if (held !== 'conflict' && (held.week !== g.week || held.season !== g.season)) weekByStart.set(key, 'conflict')
  }

  type Call = (typeof swaps)[number] & { league: ReceiptsLeague; week: number; season: number; rosterId: number }
  let pending = 0
  let unreadable = 0
  const seen = new Set<string>()
  const callable: Call[] = []
  for (const s of swaps) {
    const league = sleeper.find((l) => l.id === s.leagueId)
    const rosterId = rosterByLeague.get(s.leagueId)
    const when = s.gameStartsAt ? weekByStart.get(s.gameStartsAt.getTime()) : undefined
    if (!league || rosterId == null || !when || when === 'conflict') {
      unreadable += 1
      continue
    }
    const key = `${s.leagueId}:${when.season}:${when.week}:${s.playerInId}:${s.playerOutId}`
    if (seen.has(key)) continue
    seen.add(key)
    if (args.currentWeek == null || when.week >= args.currentWeek) {
      pending += 1
      continue
    }
    callable.push({ ...s, league, week: when.week, season: when.season, rosterId })
  }
  if (callable.length === 0) return { autocoach: [], pending, unscored: 0, unreadable }

  const scored = await scoreStartCalls(
    callable.map((c) => ({
      league: c.league,
      season: c.season,
      week: c.week,
      rosterId: c.rosterId,
      slot: c.slotPosition || null,
      rec: { key: c.playerInId, name: c.playerInName },
      alt: { key: c.playerOutId, name: c.playerOutName },
    })),
  )
  return {
    autocoach: scored.receipts.slice(0, MAX_AUTOCOACH_RECEIPTS),
    pending,
    unscored: scored.unscored,
    unreadable: unreadable + scored.unreadable,
  }
}

/** Your Sleeper roster id per league, from your claimed teams. A league with two claims has none. */
export function claimedRosterIds(teams: ReadonlyArray<{ leagueId: string; externalId: string | null }>): Map<string, number> {
  const rosterByLeague = new Map<string, number>()
  const twice = new Set<string>()
  for (const t of teams) {
    if (rosterByLeague.has(t.leagueId)) twice.add(t.leagueId)
    const n = Number(t.externalId)
    if (Number.isFinite(n)) rosterByLeague.set(t.leagueId, n)
  }
  for (const id of twice) rosterByLeague.delete(id)
  return rosterByLeague
}

type StartCall = {
  league: ReceiptsLeague
  season: number
  week: number
  rosterId: number
  slot: string | null
  rec: { key: string; name: string }
  alt: { key: string; name: string }
}

/**
 * Both players' weekly scores for each "start X over Y", one read for all of them — shared by
 * AutoCoach and Chimmy so the two can never disagree about what "right" or "followed" means.
 * Either player unscored is unscored; either player not on YOUR roster that week is unreadable.
 * Newest weeks first.
 */
async function scoreStartCalls(
  calls: readonly StartCall[],
): Promise<{ receipts: StartCallReceipt[]; unscored: number; unreadable: number }> {
  const scores = await prisma.leaguePlayerWeeklyScore.findMany({
    where: {
      OR: calls.map((c) => ({ leagueId: c.league.platformLeagueId as string, seasonYear: c.season, week: c.week })),
      playerId: { in: [...new Set(calls.flatMap((c) => [c.rec.key, c.alt.key]))] },
    },
    select: { leagueId: true, seasonYear: true, week: true, playerId: true, rosterId: true, isStarter: true, points: true },
  })

  let unscored = 0
  let unreadable = 0
  const receipts: StartCallReceipt[] = []
  for (const c of calls) {
    const find = (playerId: string) =>
      scores.find(
        (s) => s.leagueId === c.league.platformLeagueId && s.seasonYear === c.season && s.week === c.week && s.playerId === playerId,
      )
    const rec = find(c.rec.key)
    const alt = find(c.alt.key)
    if (!rec || !alt) {
      unscored += 1
      continue
    }
    if (rec.rosterId !== c.rosterId || alt.rosterId !== c.rosterId) {
      unreadable += 1
      continue
    }
    const delta = rec.points - alt.points
    receipts.push({
      id: `${c.league.id}:${c.season}:${c.week}:${c.rec.key}:${c.alt.key}`,
      leagueId: c.league.id,
      leagueName: c.league.name ?? 'Your league',
      season: c.season,
      week: c.week,
      slot: c.slot,
      recommended: { name: c.rec.name, points: round1(rec.points) },
      instead: { name: c.alt.name, points: round1(alt.points) },
      followed: rec.isStarter && !alt.isStarter ? 'yes' : alt.isStarter && !rec.isStarter ? 'no' : 'unclear',
      call: Math.abs(delta) < AUTOCOACH_SAME_BAND ? 'same' : delta > 0 ? 'right' : 'wrong',
      href: `/core/my-team?league=${encodeURIComponent(c.league.id)}`,
    })
  }

  receipts.sort((a, b) => b.season - a.season || b.week - a.week)
  return { receipts, unscored, unreadable }
}

/* ── Chimmy's advice ──────────────────────────────────────────────────────────── */

export const MAX_CHIMMY_RECEIPTS = 5
/** How far back Chimmy's advice is read. */
export const CHIMMY_LOOKBACK_DAYS = 45

/*
 * Receipt ids ARE advice keys (`lib/chimmy-advice/adviceKeys.ts`), so the drawer's buttons and the
 * outcome loop name the same advice the card does. The start/sit form is also the id
 * `scoreStartCalls` gives every start call — the confidence lookup below relies on the two agreeing.
 */
export { addAdviceKey, startSitAdviceKey }

/**
 * EVERY resolved outcome of a user's Chimmy advice — the Receipts card's rules, unsliced — plus the
 * advice it was resolved from. The outcome loop (`lib/chimmy-outcomes/adviceLearning.ts`) reads
 * this, so "right", "followed" and "you added him" can never mean one thing on the card and
 * another in what Chimmy learns. Null when the advice table is unavailable.
 */
export async function resolveChimmyAdviceOutcomes(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  currentWeek: number | null
  since: Date
}): Promise<{ advice: ChimmyAdvice[]; startSits: ChimmyReceipt[]; adds: ChimmyAddReceipt[] } | null> {
  if (!args.userId) return null
  const sleeper = args.leagues.filter(isSleeper).slice(0, MAX_WAIVER_LEAGUES)
  if (sleeper.length === 0) return { advice: [], startSits: [], adds: [] }
  const advice = await listAdviceForUser({ userId: args.userId, leagueIds: sleeper.map((l) => l.id), since: args.since })
  if (!advice) return null
  const startSits = advice.filter((a) => a.adviceType === 'start_sit' && a.alt)
  const addCalls = advice.filter((a) => a.adviceType === 'add')
  const [starts, adds] = await Promise.all([
    startSits.length > 0 ? chimmyStartSitReceipts(args, sleeper, startSits, Number.POSITIVE_INFINITY) : null,
    addCalls.length > 0 ? chimmyAddReceipts(args, sleeper, addCalls, Number.POSITIVE_INFINITY) : null,
  ])
  return { advice, startSits: starts?.chimmy ?? [], adds: adds?.adds ?? [] }
}

/**
 * How Chimmy's start/sit advice turned out (user decisions, 2026-09-14). The advice is what
 * `lib/chimmy-advice` recorded when it was given — the comparison's call, with both players'
 * roster Sleeper ids — and the outcome is resolved here, from the same weekly scores and by the
 * same rules as AutoCoach's calls (`scoreStartCalls`).
 *
 * 🛑 THE ADVICE TABLE IS PARKED. Until `20260914230000_chimmy_advice` is applied, the store
 * answers `null` ("unavailable") and this returns null, so the card has no Chimmy section —
 * never an empty one that reads as "Chimmy never advised you".
 *
 * Counted, never shown as a number: advice for a week still being played or with the week
 * unknown (pending); either player with no score that week (unscored); no single claimed team,
 * or either player not on your roster that week (unreadable). Only start/sit advice for now;
 * waiver adds get their receipt with the chat capture.
 */
export async function getChimmyAdviceReceipts(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  currentWeek: number | null
}): Promise<{
  chimmy: ChimmyReceipt[]
  pending: number
  unscored: number
  unreadable: number
  adds?: ChimmyAddReceipt[]
  addsTooEarly?: number
  addsUnscored?: number
  addsUnknown?: number
} | null> {
  if (!args.userId) return null
  const sleeper = args.leagues.filter(isSleeper).slice(0, MAX_WAIVER_LEAGUES)
  if (sleeper.length === 0) return null

  const advice = await listAdviceForUser({
    userId: args.userId,
    leagueIds: sleeper.map((l) => l.id),
    since: new Date(Date.now() - CHIMMY_LOOKBACK_DAYS * 86_400_000),
  })
  const all = advice ?? []
  const startSits = all.filter((a) => a.adviceType === 'start_sit' && a.alt)
  const addCalls = all.filter((a) => a.adviceType === 'add')
  if (startSits.length === 0 && addCalls.length === 0) return null

  const [starts, adds] = await Promise.all([
    startSits.length > 0 ? chimmyStartSitReceipts(args, sleeper, startSits) : null,
    addCalls.length > 0 ? chimmyAddReceipts(args, sleeper, addCalls) : null,
  ])
  return {
    chimmy: starts?.chimmy ?? [],
    pending: starts?.pending ?? 0,
    unscored: starts?.unscored ?? 0,
    unreadable: starts?.unreadable ?? 0,
    ...(adds ? { adds: adds.adds, addsTooEarly: adds.tooEarly, addsUnscored: adds.unscored, addsUnknown: adds.unknown } : {}),
  }
}

/** Chimmy's start/sit advice, resolved by the same rules as AutoCoach's calls. */
async function chimmyStartSitReceipts(
  args: { userId: string; currentWeek: number | null },
  sleeper: readonly ReceiptsLeague[],
  startSits: readonly ChimmyAdvice[],
  limit: number = MAX_CHIMMY_RECEIPTS,
): Promise<{ chimmy: ChimmyReceipt[]; pending: number; unscored: number; unreadable: number }> {
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: { in: [...new Set(startSits.map((a) => a.leagueId))] }, claimedByUserId: args.userId },
    select: { leagueId: true, externalId: true },
  })
  const rosterByLeague = claimedRosterIds(teams)

  let pending = 0
  let unreadable = 0
  const confidence = new Map<string, number | null>()
  const callable: StartCall[] = []
  for (const a of startSits) {
    const league = sleeper.find((l) => l.id === a.leagueId)
    const rosterId = rosterByLeague.get(a.leagueId)
    if (!league || rosterId == null) {
      unreadable += 1
      continue
    }
    if (args.currentWeek == null || a.week >= args.currentWeek) {
      pending += 1
      continue
    }
    callable.push({ league, season: a.season, week: a.week, rosterId, slot: a.slot, rec: a.rec, alt: a.alt! })
    confidence.set(startSitAdviceKey(league.id, a.season, a.week, a.rec.key, a.alt!.key), a.confidencePct)
  }
  if (callable.length === 0) return { chimmy: [], pending, unscored: 0, unreadable }

  const scored = await scoreStartCalls(callable)
  return {
    chimmy: scored.receipts
      .slice(0, limit)
      .map((r) => ({ ...r, confidencePct: confidence.get(r.id) ?? null })),
    pending,
    unscored: scored.unscored,
    unreadable: unreadable + scored.unreadable,
  }
}

/** Chimmy said add him in week N; an add of yours in weeks N..N+this counts as taking the advice. */
export const ADD_FOLLOW_WEEKS = 1

/**
 * Chimmy's "add X" calls — the waiver claims its chat grounded on — and what came of each (user
 * decision 2026-09-14: waiver claims only).
 *
 * ⚠ "YOU ADDED HIM" USES THE WAIVER RECEIPTS' OWN READS AND TENURE RULE (`loadSeasonAdds`,
 * `creditAdds`): your add of that Sleeper id within ADD_FOLLOW_WEEKS of the advice, credited only
 * while he was on your roster.
 *
 * 🛑 "YOU DIDN'T ADD HIM" IS A CLAIM, MADE ONLY WHEN IT IS CHECKABLE. Transactions sync in batches,
 * so "no add on file" means nothing until the league's facts — any roster's — reach past the follow
 * window; until then the call is `unknown`, never a "you didn't". And no points are ever shown for a
 * player you passed on: a free agent's weekly points are not on file.
 *
 * Too early (fewer than MIN_WEEKS_FOR_RECEIPT weeks, or the week unknown), unscored and unknown are
 * counted, never shown as numbers. An advice season that is not the league's season is unknown.
 */
async function chimmyAddReceipts(
  args: { userId: string; currentWeek: number | null },
  sleeper: readonly ReceiptsLeague[],
  calls: readonly ChimmyAdvice[],
  limit: number = MAX_CHIMMY_RECEIPTS,
): Promise<{ adds: ChimmyAddReceipt[]; tooEarly: number; unscored: number; unknown: number }> {
  let tooEarly = 0
  const callable = calls.filter((a) => {
    const ok = args.currentWeek != null && args.currentWeek - a.week >= MIN_WEEKS_FOR_RECEIPT
    if (!ok) tooEarly += 1
    return ok
  })
  if (callable.length === 0) return { adds: [], tooEarly, unscored: 0, unknown: 0 }

  const loaded = await loadSeasonAdds({ userId: args.userId, leagues: sleeper })
  if (!loaded) return { adds: [], tooEarly, unscored: 0, unknown: callable.length }

  /*
   * How far each league's transactions have synced, across EVERY roster in it — IN THE ADVICE'S
   * SEASON.
   *
   * 🛑 THIS HAD NO SEASON, AND THE HISTORY SYNC WRITES EVERY PAST SEASON UNDER THE CURRENT
   * `League.id`. Last season's week 17–18 rows made any league read as synced through week 18, so
   * a week-3 add that had simply not synced yet came back as "you didn't add him" — the one claim
   * this function exists to make only when it is checkable. Found 2026-09-16 (Chimmy item 10),
   * the same day `chimmy_advice` went live and this card started showing to users.
   */
  const adviceSeasons = [...new Set(callable.map((a) => a.season))]
  const synced = await prisma.transactionFact.groupBy({
    by: ['leagueId', 'season'],
    where: {
      leagueId: { in: [...new Set([...loaded.siblingIds.values()].flat())] },
      season: { in: adviceSeasons },
    },
    _max: { weekOrPeriod: true },
  })
  const syncedThrough = (league: ReceiptsLeague, season: number) => {
    const ids = loaded.siblingIds.get(league.id) ?? [league.id]
    return Math.max(
      -1,
      ...synced
        .filter((s) => ids.includes(s.leagueId) && s.season === season)
        .map((s) => s._max.weekOrPeriod ?? -1),
    )
  }

  let unknown = 0
  const matched: Array<{ advice: ChimmyAdvice; league: ReceiptsLeague; add: SeasonAdd | null }> = []
  for (const a of callable) {
    const league = loaded.mine.find((l) => l.id === a.leagueId)
    if (!league || Number(league.season) !== a.season) {
      unknown += 1
      continue
    }
    const add =
      loaded.adds.find(
        (x) => x.league.id === league.id && x.playerId === a.rec.key && x.week >= a.week && x.week <= a.week + ADD_FOLLOW_WEEKS,
      ) ?? null
    if (!add && syncedThrough(league, a.season) < a.week + ADD_FOLLOW_WEEKS) {
      unknown += 1
      continue
    }
    matched.push({ advice: a, league, add })
  }

  const followed = matched.filter((m) => m.add)
  const credits = await creditAdds(followed.map((m) => m.add!), loaded.mine)
  const creditOf = new Map<SeasonAdd, AddCredit | null>()
  followed.forEach((m, i) => creditOf.set(m.add!, credits[i] ?? null))

  let unscored = 0
  const receipts: ChimmyAddReceipt[] = []
  for (const m of matched) {
    const credit = m.add ? creditOf.get(m.add) ?? null : null
    if (m.add && !credit) {
      unscored += 1
      continue
    }
    receipts.push({
      id: addAdviceKey(m.league.id, m.advice.season, m.advice.week, m.advice.rec.key),
      leagueId: m.league.id,
      leagueName: m.league.name ?? 'Your league',
      season: m.advice.season,
      week: m.advice.week,
      playerName: m.advice.rec.name,
      confidencePct: m.advice.confidencePct,
      added:
        m.add && credit ? { week: m.add.week, points: credit.points, starts: credit.starts, leftWeek: m.add.leftWeek } : null,
      href: `/core/waivers?league=${encodeURIComponent(m.league.id)}`,
    })
  }

  receipts.sort((x, y) => y.season - x.season || y.week - x.week)
  return { adds: receipts.slice(0, limit), tooEarly, unscored, unknown }
}

/**
 * Every receipt the home card shows. Each kind fails on its own: a trade-cache miss never
 * hides your waiver, lineup, AutoCoach or Chimmy receipts, and the reverse. Null only when no
 * kind has anything to read.
 */
export async function getDecisionReceipts(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  ownerSleeperId: string | null
  currentWeek: number | null
}): Promise<DecisionReceiptsData | null> {
  const [trades, waivers, lineups, autocoach, chimmy] = await Promise.all([
    getTradeReceipts(args).catch(() => null),
    getWaiverReceipts(args).catch(() => null),
    getLineupReceipts(args).catch(() => null),
    getAutoCoachReceipts(args).catch(() => null),
    getChimmyAdviceReceipts(args).catch(() => null),
  ])
  if (!trades && !waivers && !lineups && !autocoach && !chimmy) return null
  return {
    trades: trades?.trades ?? [],
    tooEarly: trades?.tooEarly ?? 0,
    uncoveredLeagues: trades?.uncoveredLeagues ?? args.leagues.filter((l) => !isSleeper(l)).length,
    ...(waivers
      ? { waivers: waivers.waivers, waiversTooEarly: waivers.tooEarly, waiversUnscored: waivers.unscored }
      : {}),
    ...(lineups
      ? { lineups: lineups.lineups, lineupsUnscored: lineups.unscored, lineupsUnreadable: lineups.unreadable }
      : {}),
    ...(autocoach
      ? {
          autocoach: autocoach.autocoach,
          autocoachPending: autocoach.pending,
          autocoachUnscored: autocoach.unscored,
          autocoachUnreadable: autocoach.unreadable,
        }
      : {}),
    ...(chimmy
      ? {
          chimmy: chimmy.chimmy,
          chimmyPending: chimmy.pending,
          chimmyUnscored: chimmy.unscored,
          chimmyUnreadable: chimmy.unreadable,
          ...(chimmy.adds
            ? {
                chimmyAdds: chimmy.adds,
                chimmyAddsTooEarly: chimmy.addsTooEarly,
                chimmyAddsUnscored: chimmy.addsUnscored,
                chimmyAddsUnknown: chimmy.addsUnknown,
              }
            : {}),
        }
      : {}),
  }
}
