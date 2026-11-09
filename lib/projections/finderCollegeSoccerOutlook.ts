import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { readScoringType } from '@/lib/category-scoring/leagueScoringType'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { resolveLeagueScoringRules } from '@/lib/redraft/leagueScoringRules'
import { buildWeekKickoffMap, lockTeamLookupKeys, normalizeLockTeam } from '@/lib/redraft/lineupLock'
import { dailySportWeekForInstant, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'
import { normalizeCfbdBoxStats } from '@/lib/scoring-runtime/cfbdBoxStatNormalization'
import { normalizeNcaabGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import type { OutlookPlayerInput } from './dailySportOutlook'

type CollegeSoccerPlayer = OutlookPlayerInput & { position?: string | null }
type PeriodOutlook = { projectedPoints: number | null; periodGames: number; perGame: number; recentGames: number }
export type FinderPeriodOutlook = {
  byKey: Map<string, PeriodOutlook>
  period: { kind: 'week' | 'fixture'; season: number; week: number; day: null } | null
  reason?: string
}

const ELIGIBLE = new Set(['NCAAF', 'NCAAB', 'SOCCER'])
const SOCCER_COMPETITIONS = new Set(['EPL', 'LALIGA', 'SERIEA'])
const MIN_GAMES = 3

function competitionOf(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const row = settings as Record<string, unknown>
  const config = row.sportConfig && typeof row.sportConfig === 'object' && !Array.isArray(row.sportConfig)
    ? row.sportConfig as Record<string, unknown> : {}
  const value = String(config.soccerCompetition ?? row.soccerCompetition ?? '').trim().toUpperCase()
  return SOCCER_COMPETITIONS.has(value) ? value : null
}

function soccerStatsOf(value: unknown, position: string | null | undefined): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const box = (value as Record<string, unknown>).stats
  if (!box || typeof box !== 'object' || Array.isArray(box)) return null
  const raw = box as Record<string, unknown>
  const stats: Record<string, number> = {}
  const put = (target: string, source: string) => {
    const count = raw[source]
    if (typeof count === 'number' && Number.isFinite(count)) stats[target] = count
  }
  put('goals', 'goals')
  put('assists', 'assists')
  put('yellow_card', 'yellow_cards')
  put('red_card', 'red_cards')
  put('saves', 'saves')
  put('pen_save', 'penalties_saved')
  const slot = String(position ?? '').toUpperCase()
  if (slot === 'GK' || slot === 'G') put('clean_sheet_gk', 'clean_sheets')
  if (slot === 'DEF' || slot === 'D') put('clean_sheet_def', 'clean_sheets')
  return Object.keys(stats).length ? stats : null
}

/** DB-only period outlook. Missing identity, slate, competition, or usable form stays unavailable. */
export async function loadFinderCollegeSoccerOutlook(
  db: PrismaClient,
  args: { league: { sport: string | null; season: number | null; settings: unknown }; players: readonly CollegeSoccerPlayer[]; now?: Date },
): Promise<FinderPeriodOutlook> {
  const sport = String(args.league.sport ?? '').toUpperCase()
  const empty = (reason: string): FinderPeriodOutlook => ({ byKey: new Map(), period: null, reason })
  if (!ELIGIBLE.has(sport)) return empty('unsupported_sport')
  if (readScoringType(args.league.settings).mode !== 'points') return empty('category_league')
  const scorer = buildLeagueStatScorer({ sport, settings: args.league.settings })
  const rules = resolveLeagueScoringRules({ sport, settings: args.league.settings })
  if (!scorer || !rules) return empty('no_scoring_rules')
  const scoredKeys = new Set(rules.categories.filter((category) =>
    (rules.overrides[category.key] ?? category.defaultPoints) !== 0 ||
    (rules.fantraxSoccer?.keeper[category.key] ?? 0) !== 0)
    .flatMap((category) => [category.key, ...(category.tierStatKey ? [category.tierStatKey] : [])]))
  const season = args.league.season
  if (!season || !Number.isInteger(season)) return empty('no_season')
  const now = args.now ?? new Date()
  let week: number | null
  if (sport === 'NCAAF') {
    const next = await db.sportsGame.findFirst({
      where: { sport, source: 'cfbd', season, week: { gt: 0 }, startTime: { gte: now } },
      orderBy: { startTime: 'asc' }, select: { week: true },
    })
    week = next?.week ?? null
  } else {
    week = dailySportWeekForInstant(sport, season, now)
  }
  if (week == null) return empty('no_period')

  const fixturesByTeam = new Map<string, Set<string>>()
  if (sport === 'NCAAF') {
    const slate = await buildWeekKickoffMap(db, { sport, season, week })
    for (const [key, kickoff] of slate.byTeam) {
      if (kickoff >= now) fixturesByTeam.set(key, new Set([`${season}:${week}`]))
    }
  } else {
    const window = resolveDailySportWeekWindow(sport, season, week)
    if (!window) return empty('no_verified_window')
    const games = await readRiScheduleWindow(db as never, { sport, season, window })
    if (!games) return empty('schedule_not_synced')
    const competition = sport === 'SOCCER' ? competitionOf(args.league.settings) : null
    if (sport === 'SOCCER' && !competition) return empty('competition_not_verified')
    if (sport === 'SOCCER' && games.some((game) => !game.competition)) return empty('schedule_missing_competition')
    for (const game of games) {
      if (sport === 'SOCCER' && game.competition !== competition) continue
      if (game.seasonType && game.seasonType !== 'regular') continue
      if (game.replacedBy || /^(replaced|postponed|cancelled|canceled|final|completed)$/i.test(game.status ?? '')) continue
      const start = game.startTime ? new Date(game.startTime) : null
      if (!start || !Number.isFinite(start.getTime()) || start < now) continue
      for (const team of sport === 'SOCCER'
        ? [game.homeTeamId, game.awayTeamId] : [game.homeTeam, game.awayTeam]) {
        const teamKey = normalizeLockTeam(sport, team)
        if (!teamKey) continue
        const set = fixturesByTeam.get(teamKey) ?? new Set<string>()
        set.add(game.gameId)
        fixturesByTeam.set(teamKey, set)
      }
    }
  }
  if (fixturesByTeam.size === 0) return empty('no_verified_fixtures')

  const ids = [...new Set(args.players.map((player) => player.lookupId).filter((id): id is string => Boolean(id)))]
  if (!ids.length) return empty('no_verified_identities')
  const identityRows = await db.playerIdentityMap.findMany({
    where: { sport, id: { in: ids } }, select: { id: true, cfbdId: true },
  })
  const cfbdByIdentity = new Map(identityRows.map((row) => [row.id, row.cfbdId]))
  // cfbdId is indexed but not unique. Twelve duplicate CFBD IDs existed in production at audit
  // time; an athlete's game log must never be credited to both identity rows.
  const cfbdIds = [...new Set(identityRows.flatMap((row) => row.cfbdId ? [row.cfbdId] : []))]
  const cfbdOwners = sport === 'NCAAF' && cfbdIds.length ? await db.playerIdentityMap.findMany({
    where: { sport, cfbdId: { in: cfbdIds } }, select: { id: true, cfbdId: true },
  }) : []
  const cfbdOwnerCounts = new Map<string, number>()
  for (const row of cfbdOwners) if (row.cfbdId) cfbdOwnerCounts.set(row.cfbdId, (cfbdOwnerCounts.get(row.cfbdId) ?? 0) + 1)
  const logIdByLookup = new Map<string, string>()
  for (const id of ids) {
    const logId = sport === 'NCAAF' ? cfbdByIdentity.get(id) : identityRows.some((row) => row.id === id) ? id : null
    if (logId && (sport !== 'NCAAF' || cfbdOwnerCounts.get(logId) === 1)) logIdByLookup.set(id, logId)
  }
  const logIds = [...new Set(logIdByLookup.values())]
  if (!logIds.length) return empty('no_game_log_bridge')
  const lines = await db.playerGameStat.findMany({
    where: { sportType: sport, season, playerId: { in: logIds },
      ...(sport === 'NCAAF' ? { source: 'cfbd-weekly' } : { source: 'rolling_insights_live' }),
      gameDate: { lte: now } },
    orderBy: { gameDate: 'desc' }, take: 5000,
    select: { playerId: true, gameId: true, normalizedStatMap: true, gameDate: true },
  })
  const linesByPlayer = new Map<string, typeof lines>()
  for (const line of lines) linesByPlayer.set(line.playerId, [...(linesByPlayer.get(line.playerId) ?? []), line])

  const byKey = new Map<string, PeriodOutlook>()
  const lineStats = (value: unknown, position: string | null | undefined) => sport === 'NCAAF'
    ? normalizeCfbdBoxStats(value)
    : sport === 'NCAAB' ? normalizeNcaabGameStats(value).stats : soccerStatsOf(value, position)
  for (const player of args.players) {
    const logId = player.lookupId ? logIdByLookup.get(player.lookupId) : null
    if (!logId) continue
    const keys = lockTeamLookupKeys(sport, player.team)
    const fixtures = keys.map((k) => fixturesByTeam.get(k)).find((set) => set && set.size > 0)
    if (!fixtures?.size) continue
    const recent = (linesByPlayer.get(logId) ?? []).filter((line) => {
      const stats = lineStats(line.normalizedStatMap, player.position)
      return stats && Object.keys(stats).some((key) => scoredKeys.has(key))
    }).slice(0, 8)
    if (recent.length < MIN_GAMES) continue
    const points = recent.map((line) => scorer(lineStats(line.normalizedStatMap, player.position)!, player.position))
    if (points.some((value) => !Number.isFinite(value))) continue
    const perGame = points.reduce((sum, value) => sum + value, 0) / points.length
    byKey.set(player.key, { projectedPoints: Math.round(perGame * fixtures.size * 100) / 100,
      periodGames: fixtures.size, perGame: Math.round(perGame * 100) / 100, recentGames: recent.length })
  }
  return { byKey, period: { kind: sport === 'SOCCER' ? 'fixture' : 'week', season, week, day: null },
    reason: byKey.size ? undefined : 'no_eligible_form' }
}
