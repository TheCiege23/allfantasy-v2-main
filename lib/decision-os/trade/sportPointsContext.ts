import 'server-only'

import { prisma } from '@/lib/prisma'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { allowedPositionsForSlot } from '@/lib/redraft/lineupValidation'
import { normalizeSeasonType } from '@/lib/scores/gameScoreProviders'
import { rosteredIdsOf } from './ncaafRedraftContext'
import {
  boardReadinessReason,
  categoryLeagueReason,
  indexBoard,
  multiSeasonFormatReason,
  replacementFromLineups,
  replacementFromRosters,
  sampleGamesFromReasons,
  type BoardPlayer,
  type LineupSlot,
  type PointsGradedSport,
  type SportPointsContext,
} from './sportPointsValue'

/**
 * What a daily-sport points grade is priced from, read once per league — or once per request with no
 * league (the open analyzer). See `./sportPointsValue.ts` for the rules.
 *
 * DB-first: `AFProjectionSnapshot` (keyed on `PlayerIdentityMap.id` for these sports — 100% of NBA, NHL,
 * NCAAB and MLB rows join, measured 2026-10-09), `PlayerIdentityMap`, rosters and the `SportsGame`
 * schedule. No provider call.
 */

export type SportPointsLeague = {
  id: string
  settings: unknown
  leagueType: string | null
  leagueSize: number | null
}

export type SportPointsBaseResult = { ok: true; ctx: SportPointsContext } | { ok: false; reason: string }

const DEFAULT_TEAMS = 12

/**
 * Below this share of a league's rostered ids mapping onto the board, the rosters cannot say who is a
 * free agent — an unmapped rostered star would read as available and raise the replacement level for his
 * whole position — so the waiver wire is estimated from standard lineups instead.
 */
const MIN_ROSTER_MAPPING = 0.5

function readRates(adjustmentFactors: unknown): Record<string, unknown> | null {
  if (!adjustmentFactors || typeof adjustmentFactors !== 'object' || Array.isArray(adjustmentFactors)) return null
  const f = adjustmentFactors as Record<string, unknown>
  const rates = f.perGameRates ?? f.componentRates ?? null
  return rates && typeof rates === 'object' && !Array.isArray(rates) ? (rates as Record<string, unknown>) : null
}

function reasonsOf(adjustmentFactors: unknown): unknown {
  return adjustmentFactors && typeof adjustmentFactors === 'object' ? (adjustmentFactors as Record<string, unknown>).confidenceReasons : null
}

function sourceSeasonOf(adjustmentFactors: unknown): number | null {
  const raw = adjustmentFactors && typeof adjustmentFactors === 'object' ? (adjustmentFactors as Record<string, unknown>).sourceSeason : null
  const n = Number(raw)
  return raw != null && Number.isFinite(n) ? n : null
}

/** The earlier season most of the board still projects from, or null when it projects from this one. */
function baselineSeasonOf(board: readonly BoardPlayer[], season: number): number | null {
  const counts = new Map<number, number>()
  for (const p of board) if (p.sourceSeason != null && p.sourceSeason < season) counts.set(p.sourceSeason, (counts.get(p.sourceSeason) ?? 0) + 1)
  const [top] = [...counts].sort((a, b) => b[1] - a[1])
  return top && top[1] / board.length > 0.5 ? top[0] : null
}

/** "2026-27" for a season keyed 2026 — these seasons span two calendar years. */
export function seasonLabelFor(season: number): string {
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`
}

/**
 * Regular-season games each team still has, averaged across teams. Null when the schedule has no row for
 * the season at all (unknown, not over); 0 when it has rows and none are still to be played.
 */
async function gamesRemaining(sport: PointsGradedSport, season: number, now: Date): Promise<number | null> {
  const [anyRow, upcoming] = await Promise.all([
    prisma.sportsGame.findFirst({ where: { sport: { equals: sport, mode: 'insensitive' }, season }, select: { id: true } }).catch(() => null),
    prisma.sportsGame
      .findMany({
        where: { sport: { equals: sport, mode: 'insensitive' }, season, startTime: { gte: now } },
        select: { homeTeam: true, awayTeam: true, seasonType: true },
      })
      .catch(() => [] as Array<{ homeTeam: string; awayTeam: string; seasonType: string | null }>),
  ])
  if (!anyRow) return null
  const perTeam = new Map<string, number>()
  for (const g of upcoming) {
    /*
     * ⚠ EVERY UPCOMING NBA, NHL AND NCAAB GAME HAS A NULL `seasonType` (production, 2026-10-09), so a
     * "regular season only" filter counted zero games for every sport. Only games the schedule marks as
     * pre- or postseason are left out; the few unlabelled preseason games add a game or two per team at
     * most, and one multiplier on every player cannot move the letter.
     */
    const type = normalizeSeasonType(g.seasonType)
    if (type === 'pre' || type === 'post') continue
    for (const t of [g.homeTeam, g.awayTeam]) perTeam.set(t, (perTeam.get(t) ?? 0) + 1)
  }
  if (perTeam.size === 0) return 0
  const total = [...perTeam.values()].reduce((a, b) => a + b, 0)
  return Math.round(total / perTeam.size)
}

/** The lineup the waiver wire is estimated from: the league's slots, or the sport's defaults. */
export function lineupSlotsFor(sport: PointsGradedSport, settings: unknown): { slots: LineupSlot[]; benchPerTeam: number } {
  const config = resolveRedraftRosterConfig(sport, settings)
  const slots: LineupSlot[] = [...config.starterCapacities].map(([token, count]) => ({
    slot: token,
    eligible: allowedPositionsForSlot(sport, token),
    count,
  }))
  return { slots, benchPerTeam: config.benchSlots }
}

export async function loadSportPointsBase(args: {
  sport: PointsGradedSport
  league: SportPointsLeague | null
  now?: Date
}): Promise<SportPointsBaseResult> {
  const { sport, league } = args
  const now = args.now ?? new Date()

  if (league) {
    const format = multiSeasonFormatReason(league.leagueType, sport)
    if (format) return { ok: false, reason: format }
    const category = categoryLeagueReason(league.settings, sport)
    if (category) return { ok: false, reason: category }
  }

  const scorer = buildLeagueStatScorer({ sport, settings: league?.settings ?? null })
  const normalize = getDailySportNormalizer(sport)
  if (!scorer || !normalize) return { ok: false, reason: `No ${sport} scoring is configured, so this deal cannot be graded.` }

  const latest = await prisma.aFProjectionSnapshot
    .findFirst({
      where: { sport: { equals: sport, mode: 'insensitive' }, week: null },
      orderBy: { season: 'desc' },
      select: { season: true },
    })
    .catch(() => null)
  if (!latest) return { ok: false, reason: `No ${sport} projections are on file, so this deal cannot be graded yet.` }
  const season = latest.season

  const [rows, games] = await Promise.all([
    prisma.aFProjectionSnapshot
      .findMany({
        where: { sport: { equals: sport, mode: 'insensitive' }, season, week: null },
        select: { playerId: true, playerName: true, position: true, adjustmentFactors: true },
      })
      .catch(() => null),
    gamesRemaining(sport, season, now),
  ])
  if (!rows) return { ok: false, reason: `The ${sport} projections could not be read just now.` }
  if (games == null) return { ok: false, reason: `The ${seasonLabelFor(season)} ${sport} schedule is not on file, so the games left to play cannot be counted.` }

  const identities = await prisma.playerIdentityMap
    .findMany({
      where: { id: { in: rows.map((r) => r.playerId) } },
      select: { id: true, rollingInsightsId: true, sleeperId: true },
    })
    .catch(() => [] as Array<{ id: string; rollingInsightsId: string | null; sleeperId: string | null }>)
  const aliasesById = new Map(identities.map((i) => [i.id, [i.rollingInsightsId, i.sleeperId].filter((v): v is string => Boolean(v))]))

  const board: BoardPlayer[] = []
  for (const r of rows) {
    const rates = readRates(r.adjustmentFactors)
    if (!rates) continue
    const { stats } = normalize(rates)
    if (Object.keys(stats).length === 0) continue
    // Derived from ONE game's line by the normalizer; on a season average they would fire every night.
    delete stats.dbl_dbl
    delete stats.trpl_dbl
    const perGame = scorer(stats, r.position)
    if (!Number.isFinite(perGame)) continue
    board.push({
      id: r.playerId,
      name: r.playerName,
      position: String(r.position ?? '').trim().toUpperCase(),
      perGame,
      sampleGames: sampleGamesFromReasons(reasonsOf(r.adjustmentFactors)),
      aliases: aliasesById.get(r.playerId) ?? [],
      sourceSeason: sourceSeasonOf(r.adjustmentFactors),
    })
  }
  const notReady = boardReadinessReason({ sport, board, season, seasonLabel: seasonLabelFor(season) })
  if (notReady) return { ok: false, reason: notReady }
  const baseline = baselineSeasonOf(board, season)

  const teams = league?.leagueSize && league.leagueSize > 1 ? league.leagueSize : DEFAULT_TEAMS
  const lineup = lineupSlotsFor(sport, league?.settings ?? null)

  let replacementByPosition = replacementFromLineups(board, { teams, slots: lineup.slots, benchPerTeam: lineup.benchPerTeam })
  if (league) {
    const rosterRows = await prisma.roster.findMany({ where: { leagueId: league.id }, select: { playerData: true } }).catch(() => null)
    const rostered = rosterRows ? [...new Set(rosterRows.flatMap((r) => rosteredIdsOf(r.playerData)))] : []
    if (rostered.length > 0) {
      const index = indexBoard(board)
      const onBoard = new Set<string>()
      let mapped = 0
      for (const id of rostered) {
        const bare = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
        const hit = index.get(id) ?? index.get(bare)
        if (hit) {
          onBoard.add(hit.id)
          mapped += 1
        }
      }
      if (mapped / rostered.length >= MIN_ROSTER_MAPPING) replacementByPosition = replacementFromRosters(board, onBoard)
    }
  }

  return {
    ok: true,
    ctx: {
      sport,
      board,
      replacementByPosition,
      window: {
        season,
        seasonLabel: seasonLabelFor(season),
        gamesRemaining: games,
        baselineSeasonLabel: baseline != null ? seasonLabelFor(baseline) : null,
      },
      scoringBasis: league ? 'league' : 'default',
      teams,
    },
  }
}
