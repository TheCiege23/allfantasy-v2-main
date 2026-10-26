/**
 * Everything `computeSeasonRecap` needs, read from Postgres. READ-ONLY: no write and no provider call.
 *
 * Sources, all written by the season itself:
 *   standings          RedraftRoster (wins, losses, points, seed)
 *   weekly awards      RedraftMatchup — final regular-season games, median games excluded
 *   champion           RedraftPlayoffBracket.structure (the playoff finalizer's result), else the
 *                      season archive's isChampion / isRunnerUp flags (LeagueSeason.teamRecords)
 *   lower bracket      the bracket's played rounds at roundNumber >= 100
 *   trades             executed redraft proposals with their frozen RedraftTradeValueSnapshot, and
 *                      processed AF league trades with their frozen TradeDecisionSnapshot
 *   pickups            RedraftRosterPlayer rows acquired on waivers / free agency, scored from the
 *                      stored PlayerWeeklyScore rows for the weeks after the pickup
 *   most improved      last season's archive for the same managers (LeagueSeason, season - 1)
 *
 * ⚠ `PlayerWeeklyScore.fantasyPts` IS ONE ROW PER PLAYER-WEEK, NOT PER LEAGUE. It is the score the last
 * league to score that player wrote, so a pickup's "points after" is an approximation of this league's
 * scoring when two leagues score the same player differently. It is the only per-player weekly figure
 * stored; the matchup snapshots carry roster totals only.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { CONSOLATION_ROUND_OFFSET } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { lowerBracketFinal } from '@/lib/playoff-runtime/consolationPlaysFor'
import { dailySportWeekForInstant } from '@/lib/season-week/dailySportSeasonStarts'
import { nflWeekForDate } from '@/lib/import-os/season'
import { publicTradeDecisionReceipt } from '@/lib/league-trade-engine/tradeDecisionReceipt'
import type { RecapPickup, RecapTrade, SeasonRecapInput } from './computeSeasonRecap'

type Db = PrismaClient

const PICKUP_ACQUISITIONS = ['waiver', 'free_agent']
const DAILY_SPORTS = new Set(['NBA', 'NHL', 'MLB'])

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** The fantasy week an instant falls in, for the sports whose calendar is known here. Null = cannot tell. */
export function recapWeekAt(sport: string, season: number, at: Date): number | null {
  const s = String(sport).toUpperCase()
  if (DAILY_SPORTS.has(s)) return dailySportWeekForInstant(s, season, at)
  if (s === 'NFL') {
    // nflWeekForDate answers for the season containing `at`; a date from another season is not a week of this one.
    const month = at.getUTCMonth() + 1
    const seasonOfDate = month <= 6 ? at.getUTCFullYear() - 1 : at.getUTCFullYear()
    return seasonOfDate === season ? nflWeekForDate(at) : null
  }
  return null
}

/**
 * Each roster's value in and out of one redraft trade, from its frozen value snapshot. Null when the
 * snapshot could not grade it (`insufficientData`) — an unvalued trade is not a zero-value trade.
 */
export function redraftTradeSides(payload: unknown): RecapTrade['sides'] | null {
  const p = record(payload)
  if (record(p.grade).insufficientData === true) return null
  const sides = Array.isArray(p.sides) ? p.sides.map(record) : []
  const assets = sides.flatMap((side) => (Array.isArray(side.assets) ? side.assets.map(record) : []))
  if (assets.length === 0) return null
  const totals = new Map<string, { valueIn: number; valueOut: number }>()
  const row = (id: string) => {
    const r = totals.get(id) ?? { valueIn: 0, valueOut: 0 }
    totals.set(id, r)
    return r
  }
  for (const a of assets) {
    if (typeof a.fromRosterId !== 'string' || typeof a.toRosterId !== 'string') continue
    const v = num(a.internalValue)
    row(a.fromRosterId).valueOut += v
    row(a.toRosterId).valueIn += v
  }
  return [...totals.entries()].map(([rosterId, t]) => ({ rosterId, ...t }))
}

export async function loadSeasonRecapInput(
  leagueId: string,
  seasonYear: number,
  deps: { db?: Db; now?: Date } = {},
): Promise<SeasonRecapInput | null> {
  const db = deps.db ?? defaultPrisma
  const season = await db.redraftSeason.findUnique({
    where: { leagueId_season: { leagueId, season: seasonYear } },
    include: {
      rosters: true,
      schedule: true,
      playoffBracket: { select: { structure: true } },
      playoffRounds: { include: { matchups: true } },
      playoffSeeds: { select: { rosterId: true } },
    },
  })
  if (!season) return null

  const nameOf = (r: { teamName: string | null; ownerName: string }) => r.teamName?.trim() || r.ownerName
  const teams = season.rosters.map((r) => ({
    rosterId: r.id,
    name: nameOf(r),
    ownerId: r.ownerId ?? null,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsFor: r.pointsFor,
    pointsAgainst: r.pointsAgainst,
    playoffSeed: r.playoffSeed ?? null,
  }))

  const regularGames = season.schedule
    .filter((m) => m.awayRosterId && !m.isMedianMatchup && m.week < season.playoffStartWeek && ['final', 'completed', 'complete'].includes(String(m.status).toLowerCase()))
    .map((m) => ({ week: m.week, homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId!, homeScore: m.homeScore, awayScore: m.awayScore }))

  // ── Champion and finish order ──────────────────────────────────────────────
  const structure = record(season.playoffBracket?.structure)
  let championRosterId = typeof structure.championRosterId === 'string' ? structure.championRosterId : null
  let runnerUpRosterId = typeof structure.runnerUpRosterId === 'string' ? structure.runnerUpRosterId : null
  const finishOrder = Array.isArray(structure.finalStandings)
    ? structure.finalStandings
        .map(record)
        .filter((r) => typeof r.rosterId === 'string' && typeof r.finish === 'number')
        .sort((a, b) => (a.finish as number) - (b.finish as number))
        .map((r) => r.rosterId as string)
    : null
  const archive = await db.leagueSeason.findUnique({ where: { leagueId_season: { leagueId, season: seasonYear } }, select: { teamRecords: true } })
  if (!championRosterId && Array.isArray(archive?.teamRecords)) {
    const rows = (archive!.teamRecords as unknown[]).map(record)
    championRosterId = (rows.find((r) => r.isChampion === true)?.rosterId as string | undefined) ?? null
    runnerUpRosterId = runnerUpRosterId ?? ((rows.find((r) => r.isRunnerUp === true)?.rosterId as string | undefined) ?? null)
  }

  // ── Lower bracket ─────────────────────────────────────────────────────────
  const lowerMode = structure.lowerBracket === 'toilet_bowl' ? 'toilet_bowl' : structure.lowerBracket === 'none' ? null : 'consolation'
  const final = lowerMode
    ? lowerBracketFinal(
        season.playoffRounds.map((r) => ({ roundNumber: r.roundNumber, matchups: r.matchups })),
        CONSOLATION_ROUND_OFFSET,
      )
    : null
  const lowerBracketFinalResult = final && lowerMode ? { mode: lowerMode as 'consolation' | 'toilet_bowl', winnerRosterId: final.winner, loserRosterId: final.loser } : null

  // ── Trades ────────────────────────────────────────────────────────────────
  let trades: RecapTrade[] | null = []
  let unvaluedTradeCount = 0
  try {
    const proposals = await db.redraftTradeProposal.findMany({
      where: { seasonId: season.id, status: { in: ['accepted', 'processed'] }, processedAt: { not: null } },
      select: { id: true, processedAt: true, valueSnapshot: { select: { payload: true } } },
    })
    for (const p of proposals) {
      const sides = p.valueSnapshot ? redraftTradeSides(p.valueSnapshot.payload) : null
      if (!sides) unvaluedTradeCount += 1
      else trades.push({ tradeId: p.id, executedAt: p.processedAt?.toISOString() ?? null, sides })
    }

    // AF league engine trades processed during this season, mapped onto this season's rosters by owner.
    const next = await db.redraftSeason.findFirst({ where: { leagueId, season: { gt: seasonYear } }, orderBy: { season: 'asc' }, select: { createdAt: true } })
    const af = await db.afLeagueTrade.findMany({
      where: { leagueId, status: 'processed', processedAt: { gte: season.createdAt, ...(next ? { lt: next.createdAt } : {}) } },
      select: { id: true, processedAt: true },
    })
    if (af.length > 0) {
      const [snapshots, genericRosters] = await Promise.all([
        db.tradeDecisionSnapshot.findMany({ where: { tradeId: { in: af.map((t) => t.id) } } }),
        db.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
      ])
      const redraftByOwner = new Map(season.rosters.map((r) => [r.ownerId, r.id]))
      const toRedraft = new Map(genericRosters.map((r) => [r.id, redraftByOwner.get(r.platformUserId) ?? null]))
      const byTrade = new Map(snapshots.map((s) => [s.tradeId, s]))
      for (const t of af) {
        const snap = byTrade.get(t.id)
        const parts = snap ? publicTradeDecisionReceipt(snap as never).participantDecisions : []
        const sides = parts
          .filter((p) => p.valueGiven != null && p.valueReceived != null && toRedraft.get(p.rosterId))
          .map((p) => ({ rosterId: toRedraft.get(p.rosterId)!, valueIn: p.valueReceived!, valueOut: p.valueGiven! }))
        if (sides.length < 2) unvaluedTradeCount += 1
        else trades.push({ tradeId: t.id, executedAt: t.processedAt?.toISOString() ?? null, sides })
      }
    }
  } catch {
    trades = null
  }

  // ── Pickups ───────────────────────────────────────────────────────────────
  let pickups: RecapPickup[] | null = null
  try {
    const rosterIds = season.rosters.map((r) => r.id)
    const added = await db.redraftRosterPlayer.findMany({
      where: { rosterId: { in: rosterIds }, acquisitionType: { in: PICKUP_ACQUISITIONS } },
      select: { rosterId: true, playerId: true, playerName: true, position: true, addedAt: true, droppedAt: true },
    })
    const lastWeek = season.totalWeeks
    const placed = added
      .map((a) => {
        const pickupWeek = recapWeekAt(season.sport, season.season, a.addedAt)
        const dropWeek = a.droppedAt ? recapWeekAt(season.sport, season.season, a.droppedAt) : null
        return pickupWeek == null ? null : { ...a, pickupWeek, untilWeek: Math.min(lastWeek, dropWeek ?? lastWeek) }
      })
      .filter((a): a is NonNullable<typeof a> => a != null && a.untilWeek > a.pickupWeek)
    if (added.length === 0) {
      pickups = []
    } else if (placed.length > 0) {
      const sportKeys = [...new Set([season.sport, season.sport.toUpperCase(), season.sport.toLowerCase()])]
      const scores = await db.playerWeeklyScore.findMany({
        where: { playerId: { in: [...new Set(placed.map((p) => p.playerId))] }, season: season.season, sport: { in: sportKeys } },
        select: { playerId: true, week: true, fantasyPts: true },
      })
      const byPlayer = new Map<string, { week: number; pts: number }[]>()
      for (const s of scores) {
        const list = byPlayer.get(s.playerId) ?? []
        list.push({ week: s.week, pts: s.fantasyPts })
        byPlayer.set(s.playerId, list)
      }
      // Counted from the week AFTER the pickup: a mid-week add may have missed that week's games.
      pickups = placed.map((p) => {
        const weeks = (byPlayer.get(p.playerId) ?? []).filter((w) => w.week > p.pickupWeek && w.week <= p.untilWeek)
        return {
          rosterId: p.rosterId,
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position ?? null,
          pickupWeek: p.pickupWeek,
          pointsAfter: weeks.reduce((s, w) => s + w.pts, 0),
          weeksCounted: weeks.length,
        }
      })
      if (pickups.every((p) => p.weeksCounted === 0)) pickups = null
    }
  } catch {
    pickups = null
  }

  // ── Prior season ──────────────────────────────────────────────────────────
  const prior = await db.leagueSeason
    .findUnique({ where: { leagueId_season: { leagueId, season: seasonYear - 1 } }, select: { teamRecords: true } })
    .catch(() => null)
  let priorSeasonByOwnerId: SeasonRecapInput['priorSeasonByOwnerId'] = null
  if (Array.isArray(prior?.teamRecords)) {
    priorSeasonByOwnerId = {}
    for (const r of (prior!.teamRecords as unknown[]).map(record)) {
      const owner = typeof r.ownerId === 'string' ? r.ownerId : typeof r.managerUserId === 'string' ? r.managerUserId : null
      if (owner) priorSeasonByOwnerId[owner] = { wins: num(r.wins), losses: num(r.losses), ties: num(r.ties) }
    }
  }

  return {
    leagueId,
    season: seasonYear,
    sport: season.sport,
    playoffStartWeek: season.playoffStartWeek,
    teams,
    regularGames,
    championRosterId,
    runnerUpRosterId,
    finishOrder,
    playoffRosterIds: season.playoffSeeds.length > 0 ? season.playoffSeeds.map((s) => s.rosterId) : null,
    lowerBracketFinal: lowerBracketFinalResult,
    trades,
    unvaluedTradeCount,
    pickups,
    priorSeasonByOwnerId,
    computedAt: (deps.now ?? new Date()).toISOString(),
  }
}
