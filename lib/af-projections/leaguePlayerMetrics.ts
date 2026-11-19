import 'server-only'

import { loadAfNflWeek, nflComponentRates } from './nflLeagueWeek'
import { extractSeasonAggregate } from './core'
import { prisma } from '@/lib/prisma'
import { isSupportedSport } from '@/lib/sport-scope'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { resolveSportWeek } from '@/lib/season-week/seasonWeekService'
import { boardPlayerValue, boardUnit, loadLeagueValueBoard, type LeagueValueBoard } from '@/lib/sport-values/leagueValueBoard'
import { categoryLeagueReason, isPointsGradedSport } from '@/lib/decision-os/trade/sportPointsValue'
import { leagueIdColumn, leagueIdOf, loadIdentityForKeys, resolveRosterIdsToKeys } from '@/lib/waivers/seasonRatePool'
import { isDynastyLeagueType, playerDynastyValue } from '@/lib/decision-os/trade/sportDynastyValue'
import { loadNcaafClassYears, loadNcaafRedraftBase, ncaafTradeScoringRules } from '@/lib/decision-os/trade/ncaafRedraftContext'
import { loadAfTradeMarketRows } from '@/lib/trade-market/afTradeMarketReads'
import { loadLeagueTradeValues } from '@/lib/league-values/leagueTradeValues'
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
  rosterPlayerId?: string
  daily?: number | null
  positionCount?: number
  rank: number
  positionRank: number
  weekGames: number | null
  weekly: number | null
  fullSeason: number | null
  fullSeasonBasis: 'stored_schedule' | 'standard_season' | null
  restOfSeason: number | null
  completedTradeSample?: number
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
  const seasonLines = await prisma.fantasyStatLine.findMany({
    where: { sport, season: String(season), week: 0, source: 'rolling_insights' },
    select: { playerId: true, stats: true },
  })
  const active = new Set(seasonLines.filter((row) => extractSeasonAggregate(row.stats)).map((row) => row.playerId))
  return rows.flatMap((row) => {
    // College players change schools and leave the sport between seasons.
    // Only current-season evidence qualifies for this early-season fallback.
    const factors = row.adjustmentFactors
    if (!factors || typeof factors !== 'object' || Array.isArray(factors) || (factors.sourceSeason !== season && !active.has(row.playerId))) return []
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
  const previousCollege = sport === 'NCAAF' ? rows.filter((row) => {
    const f = row.adjustmentFactors
    return !f || typeof f !== 'object' || Array.isArray(f) || f.sourceSeason !== season
  }).map((row) => row.playerId) : []
  const oldKeys = new Set(previousCollege)
  const returning = new Set<string>()
  if (previousCollege.length) {
    const [played, enrolled] = await Promise.all([
      prisma.fantasyStatLine.findMany({ where: { sport, season: String(season), week: 0, playerId: { in: previousCollege },
        stats: { path: ['regular_season', 'games_played'], gt: 0 } }, select: { playerId: true } }),
      prisma.devyPlayer.findMany({ where: { sport, cfbdId: { in: previousCollege }, lastRosterYear: season, draftStatus: 'college', graduatedToNFL: false },
        select: { cfbdId: true } }),
    ])
    for (const p of played) returning.add(p.playerId)
    for (const p of enrolled) if (p.cfbdId) returning.add(p.cfbdId)
  }
  return rows.flatMap((row) => {
    if (oldKeys.has(row.playerId) && !returning.has(row.playerId)) return []
    const factors = row.adjustmentFactors
    const rates = sport === 'NFL' && factors && typeof factors === 'object' && !Array.isArray(factors)
      ? nflComponentRates(factors) : field(factors, 'perGameRates')
    if (!rates) return []
    const scored = computeLeagueProjectedPoints(rates, scoring)
    if (!scored || !Number.isFinite(scored.points)) return []
    return [{ playerId: row.playerId, playerName: row.playerName, position: row.position, perGame: scored.points }]
  })
}

async function loadRecordedTeams(sport: string, season: number, playerIds: string[]): Promise<Map<string, string>> {
  if (sport === 'SOCCER' || sport === 'NCAAB') {
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
  day?: string | null
  position?: string | null
  playerName?: string | null
  searchName?: string
  playerIds?: readonly string[]
  rosterIds?: readonly string[]
  limit?: number
  now?: Date
  valueBoard?: Promise<LeagueValueBoard>
  includeTradeValues?: boolean
}): Promise<LeaguePlayerMetrics | null> {
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { id: true, sport: true, season: true, settings: true, platform: true, platformLeagueId: true, leagueType: true },
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
  const rosterKeys = new Map<string, string>()
  if (args.rosterIds) {
    const namespace = leagueIdColumn(league.platform, sport)
    const column = sport === 'NFL' && namespace === 'rollingInsightsId' ? 'sleeperId' : namespace
    const linked = column ? await resolveRosterIdsToKeys(prisma, sport, column, args.rosterIds) : new Map<string, string>()
    for (const id of args.rosterIds) {
      const key = activeBoard?.ctx.rosterIndex?.get(id)?.id ?? linked.get(id)
      if (key) rosterKeys.set(key, id)
    }
  }
  const wantedIds = args.playerIds ? new Set(args.playerIds) : null
  const wantedName = args.playerName ? normalizePlayerName(args.playerName) : null
  const searchName = args.searchName ? normalizePlayerName(args.searchName) : null
  const wantedPosition = args.position?.trim().toUpperCase()
  const positionCounts = new Map<string, number>()
  for (const row of rates) positionCounts.set(row.position, (positionCounts.get(row.position) ?? 0) + 1)
  const selected = rankLeaguePlayerRates(rates).filter((row) =>
    (!args.rosterIds || rosterKeys.has(row.playerId)) && (!wantedIds || wantedIds.has(row.playerId)) &&
    (wantedName == null || normalizePlayerName(row.playerName) === wantedName) &&
    (!searchName || normalizePlayerName(row.playerName).includes(searchName)) &&
    (!wantedPosition || wantedPosition === 'ALL' || row.position === wantedPosition),
  ).slice(0, Math.max(1, Math.min(args.rosterIds?.length ?? args.playerIds?.length ?? 200, args.limit ?? 100)))
  if (!selected.length) return { leagueId, sport, season, week, unit, rows: [] }

  const playerIds = selected.map((row) => row.playerId)
  const [identity, schedule, recordedTeams] = await Promise.all([
    loadIdentityForKeys(prisma, sport, playerIds),
    loadProjectionSchedule({ sport, season, week, now, day: args.day }).catch(() => new Map<string, TeamProjectionSchedule>()),
    loadRecordedTeams(sport, season, playerIds).catch(() => new Map<string, string>()),
  ])
  const [nflValues, collegeBase, specialists] = await Promise.all([
    args.includeTradeValues !== false && sport === 'NFL'
      ? loadAfTradeMarketRows(
        prisma,
        selected.flatMap((row) => leagueIdOf(identity.get(row.playerId), 'sleeperId') ?? []),
        valueBookFor(league.settings, league.leagueType),
        now, true,
      )
      : Promise.resolve(null),
    args.includeTradeValues !== false && sport === 'NCAAF' && (league.leagueType?.toLowerCase() === 'redraft' || isDynastyLeagueType(league.leagueType))
      ? loadNcaafRedraftBase(league).catch(() => null)
      : Promise.resolve(null),
    args.includeTradeValues !== false && sport === 'NFL' && league.platform === 'sleeper' && league.platformLeagueId
      ? loadLeagueTradeValues({ prisma, platformLeagueId: league.platformLeagueId, isDynasty: valueBookFor(league.settings, league.leagueType).format === 'DYNASTY' }).catch(() => null)
      : Promise.resolve(null),
  ])
  const college = collegeBase?.ok && collegeBase.base.window.season === season ? collegeBase.base : null
  const replacements = college
    ? await college.replacementFor([...new Set(selected.map((row) => row.position))])
    : null
  const nflWeek = sport === 'NFL' && week != null ? await loadAfNflWeek({ season: String(season), week }) : null
  const nflScoring = sport === 'NFL' ? extractScoringSettings(league.settings) : null
  const idColumn = leagueIdColumn(league.platform, sport)
  const classYears = college && isDynastyLeagueType(league.leagueType)
    ? await loadNcaafClassYears(league.platform, college.rostered.map((p) => p.rosterPlayerId), season) : null
  const rows = selected.map((row) => {
    const linked = identity.get(row.playerId)
    const knownTeam = projectionTeamKey(sport, linked?.team ?? null)
    const statTeam = projectionTeamKey(sport, recordedTeams.get(row.playerId) ?? null)
    const team = statTeam && schedule.has(statTeam) ? statTeam : knownTeam && schedule.has(knownTeam) ? knownTeam : statTeam ?? knownTeam
    const value = args.includeTradeValues !== false && activeBoard
      ? boardPlayerValue(activeBoard, { playerId: row.playerId, ...(activeBoard.ctx.requireProviderId ? { rosterPlayerId: activeBoard.byId.get(row.playerId)?.rosterAlias } : {}) })
      : null
    const nflId = nflValues ? leagueIdOf(linked, 'sleeperId') : null
    const nflValue = nflId ? nflValues?.get(nflId)?.marketValue ?? specialists?.bySleeperId?.get(nflId)?.value : null
    const collegeId = college && idColumn ? leagueIdOf(linked, idColumn) : null
    const collegeLine = collegeId ? college?.perGameByRosterId.get(collegeId) : null
    const collegeReplacement = replacements?.get(collegeLine?.position ?? row.position)
    const collegeValue = college && college.window.weeks > 0 && collegeLine && collegeReplacement
      ? Math.max(0, collegeLine.perGame - collegeReplacement.perGame) * college.window.weeks * (1 + (collegeLine.tradeMarket?.percent ?? 0) / 100)
      : null
    const classYear = collegeId ? classYears?.get(collegeId) : null
    const collegeDynasty = college && collegeLine && collegeReplacement && classYear != null
      ? playerDynastyValue({ sport: 'NCAAF', player: { ...collegeLine, position: collegeLine.position ?? row.position },
        collegeSeasons: 5 - classYear, replacementPerGame: collegeReplacement.perGame, gamesRemaining: college.window.weeks })
      : null
    const tradeValue = value?.available ? value.data.value : nflValue ?? collegeValue
    const tradeValueUnit: LeaguePlayerMetric['tradeValueUnit'] = tradeValue == null
      ? null
      : nflValue != null ? 'market points' : unit === 'category score' ? 'category score over replacement' : 'fantasy points over replacement'
    const totals = totalsForLeaguePlayer(row.perGame, team ? schedule.get(team) : undefined)
    if (sport === 'NFL') {
      const line = nflWeek?.get(leagueIdOf(linked, 'sleeperId') ?? '')
      totals.weekGames = line?.weekGames ?? null
      totals.weekly = computeLeagueProjectedPoints(line?.componentStats, nflScoring)?.points ?? null
    }
    const standardGames = team ? standardLeagueSeasonGames(sport) : null
    const fullSeason = totals.fullSeason ?? projectedTotal(row.perGame, standardGames)
    const fullSeasonBasis: LeaguePlayerMetric['fullSeasonBasis'] = totals.fullSeason != null
      ? 'stored_schedule'
      : fullSeason != null ? 'standard_season' : null
    return {
      ...row,
      ...totals,
      positionCount: positionCounts.get(row.position),
      ...(args.day ? { daily: projectedTotal(row.perGame, team ? schedule.get(team)?.dayGames ?? null : null) } : {}),
      ...(args.rosterIds ? { rosterPlayerId: rosterKeys.get(row.playerId) } : args.searchName ? {
        rosterPlayerId: idColumn ? leagueIdOf(linked, sport === 'NFL' && idColumn === 'rollingInsightsId' ? 'sleeperId' : idColumn) ?? undefined : undefined,
      } : {}),
      fullSeason,
      fullSeasonBasis,
      tradeValue,
      tradeValueUnit,
      completedTradeSample: value?.available ? value.data.completedTradeSample : nflId ? nflValues?.get(nflId)?.sampleSize : collegeLine?.tradeMarket?.trades,
      dynastyTradeValue: value?.available ? value.data.dynastyValue : collegeDynasty,
    }
  })
  return { leagueId, sport, season, week, unit, rows }
}
