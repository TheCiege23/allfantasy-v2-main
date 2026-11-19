import 'server-only'

import { prisma } from '@/lib/prisma'
import { dailyTeamCode } from '@/lib/core-app/dailyNextGames'
import { proTeamCode } from '@/lib/player-identity/proFantraxIdentityPlan'
import { resolveDailySportSeasonStart, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { normalizeTeamToken, resolveCollegeTeam } from '@/lib/sport-teams/collegeTeamIdentity'
import { loadCollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIndexStore'

const DAILY_SPORTS = new Set(['NBA', 'NHL', 'MLB', 'NCAAB', 'SOCCER'])
const SEASON_LENGTH: Readonly<Record<string, number>> = {
  NFL: 17,
  NBA: 82,
  NHL: 82,
  MLB: 162,
  SOCCER: 38,
}

export function standardLeagueSeasonGames(sport: string): number | null {
  return SEASON_LENGTH[sport] ?? null
}

export interface TeamProjectionSchedule {
  weekGames: number | null
  seasonGames: number | null
  remainingGames: number | null
}

export function projectionTeamKey(sport: string, team: string | null): string | null {
  if (!team?.trim()) return null
  if (sport === 'NFL') return normalizeTeamAbbrev(team)
  if (sport === 'NBA' || sport === 'NHL' || sport === 'MLB') return dailyTeamCode(sport, team)
  if (sport === 'SOCCER') return proTeamCode('SOCCER', team) ?? normalizeTeamToken(team)
  return normalizeTeamToken(team) || null
}

type Fixture = {
  startTime: Date | null
  week: number | null
  homeTeam: string
  awayTeam: string
  status: string | null
  seasonType: string | null
  source: string
}

export function buildProjectionSchedule(args: {
  sport: string
  season: number
  week: number | null
  now: Date
  fixtures: readonly Fixture[]
  teamKey?: (team: string) => string | null
}): Map<string, TeamProjectionSchedule> {
  const { sport, season, week, now } = args
  const daily = DAILY_SPORTS.has(sport)
  const opener = daily ? resolveDailySportSeasonStart(sport, season) : null
  const openerDate = opener ? new Date(opener) : null
  const window = daily && week != null ? resolveDailySportWeekWindow(sport, season, week) : null
  const teamKey = args.teamKey ?? ((team) => projectionTeamKey(sport, team))
  const bySource = new Map<string, Map<string, {
    home: string
    away: string
    start: Date
    inWeek: boolean
  }>>()

  for (const game of args.fixtures) {
    const start = game.startTime
    if (!start) continue
    const phase = game.seasonType?.toLowerCase().trim()
    const regular = phase === 'regular' || phase === 'regular_season'
    const day = daily ? easternCalendarDay(start) : null
    if (openerDate && (!day || day < openerDate)) continue
    if (!regular && (!daily || Boolean(phase) || !opener)) continue
    const status = normalizeGameStatus(game.status)
    if (status === 'cancelled' || status === 'postponed') continue
    const home = teamKey(game.homeTeam)
    const away = teamKey(game.awayTeam)
    if (!home || !away || home === away) continue
    const inWeek = week != null && (daily
      ? Boolean(window && day && day >= window.start && day < window.end)
      : game.week === week)
    const games = bySource.get(game.source) ?? new Map()
    const occurrence = daily || game.week == null ? start.toISOString() : String(game.week)
    games.set(`${home}|${away}|${occurrence}`, { home, away, start, inWeek })
    bySource.set(game.source, games)
  }

  // Feed rows overlap. Use one source for the season and one for the period,
  // with coverage taking precedence over source name for deterministic ties.
  const ordered = [...bySource.entries()].sort(([a, x], [b, y]) => y.size - x.size || a.localeCompare(b))
  const seasonGames = [...(ordered[0]?.[1].values() ?? [])]
  const weeklyCandidates = ordered.map(([, games]) => [...games.values()].filter((game) => game.inWeek))
  const weekGames = weeklyCandidates.reduce<typeof seasonGames>(
    (largest, games) => games.length > largest.length ? games : largest,
    [],
  )
  const counts = new Map<string, { season: number; remaining: number; week: number }>()
  for (const game of seasonGames) {
    for (const team of [game.home, game.away]) {
      const count = counts.get(team) ?? { season: 0, remaining: 0, week: 0 }
      count.season++
      if (game.start >= now) count.remaining++
      counts.set(team, count)
    }
  }
  for (const game of weekGames) {
    for (const team of [game.home, game.away]) {
      const count = counts.get(team) ?? { season: 0, remaining: 0, week: 0 }
      count.week++
      counts.set(team, count)
    }
  }

  const result = new Map<string, TeamProjectionSchedule>()
  for (const [team, count] of counts) {
    // For college schedules the available figure is a scheduled-games estimate.
    // For fixed-length sports, withhold a season total when coverage is short.
    const seasonCoverage = count.season >= (SEASON_LENGTH[sport] ?? 1)
    result.set(team, {
      weekGames: count.week > 0 ? count.week : weekGames.length > 0 && seasonCoverage && sport === 'NFL' ? 0 : null,
      seasonGames: seasonCoverage ? count.season : null,
      remainingGames: seasonCoverage ? count.remaining : null,
    })
  }
  return result
}

export async function loadProjectionSchedule(args: {
  sport: string
  season: number
  week: number | null
  now: Date
}): Promise<Map<string, TeamProjectionSchedule>> {
  const { sport, season, now } = args
  const daily = DAILY_SPORTS.has(sport)
  const [fixtures, teamRows, college] = await Promise.all([
    prisma.sportsGame.findMany({
      where: { sport, season, startTime: { not: null } },
      select: {
        startTime: true, week: true, homeTeam: true, awayTeam: true,
        status: true, seasonType: true, source: true,
      },
    }),
    sport === 'NCAAF' || sport === 'NCAAB' || sport === 'SOCCER'
      ? prisma.sportsTeam.findMany({ where: { sport }, select: { name: true, shortName: true } })
      : Promise.resolve([]),
    sport === 'NCAAF' ? loadCollegeTeamIndex(now.getTime()).catch(() => null) : Promise.resolve(null),
    daily ? ensureDailySportSeasonStart(sport, season, { db: prisma, now }) : Promise.resolve(null),
  ] as const)
  const aliases = new Map<string, string | null>()
  for (const row of teamRows) {
    const code = projectionTeamKey(sport, row.shortName)
    const name = projectionTeamKey(sport, row.name)
    if (!code || !name) continue
    for (const alias of [code, name]) {
      aliases.set(alias, aliases.has(alias) && aliases.get(alias) !== code ? null : code)
    }
  }
  const teamKey = (team: string) => {
    const key = projectionTeamKey(sport, team)
    const school = college ? resolveCollegeTeam(team, college) : null
    if (school) return `college:${school.id}`
    return key == null ? null : aliases.has(key) ? aliases.get(key)! : key
  }
  const schedule = buildProjectionSchedule({ ...args, fixtures, teamKey })
  // Resolve the projection's team label and the schedule's team label through
  // the same unambiguous alias. The map also keeps the canonical keys.
  for (const [alias, key] of aliases) {
    const canonical = teamKey(alias)
    if (key && canonical && schedule.has(canonical)) schedule.set(alias, schedule.get(canonical)!)
    else if (key === null) schedule.delete(alias)
  }
  if (college) {
    for (const [alias, school] of college.byAlias) {
      const scheduled = schedule.get(`college:${school.id}`)
      if (scheduled) schedule.set(alias, scheduled)
    }
  }
  return schedule
}
