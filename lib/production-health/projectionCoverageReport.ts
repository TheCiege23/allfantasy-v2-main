import 'server-only'

import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { categoryLeagueReason, isFantraxCampusProjectionLeague, isPointsGradedSport } from '@/lib/decision-os/trade/sportPointsValue'
import { rosterPlayerIds } from '@/lib/core-app/myRoster'
import { readImportedPlayerMetadata } from '@/lib/league-import/importedPlayerMetadata'
import { leagueIdColumn } from '@/lib/waivers/seasonRatePool'
import { loadLeaguePlayerMetrics } from '@/lib/af-projections/leaguePlayerMetrics'
import { loadLeagueRosterWeeks } from '@/lib/af-projections/leagueRosterWeek'
import { loadLeagueValueBoard } from '@/lib/sport-values/leagueValueBoard'
import { loadMatchupAfProjections } from '@/lib/matchup-center/afProjections'
import { buildPlayerProjectionContext } from '@/lib/chimmy/tools/playerProjectionTool'
import { redactAndCap } from '@/lib/security/redactSecrets'
import { resolveSportWeek } from '@/lib/season-week/seasonWeekService'
import { loadProjectionEvidence } from './projectionCoverageEvidence'
import { assessProjectionCoverage, parseChimmyProjection, type CoveragePlayer, type ChimmyProjection } from './projectionCoverageCore'

const LEAGUE_SELECT = {
  id: true, season: true, sport: true, platform: true, leagueType: true, settings: true,
  rosters: { select: { playerData: true } },
  redraftSeasons: { select: { season: true, rosters: { select: {
    players: { where: { droppedAt: null }, select: { playerId: true, playerName: true } },
  } } } },
} as const

const LEAGUE_CANDIDATES = 24
const MAX_PLAYERS = 400
const CHIMMY_CHECKS = 6

type Calendar = Awaited<ReturnType<typeof resolveSportWeek>>
function weekOf(calendar: Calendar | undefined) {
  return calendar?.ok && calendar.seasonType === 'regular'
    ? (calendar.state === 'played' ? calendar.nextSportWeek : calendar.sportWeek)
    : null
}

async function auditSport(sport: LeagueSport, now: Date, requestedLeagueId?: string, preferredLeagueId?: string) {
  const candidates = await prisma.league.findMany({
    where: { sport, season: { gt: 0 }, ...(requestedLeagueId ? { id: requestedLeagueId } : {}), OR: [
      { rosters: { some: {} } },
      { redraftSeasons: { some: { rosters: { some: { players: { some: { droppedAt: null } } } } } } },
    ] },
    select: LEAGUE_SELECT, orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }], take: LEAGUE_CANDIDATES,
  })
  if (preferredLeagueId && !candidates.some(league => league.id === preferredLeagueId)) {
    const preferred = await prisma.league.findFirst({ where: { id: preferredLeagueId, sport, season: { gt: 0 } }, select: LEAGUE_SELECT })
    if (preferred) candidates.unshift(preferred)
  }
  const rostered = candidates.filter(league => league.rosters.some(r => rosterPlayerIds(r.playerData).some(id => id !== '0')) ||
    league.redraftSeasons.some(s => s.season === league.season && s.rosters.some(r => r.players.length)))
  const points = rostered.filter(league => !isPointsGradedSport(sport) || !categoryLeagueReason(league.settings, sport))
  const preferredIndex = points.findIndex(league => league.id === preferredLeagueId)
  if (preferredIndex > 0) points.unshift(points.splice(preferredIndex, 1)[0]!)
  if (!points.length) return { sport, state: rostered.length ? 'category_leagues_only' : 'no_rostered_league', players: [] as CoveragePlayer[] } as const

  // Resolve each candidate season once. Prefer a current scoring week to a newer preseason league.
  const calendars = new Map<number, Calendar>()
  for (const season of [...new Set(points.map(league => league.season!))]) {
    calendars.set(season, await resolveSportWeek(sport, season, { now }))
    if (weekOf(calendars.get(season)) != null) break
  }
  const league = points.find(league => weekOf(calendars.get(league.season!)) != null) ?? points[0]!
  const season = league.season!
  const calendar = calendars.get(season)!
  const week = weekOf(calendar)
  const rosterIds = new Map<string, string | null>()
  for (const { playerData } of league.rosters) {
    for (const id of rosterPlayerIds(playerData)) {
      if (id === '0') continue
      const name = readImportedPlayerMetadata(playerData, league.platform, id)?.name ?? null
      if (!rosterIds.has(id) || (!rosterIds.get(id) && name)) rosterIds.set(id, name)
    }
  }
  for (const item of league.redraftSeasons.filter(row => row.season === season).flatMap(row => row.rosters.flatMap(r => r.players))) {
    if (!item.playerId || item.playerId === '0') continue
    if (!rosterIds.get(item.playerId)) rosterIds.set(item.playerId, item.playerName || null)
  }
  const allIds = [...rosterIds.keys()].sort()
  const ids = allIds.slice(0, MAX_PLAYERS)
  const projectionOnly = isFantraxCampusProjectionLeague(sport, league)
  const valueBoard = isPointsGradedSport(sport)
    ? loadLeagueValueBoard(league.id, {}, projectionOnly ? { projectionOnly: true } : undefined)
    : undefined
  const [os, lineupBoards, matchup, board] = await Promise.all([
    loadLeaguePlayerMetrics({ leagueId: league.id, week, now, rosterIds: ids, limit: ids.length, includeTradeValues: false, valueBoard }),
    week != null ? loadLeagueRosterWeeks([{ leagueId: league.id, season, week, ids }]) : null,
    week != null ? loadMatchupAfProjections({ leagueId: league.id, season, week, sport, platform: league.platform,
      leagueSettings: league.settings, playerIds: ids }) : null,
    valueBoard,
  ])
  if (!os || os.season !== season || (week != null && os.week !== week)) throw new Error('Shared projection board unavailable')
  if (os.unit !== 'fantasy points') return { sport, state: 'category_leagues_only', players: [] as CoveragePlayer[] } as const
  const lineup = lineupBoards?.get(league.id)
  const byRosterId = new Map(os.rows.flatMap(row => row.rosterPlayerId ? [[row.rosterPlayerId, row] as const] : []))
  const namespace = leagueIdColumn(league.platform, sport)
  const evidence = await loadProjectionEvidence({ sport, season, namespace: sport === 'NFL' && namespace === 'rollingInsightsId' ? 'sleeperId' : namespace,
    ids, knownKeys: new Map([...byRosterId].map(([id, row]) => [id, row.playerId])), now })
  const inputs = ids.map(id => ({
    id,
    name: byRosterId.get(id)?.playerName ?? evidence.get(id)?.name ?? rosterIds.get(id) ?? null,
    evidence: evidence.get(id),
    os: byRosterId.get(id),
    lineup: lineup?.get(id),
    matchup: matchup?.get(id) ?? null,
  }))

  // Sample the real name-based Chimmy tool. Prefer gaps with evidence, then include the numeric and missing controls.
  const ordered = [
    ...inputs.filter(row => row.os?.weekly == null && ((row.evidence?.games ?? 0) >= 2 || row.evidence?.hasSnapshot)).slice(0, 2),
    ...inputs.filter(row => row.os?.weekly != null).slice(0, 3),
    ...inputs.filter(row => row.os?.weekly == null),
    ...inputs,
  ]
  const sample = [...new Map(ordered.filter(row => row.name).map(row => [row.id, row])).values()].slice(0, CHIMMY_CHECKS)
  const chimmy = new Map<string, ChimmyProjection>()
  for (let start = 0; start < sample.length; start += 2) {
    await Promise.all(sample.slice(start, start + 2).map(async row => {
      const answer = await buildPlayerProjectionContext({ leagueId: league.id, playerName: row.name!, sport, week })
      chimmy.set(row.id, parseChimmyProjection(answer, week))
    }))
  }
  return {
    sport, state: week == null ? calendar.ok ? 'no_regular_week' : 'week_unresolved' : 'checked',
    leagueId: league.id, platform: league.platform, season, week, rosterSize: allIds.length,
    calendar: calendar.ok ? calendar.seasonType : calendar.reason, lineupAvailable: Boolean(lineup),
    boardNote: board?.kind === 'unavailable' ? board.reason : null,
    players: inputs.map(row => assessProjectionCoverage({ ...row, hasWeek: week != null,
      lineupAvailable: Boolean(lineup), chimmy: chimmy.get(row.id) })),
  } as const
}

export async function buildProjectionCoverageReport(options: { sport?: LeagueSport; leagueId?: string; now?: Date } = {}) {
  const now = options.now ?? new Date()
  const sports = options.sport ? [options.sport] : SUPPORTED_SPORTS
  const collegeConfig = !options.leagueId && sports.some(sport => sport === 'NCAAF' || sport === 'NCAAB')
    ? await prisma.sportsDataCache.findUnique({ where: { cacheKey: 'af:college-weekly-recheck:leagues' }, select: { data: true } })
    : null
  const preferred = collegeConfig?.data && typeof collegeConfig.data === 'object' && !Array.isArray(collegeConfig.data) ? collegeConfig.data : {}
  const results = []
  const inventory = await prisma.aFProjectionSnapshot.groupBy({
    by: ['sport', 'season'], where: { sport: { in: sports }, week: null, eventId: null },
    _count: { _all: true }, orderBy: { season: 'desc' },
  })
  for (let start = 0; start < sports.length; start += 2) {
    const batch = await Promise.allSettled(sports.slice(start, start + 2).map(sport => auditSport(sport, now, options.leagueId, typeof preferred[sport] === 'string' ? preferred[sport] : undefined)))
    for (const [offset, result] of batch.entries()) {
      results.push(result.status === 'fulfilled' ? result.value : {
        sport: sports[start + offset]!, state: 'read_failed' as const, players: [] as CoveragePlayer[],
        error: redactAndCap(result.reason instanceof Error ? result.reason.message : 'Projection read failed', 220),
      })
    }
  }
  return { generatedAt: now.toISOString(), limits: { leaguesPerSport: 1, playersPerLeague: MAX_PLAYERS, chimmyPerLeague: CHIMMY_CHECKS },
    sports: results.map(result => {
      const baseline = inventory.find(row => row.sport === result.sport)
      return { ...result, inventory: baseline ? { season: baseline.season, rows: baseline._count._all } : null }
    }),
  }
}
