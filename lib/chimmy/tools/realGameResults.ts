import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeStatsSport } from '@/lib/chimmy/tools/realStatsTools'
import { dedupeFixtures } from '@/lib/sports/dedupeFixtures'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { sanitizeUntrusted } from '@/lib/chimmy/sanitizeUntrusted'

const DAY_MS = 86_400_000
const DAY = /^\d{4}-\d{2}-\d{2}$/

export async function buildRealGameResults(args: Record<string, unknown>, now = new Date()): Promise<string> {
  const sport = typeof args.sport === 'string' && args.sport.trim() ? normalizeStatsSport(args.sport) : null
  if (!sport) return 'Specify NFL, NCAAF, NBA, NCAAB, NHL, MLB or SOCCER before looking up game results.'

  const team = typeof args.team === 'string' ? args.team.trim().slice(0, 100) : ''
  const season = args.season
  if (season !== undefined && (typeof season !== 'number' || !Number.isInteger(season) || season < 1800 || season > 2200)) {
    return 'The season must be a four-digit start year.'
  }
  let start: Date | undefined
  let end: Date | undefined
  if (args.date !== undefined) {
    if (typeof args.date !== 'string' || !DAY.test(args.date)) return 'Provide a date as YYYY-MM-DD.'
    start = new Date(args.date + 'T00:00:00Z')
    if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== args.date) return 'That calendar date is invalid.'
    end = new Date(start.getTime() + DAY_MS)
  } else if (season === undefined) {
    start = new Date(now.getTime() - DAY_MS)
    end = new Date(now.getTime() + DAY_MS)
  } else if (!team) {
    return 'For a full-season historical lookup, specify a team. For a single slate, specify a date.'
  }

  const rows = await prisma.sportsGame.findMany({
    where: {
      sport: { equals: sport, mode: 'insensitive' },
      ...(typeof season === 'number' ? { season } : {}),
      startTime: { not: null, gte: start, lt: end },
      ...(team ? { OR: [
        { homeTeam: { contains: team, mode: 'insensitive' } },
        { awayTeam: { contains: team, mode: 'insensitive' } },
      ] } : {}),
    },
    orderBy: [{ startTime: 'desc' }, { fetchedAt: 'desc' }, { id: 'asc' }],
    take: 120,
    select: { homeTeam: true, awayTeam: true, startTime: true, status: true, homeScore: true, awayScore: true, fetchedAt: true, source: true },
  })
  if (!rows.length) return 'No stored games matched. Coverage varies by sport and season. Confirm the team name, sport, season or date before concluding that no game took place.'

  return [
    sport + ' stored real games. Times are UTC. This is a limited result set; provider duplicates may remain if names or times differ. Do not use it to infer a full season record.',
    ...dedupeFixtures(rows).slice(0, 15).map((row) => {
      const status = normalizeGameStatus(row.status)
      const score = (status === 'live' || status === 'final') && row.homeScore !== null && row.awayScore !== null
        ? 'away ' + row.awayScore + ', home ' + row.homeScore
        : 'score unverified'
      const stale = status === 'live' && now.getTime() - row.fetchedAt.getTime() > 5 * 60_000
      return JSON.stringify({
        away: sanitizeUntrusted(row.awayTeam), home: sanitizeUntrusted(row.homeTeam),
        starts: row.startTime?.toISOString(), status: stale ? 'last reported live; current status unverified' : status,
        score, source: sanitizeUntrusted(row.source), asOf: row.fetchedAt.toISOString(),
      })
    }),
  ].join('\n')
}
