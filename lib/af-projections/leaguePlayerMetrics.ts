import 'server-only'

import { prisma } from '@/lib/prisma'
import { isSupportedSport } from '@/lib/sport-scope'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { resolveSportWeek } from '@/lib/season-week/seasonWeekService'
import { boardPlayerValue, boardUnit, loadLeagueValueBoard, type LeagueValueBoard } from '@/lib/sport-values/leagueValueBoard'
import { categoryLeagueReason, isPointsGradedSport } from '@/lib/decision-os/trade/sportPointsValue'
import { leagueIdColumn, leagueIdOf, loadIdentityForKeys } from '@/lib/waivers/seasonRatePool'
import { loadNcaafRedraftBase, ncaafTradeScoringRules } from '@/lib/decision-os/trade/ncaafRedraftContext'
import { loadAfTradeMarketRows } from '@/lib/trade-market/afTradeMarketReads'
import { valueBookFor } from '@/lib/core-app/valueBook'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import {
  loadProjectionSchedule, projectionTeamKey, standardLeagueSeasonGames, type TeamProjectionSchedule,
} from './leagueProjectionSchedule'

type LeaguePlayerMetricRate = {
  playerId: string
  playerName: string
  position: string
  perGame: number
}

export type LeaguePlayerMetric = LeaguePlayerMetricRate & {
  rank: number
  positionRank: number
  weekGames: number | null
  weekly: number | null
  fullSeason: number | null
  fullSeasonBasis: 'stored_schedule' | 'standard_season' | null
  restOfSeason: number | null
  tradeValue: number | null
  tradeValueUnit: 'market points' | 'fantasy points over replacement' | 'category score over replacement' | null
  dynastyTradeValue: number | null
}

export type LeaguePlayerMetrics = {
  leagueId: string
  sport: string
  season: number
  week: number | null
  unit: 'fantasy points' | 'category score'
  rows: LeaguePlayerMetric[]
}

function projectedTotal(rate: number, games: number | null | undefined): number | null {
  return games == null ? null : Math.round(rate * games * 100) / 100
}

export function rankLeaguePlayerRates(rates: readonly LeaguePlayerMetricRate[]): Array<LeaguePlayerMetricRate & {
  rank: number
  positionRank: number
}> {
  const ordered = [...rates].sort((a, b) =>
    b.perGame - a.perGame || a.playerName.localeCompare(b.playerName) || a.playerId.localeCompare(b.playerId),
  )
  const positions = new Map<string, number>()
  return ordered.map((row, index) => {
    const positionRank = (positions.get(row.position) ?? 0) + 1
    positions.set(row.position, positionRank)
    return { ...row, rank: index + 1, positionRank }
  })
}

export function totalsForLeaguePlayer(rate: number, schedule?: TeamProjectionSchedule) {
  return {
    weekGames: schedule?.weekGames ?? null,
    weekly: projectedTotal(rate, schedule?.weekGames),
    fullSeason: projectedTotal(rate, schedule?.seasonGames),
    restOfSeason: projectedTotal(rate, schedule?.remainingGames),
  }
}

function field(value: unknown, key: string): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const entry = (value as Record<string, unknown>)[key]
  return entry != null && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : null
}

async function loadCollegeBasketballRates(season: number, settings: unknown): Promise<LeaguePlayerMetricRate[]> {
  const sport = 'NCAAB'
  if (categoryLeagueReason(settings, sport)) return []
  const normalize = getDailySportNormalizer(sport)
  const score = buildLeagueStatScorer({ sport, settings })
  if (!normalize || !score) return []
  const rows = await prisma.aFProjectionSnapshot.findMany({
    where: { sport, season, week: null, eventId: null },
    select: { playerId: true, playerName: true, position: true, adjustmentFactors: true },
  })
  return rows.flatMap((row) => {
    // College players change schools and leave the sport between seasons.
    // Only current-season evidence qualifies for this early-season fallback.
    const factors = row.adjustmentFactors
    if (!factors || typeof factors !== 'object' || Array.isArray(factors) || factors.sourceSeason !== season) return []
    const rates = field(row.adjustmentFactors, 'perGameRates')
    if (!rates) return []
    const { stats } = normalize(rates)
    if (Object.keys(stats).length === 0) return []
    delete stats.dbl_dbl
    delete stats.trpl_dbl
    const perGame = score(stats, row.position)
    return Number.isFinite(perGame)
      ? [{ playerId: row.playerId, playerName: row.playerName, position: row.position, perGame }]
      : []
  })
}

async function loadFootballRates(league: {
  sport: string
  season: number
  platform: string | null
  settings: unknown
}): Promise<LeaguePlayerMetricRate[]> {
  const { sport, season } = league
  const scoring = sport === 'NCAAF' ? ncaafTradeScoringRules(league) : extractScoringSettings(league.settings)
  if (!scoring) return []
  const rows = await prisma.aFProjectionSnapshot.findMany({
    where: { sport, season, week: null, eventId: null },
    select: { playerId: true, playerName: true, position: true, adjustmentFactors: true },
  })
  return rows.flatMap((row) => {
    const rates = field(row.adjustmentFactors, 'perGameRates')
    if (!rates) return []
    const scored = computeLeagueProjectedPoints(rates, scoring)
    if (!scored || !Number.isFinite(scored.points)) return []
    return [{ playerId: row.playerId, playerName: row.playerName, position: row.position, perGame: scored.points }]
  })
}

async function loadRecordedTeams(sport: string, season: number, playerIds: string[]): Promise<Map<string, string>> {
  if (sport === 'SOCCER') {
    const rows = await prisma.playerGameStat.findMany({
      where: { sportType: sport, season, playerId: { in: playerIds }, team: { not: null }, gameDate: { not: null } },
      orderBy: [{ gameDate: 'desc' }, { id: 'asc' }],
      distinct: ['playerId'],
      select: { playerId: true, team: true },
    })
    return new Map(rows.flatMap((row): Array<[string, string]> => row.team ? [[row.playerId, row.team]] : []))
  }
  const rows = await prisma.fantasyStatLine.findMany({
    where: { sport, season: String(season), week: 0, playerId: { in: playerIds }, team: { not: null } },
    select: { playerId: true, team: true },
  })
  const candidates = new Map<string, string | null>()
  for (const { playerId, team } of rows) {
    if (!team) continue
    const prior = candidates.get(playerId)
    candidates.set(playerId, candidates.has(playerId) && prior !== team ? null : team)
  }
  return new Map([...candidates].flatMap(([id, team]): Array<[string, string]> => team ? [[id, team]] : []))
}

/**
 * League-scored AF player board. Callers must already have authorized access
 * to the league. The sport and season are always read from that league.
 */
export async function loadLeaguePlayerMetrics(args: {
  leagueId: string
  week?: number | null
  position?: string | null
  playerName?: string | null
  playerIds?: readonly string[]
  limit?: number
  now?: Date
  valueBoard?: Promise<LeagueValueBoard>
  includeTradeValues?: boolean
}): Promise<LeaguePlayerMetrics | null> {
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { id: true, sport: true, season: true, settings: true, platform: true, leagueType: true },
  })
  if (!league || !isSupportedSport(league.sport) || !league.season) return null
  const { id: leagueId, sport, season } = league
  const now = args.now ?? new Date()
  const [board, footballRates, resolution] = await Promise.all([
    isPointsGradedSport(sport) ? args.valueBoard ?? loadLeagueValueBoard(leagueId) : Promise.resolve(null),
    sport === 'NFL' || sport === 'NCAAF'
      ? loadFootballRates({ ...league, season })
      : Promise.resolve([]),
    args.week == null ? resolveSportWeek(sport, season, { now }).catch(() => null) : Promise.resolve(null),
  ])
  const activeBoard = board?.kind === 'ok' && board.ctx.window.season === season ? board : null
  const inferredWeek = resolution?.ok && resolution.seasonType === 'regular'
    ? (resolution.state === 'played' ? resolution.nextSportWeek : resolution.sportWeek)
    : null
  const week = args.week ?? inferredWeek
  const unit = activeBoard ? boardUnit(activeBoard.ctx) : 'fantasy points'
  const rates = activeBoard
    ? activeBoard.ctx.board.flatMap((player) => Number.isFinite(player.perGame) ? [{
      playerId: player.id, playerName: player.name, position: player.position, perGame: player.perGame,
    }] : [])
    : sport === 'NCAAB' ? await loadCollegeBasketballRates(season, league.settings) : footballRates
  const wantedIds = args.playerIds ? new Set(args.playerIds) : null
  const wantedName = args.playerName ? normalizePlayerName(args.playerName) : null
  const wantedPosition = args.position?.trim().toUpperCase()
  const selected = rankLeaguePlayerRates(rates).filter((row) =>
    (!wantedIds || wantedIds.has(row.playerId)) &&
    (wantedName == null || normalizePlayerName(row.playerName) === wantedName) &&
    (!wantedPosition || wantedPosition === 'ALL' || row.position === wantedPosition),
  ).slice(0, Math.max(1, Math.min(200, args.limit ?? 100)))
  if (!selected.length) return { leagueId, sport, season, week, unit, rows: [] }

  const playerIds = selected.map((row) => row.playerId)
  const [identity, schedule, recordedTeams] = await Promise.all([
    loadIdentityForKeys(prisma, sport, playerIds),
    loadProjectionSchedule({ sport, season, week, now }).catch(() => new Map<string, TeamProjectionSchedule>()),
    loadRecordedTeams(sport, season, playerIds).catch(() => new Map<string, string>()),
  ])
  const [nflValues, collegeBase] = await Promise.all([
    args.includeTradeValues !== false && sport === 'NFL'
      ? loadAfTradeMarketRows(
        prisma,
        selected.flatMap((row) => leagueIdOf(identity.get(row.playerId), 'sleeperId') ?? []),
        valueBookFor(league.settings, league.leagueType),
        now,
      )
      : Promise.resolve(null),
    args.includeTradeValues !== false && sport === 'NCAAF' && league.leagueType?.toLowerCase() === 'redraft'
      ? loadNcaafRedraftBase(league).catch(() => null)
      : Promise.resolve(null),
  ])
  const college = collegeBase?.ok && collegeBase.base.window.season === season ? collegeBase.base : null
  const replacements = college
    ? await college.replacementFor([...new Set(selected.map((row) => row.position))])
    : null
  const idColumn = leagueIdColumn(league.platform)
  const rows = selected.map((row) => {
    const linked = identity.get(row.playerId)
    const knownTeam = projectionTeamKey(sport, linked?.team ?? null)
    const statTeam = projectionTeamKey(sport, recordedTeams.get(row.playerId) ?? null)
    const team = knownTeam && schedule.has(knownTeam) ? knownTeam : statTeam ?? knownTeam
    const value = args.includeTradeValues !== false && activeBoard
      ? boardPlayerValue(activeBoard, { playerId: row.playerId })
      : null
    const nflId = nflValues ? leagueIdOf(linked, 'sleeperId') : null
    const nflValue = nflId ? nflValues?.get(nflId)?.marketValue : null
    const collegeId = college && idColumn ? leagueIdOf(linked, idColumn) : null
    const collegeLine = collegeId ? college?.perGameByRosterId.get(collegeId) : null
    const collegeReplacement = replacements?.get(collegeLine?.position ?? row.position)
    const collegeValue = college && college.window.weeks > 0 && collegeLine && collegeReplacement
      ? Math.max(0, collegeLine.perGame - collegeReplacement.perGame) * college.window.weeks
      : null
    const tradeValue = value?.available ? value.data.value : nflValue ?? collegeValue
    const tradeValueUnit: LeaguePlayerMetric['tradeValueUnit'] = tradeValue == null
      ? null
      : nflValue != null ? 'market points' : unit === 'category score' ? 'category score over replacement' : 'fantasy points over replacement'
    const totals = totalsForLeaguePlayer(row.perGame, team ? schedule.get(team) : undefined)
    const standardGames = team ? standardLeagueSeasonGames(sport) : null
    const fullSeason = totals.fullSeason ?? projectedTotal(row.perGame, standardGames)
    const fullSeasonBasis: LeaguePlayerMetric['fullSeasonBasis'] = totals.fullSeason != null
      ? 'stored_schedule'
      : fullSeason != null ? 'standard_season' : null
    return {
      ...row,
      ...totals,
      fullSeason,
      fullSeasonBasis,
      tradeValue,
      tradeValueUnit,
      dynastyTradeValue: value?.available ? value.data.dynastyValue : null,
    }
  })
  return { leagueId, sport, season, week, unit, rows }
}
