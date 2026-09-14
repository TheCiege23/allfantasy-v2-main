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
import { asIds, rosterCandidates } from './dash3aPanels'
import { composePlayerIdentities } from './playerIdentityCompose'
import { normalizePosition } from './positionNormalization'
import { lineupSeatsFromSettings } from './slotEligibility'

/**
 * Decision receipts — how your past moves turned out (retention item 6, user decisions
 * 2026-09-14): a weekly "receipts" card on the /core home, good and bad outcomes stated
 * plainly. Trades, waiver adds and lineups (start/sit) so far; Chimmy advice follows.
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

/**
 * Every receipt the home card shows. Each kind fails on its own: a trade-cache miss never
 * hides your waiver or lineup receipts, and the reverse. Null only when no kind has anything
 * to read.
 */
export async function getDecisionReceipts(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  ownerSleeperId: string | null
  currentWeek: number | null
}): Promise<DecisionReceiptsData | null> {
  const [trades, waivers, lineups] = await Promise.all([
    getTradeReceipts(args).catch(() => null),
    getWaiverReceipts(args).catch(() => null),
    getLineupReceipts(args).catch(() => null),
  ])
  if (!trades && !waivers && !lineups) return null
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
  }
}
