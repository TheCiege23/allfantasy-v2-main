import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLeagueScoringRules } from '@/lib/multi-sport/ScoringTemplateResolver'
import { normalizeStatPayload } from '@/lib/schedule-stats/StatNormalizationService'
import { computeFantasyPoints } from '@/lib/scoring-defaults/FantasyPointCalculator'
import type { ScoringRuleLike } from '@/lib/scoring-defaults/FantasyPointCalculator'

export type CappedGame = { rosterId: string; playerId: string; gameId: string; gameDate: Date; points: number }

/** Live NBA game logs carry nested numeric stats and may leave fantasyPoints at its schema default. */
export function scoreNbaGame(value: unknown, rules: ScoringRuleLike[]): number {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const source = row.stats && typeof row.stats === 'object' && !Array.isArray(row.stats)
    ? row.stats as Record<string, unknown> : row
  const numbers = Object.fromEntries(Object.entries(source).filter((pair): pair is [string, number] =>
    typeof pair[1] === 'number' && Number.isFinite(pair[1])))
  return computeFantasyPoints(normalizeStatPayload('NBA', numbers), rules)
}

/** First N eligible player-games count, including zero-point games. The cap is never best-N. */
export function calculateCappedGameScores(rosterIds: string[], games: CappedGame[], cap: number): Map<string, number> {
  if (!Number.isInteger(cap) || cap < 1) throw new Error('A positive player-game cap is required.')
  const allowed = new Set(rosterIds)
  const totals = new Map(rosterIds.map(id => [id, 0]))
  const counts = new Map(rosterIds.map(id => [id, 0]))
  const seen = new Set<string>()
  const sorted = [...games].sort((a, b) => a.gameDate.getTime() - b.gameDate.getTime() ||
    a.gameId.localeCompare(b.gameId) || a.playerId.localeCompare(b.playerId))
  for (const game of sorted) {
    if (!allowed.has(game.rosterId) || !Number.isFinite(game.points) || !Number.isFinite(game.gameDate.getTime())) throw new Error('Invalid capped-game score input.')
    const key = `${game.rosterId}\0${game.playerId}\0${game.gameId}`
    if (seen.has(key)) throw new Error('Duplicate player-game score.')
    seen.add(key)
    const used = counts.get(game.rosterId)!
    if (used >= cap) continue
    counts.set(game.rosterId, used + 1)
    totals.set(game.rosterId, totals.get(game.rosterId)! + game.points)
  }
  return totals
}

/** Uses saved starters, never the current roster after a chop or a waiver acquisition. */
export async function loadCappedGameScores(args: { leagueId: string; season: number; period: number;
  rosterIds: string[]; cap: number; startsAt: string; endsAt: string }): Promise<Map<string, number>> {
  const start = new Date(args.startsAt)
  const end = new Date(args.endsAt)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw new Error('NBA capped scoring requires a valid league scoring-period date range.')
  }
  const assignments = await prisma.afRosterLineupAssignment.findMany({ where: {
    leagueId: args.leagueId, season: args.season, week: args.period,
    rosterId: { in: args.rosterIds },
  }, select: { rosterId: true, playerId: true, section: true } })
  const easternDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  const daily = await prisma.survivorGuillotineDailyLineup.findMany({ where: { leagueId: args.leagueId,
    period: args.period, rosterId: { in: args.rosterIds }, gameDay: {
      gte: new Date(`${easternDay(start)}T00:00:00.000Z`),
      lte: new Date(`${easternDay(new Date(end.getTime() - 1))}T00:00:00.000Z`),
    } },
    orderBy: { gameDay: 'asc' }, select: { rosterId: true, gameDay: true, playerIds: true } })
  const players = [...new Set([...assignments.map(a => a.playerId), ...daily.flatMap(row =>
    Array.isArray(row.playerIds) ? row.playerIds.filter((id): id is string => typeof id === 'string') : [])])]
  if (args.rosterIds.some(id => !assignments.some(a => a.rosterId === id && a.section === 'starters') &&
      !daily.some(row => row.rosterId === id))) throw new Error('Every active roster needs an initial or daily starter lineup for capped-game scoring.')
  const stats = await prisma.playerGameStat.findMany({ where: { sportType: 'NBA', season: args.season,
    gameDate: { gte: start, lt: end }, playerId: { in: players } },
    select: { playerId: true, gameId: true, gameDate: true, normalizedStatMap: true } })
  if (!stats.length || stats.some(s => !s.gameDate)) throw new Error('Finalized NBA per-game stats with game dates are required for capped scoring.')
  const rules = await getLeagueScoringRules(args.leagueId, 'NBA', 'points')
  const starters = new Map(args.rosterIds.map(id => [id, new Set(assignments.filter(a => a.rosterId === id && a.section === 'starters').map(a => a.playerId))]))
  const dated = new Map(args.rosterIds.map(id => [id, daily.filter(row => row.rosterId === id).map(row => ({
    day: row.gameDay.getTime(), players: new Set(Array.isArray(row.playerIds) ? row.playerIds.filter((p): p is string => typeof p === 'string') : []),
  }))]))
  const games = stats.flatMap(stat => args.rosterIds.filter(rosterId => {
    const snapshot = dated.get(rosterId)!.filter(row => row.day <= stat.gameDate!.getTime()).at(-1)
    return (snapshot?.players ?? starters.get(rosterId)!).has(stat.playerId)
  }).map(rosterId => ({ rosterId, playerId: stat.playerId, gameId: stat.gameId,
    gameDate: stat.gameDate!, points: scoreNbaGame(stat.normalizedStatMap, rules) })))
  return calculateCappedGameScores(args.rosterIds, games, args.cap)
}
