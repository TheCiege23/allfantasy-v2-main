import 'server-only'
import { prisma } from '@/lib/prisma'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { classifyRiSeasonType } from '@/lib/sports-data/riSeasonType'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { normalizeNflTeam } from '@/lib/redraft/lineupLock'
import { dailyTeamCode, readDailyTeamNames } from '@/lib/redraft/dailyTeamIdentity'
import type { SGProviderSport } from './providerCatalog'

export type SGScheduledGame = { externalId: string; homeTeam: string; awayTeam: string; startTime: Date; week: number }
/** A published future slate has no weekly stats yet; an unknown or started slate must still be fetched. */
export function sgNflWeekAwaitingKickoff(games: readonly (SGScheduledGame & { status: string })[], now: Date): boolean {
  return games.length > 0 && games.every(game => game.status === 'scheduled' && game.startTime.getTime() > now.getTime())
}
export function sgScheduleRows(sport: SGProviderSport, season: number, raw: unknown[], teamIds: ReadonlyMap<string, string>, normalizeTeam: (name: string) => string) {
  const knownTeams = new Set([...teamIds.values()].map(normalizeTeam))
  const games: Array<SGScheduledGame & { status: string }> = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') throw Error('Malformed provider schedule row')
    const row = value as Record<string, unknown>
    // Measured NFL schedule label: Hall of Fame exhibition, before the regular slate.
    if (sport === 'NFL' && row.season_type === 'HOF') continue
    const kind = classifyRiSeasonType(row.season_type)
    if (!kind) throw Error('Provider schedule has an unknown season type')
    if (kind !== 'regular') continue
    if (Number(String(row.season ?? '').slice(0, 4)) !== season) throw Error('Provider schedule returned another season')
    const externalId = String(row.game_ID ?? row.game_id ?? ''), startTime = new Date(String(row.game_time ?? ''))
    const homeTeam = normalizeTeam(teamIds.get(String(row.home_team_ID)) ?? String(row.home_team ?? ''))
    const awayTeam = normalizeTeam(teamIds.get(String(row.away_team_ID)) ?? String(row.away_team ?? ''))
    const week = sport === 'NFL' ? Number(row.week) : 0
    if (!externalId || !Number.isFinite(startTime.getTime()) || !/^[A-Z0-9]{2,8}$/.test(homeTeam) || !/^[A-Z0-9]{2,8}$/.test(awayTeam) ||
      !knownTeams.has(homeTeam) || !knownTeams.has(awayTeam) || homeTeam === awayTeam || !Number.isInteger(week) || (sport === 'NFL' && (week < 1 || week > 18))) throw Error('Provider schedule has an unresolved game or team')
    const status = normalizeGameStatus(String(row.status ?? ''))
    games.push({ externalId, homeTeam, awayTeam, startTime, week, status })
  }
  if (!games.length || new Set(games.map(game => game.externalId)).size !== games.length) throw Error('Provider regular-season schedule is empty or duplicated')
  return games
}

/** Regular games alone enter GameSchedule: preseason week 1 cannot close Week 1 powers. */
export async function syncSGProviderSchedule(sport: SGProviderSport, season: number, now = new Date()) {
  const result = await riFetchRows('schedule_season', { sport, season, timeoutMs: 25_000 })
  if (result.error || result.notModified || result.unsupported) throw Error('Provider season schedule is unavailable')
  const teams = await prisma.sportsTeam.findMany({ where: { sport, source: 'rolling_insights' }, select: { externalId: true, shortName: true } })
  const teamIds = new Map(teams.flatMap(team => team.shortName ? [[team.externalId, team.shortName] as const] : []))
  const names = sport === 'NBA' ? await readDailyTeamNames(prisma, sport) : undefined
  const normalize = (team: string) => sport === 'NFL' ? normalizeNflTeam(team) : dailyTeamCode(sport, team, names)
  const rows = sgScheduleRows(sport, season, result.rows, teamIds, normalize), source = 'rolling_insights'
  const [oldGames, oldLocks] = await Promise.all([
    prisma.sportsGame.findMany({ where: { sport, season, source }, select: { externalId: true, homeTeam: true, awayTeam: true, startTime: true, status: true, week: true, seasonType: true } }),
    prisma.gameSchedule.findMany({ where: { sportType: sport, season }, select: { id: true, externalId: true, homeTeam: true, awayTeam: true, startTime: true, status: true, weekOrRound: true } }),
  ])
  const existing = new Map(oldGames.map(row => [row.externalId, row])), locks = new Map(oldLocks.map(row => [row.externalId, row]))
  const expiresAt = new Date(now.getTime() + 3600_000)
  await prisma.sportsGame.createMany({ data: rows.filter(row => !existing.has(row.externalId)).map(row => ({ ...row, sport, season, source, seasonType: 'regular', fetchedAt: now, expiresAt })), skipDuplicates: true })
  await prisma.gameSchedule.createMany({ data: rows.filter(row => !locks.has(row.externalId)).map(({ week, ...row }) => ({ ...row, sportType: sport, season, weekOrRound: week })), skipDuplicates: true })
  for (const row of rows) {
    const previous = existing.get(row.externalId), lock = locks.get(row.externalId)
    const same = (old: { homeTeam: string | null; awayTeam: string | null; startTime: Date | null; status: string | null }) => old.homeTeam === row.homeTeam && old.awayTeam === row.awayTeam && old.startTime?.getTime() === row.startTime.getTime() && old.status === row.status
    if (previous && (!same(previous) || previous.week !== row.week || previous.seasonType !== 'regular')) await prisma.sportsGame.update({
      where: { sport_externalId_source: { sport, externalId: row.externalId, source } }, data: { ...row, seasonType: 'regular', fetchedAt: now, expiresAt } })
    if (lock && (!same(lock) || lock.weekOrRound !== row.week)) await prisma.gameSchedule.update({ where: { id: lock.id }, data: {
      homeTeam: row.homeTeam, awayTeam: row.awayTeam, startTime: row.startTime, status: row.status, weekOrRound: row.week } })
  }
  await prisma.sportsGame.updateMany({ where: { sport, season, source, externalId: { in: rows.map(row => row.externalId) } }, data: { fetchedAt: now, expiresAt } })
  return { games: rows.length, rows }
}
