import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { FINAL_SHOWN_H, LIVE_WINDOW_H, reconcileGame, type LeaguePoints, type LiveGameBadge } from './liveGameBadge'

/**
 * Loader for the finder's live game badge (liveGameBadge.ts has the rules).
 *
 * DB-first: `SportsGame` rows for his club whose kickoff is inside the live/final window (every feed's
 * row — they are reconciled, not trusted one by one), and `LeaguePlayerWeeklyScore` — his points as
 * each league's own platform scored them, refreshed every two minutes during games by the live tick
 * (lib/live/liveSleeperPointsSync.ts). Sleeper leagues only today; a league with no row says nothing,
 * never 0.
 */

const H = 3_600_000

/** January and February games belong to last year's season — the rule in liveSleeperPointsSync's `nflSeasonFor`. */
function seasonOf(d: Date): number {
  const y = d.getUTCFullYear()
  return d.getUTCMonth() <= 1 ? y - 1 : y
}

export async function loadLiveGameBadge(args: {
  sport: string
  team: string | null
  sleeperId: string | null
  /** Leagues where he is on YOUR roster. */
  leagues: ReadonlyArray<{ leagueId: string; leagueName: string }>
  now?: Date
}): Promise<LiveGameBadge | null> {
  if (args.sport !== 'NFL') return null
  const club = normalizeTeamAbbrev(args.team)
  if (!club) return null
  const now = args.now ?? new Date()

  const rows = await prisma.sportsGame
    .findMany({
      where: {
        sport: { equals: 'NFL', mode: 'insensitive' },
        startTime: { gte: new Date(now.getTime() - (LIVE_WINDOW_H + FINAL_SHOWN_H) * H), lte: now },
      },
      select: { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, status: true, startTime: true, seasonType: true, week: true, updatedAt: true },
    })
    .catch(() => [])
  const game = reconcileGame({ club, rows, now, fold: (t) => normalizeTeamAbbrev(t) })
  if (!game) return null

  let leagues: LeaguePoints[] = []
  if (args.sleeperId && args.leagues.length > 0) {
    const names = new Map(args.leagues.map((l) => [l.leagueId, l.leagueName]))
    const scores = await prisma.leaguePlayerWeeklyScore
      .findMany({
        where: { leagueId: { in: [...names.keys()] }, playerId: args.sleeperId, seasonYear: seasonOf(new Date(game.kickoff)), week: game.week },
        select: { leagueId: true, points: true, isStarter: true, updatedAt: true, isFinalized: true },
      })
      .catch(() => [])
    leagues = scores
      .filter((s) => Number.isFinite(s.points))
      .map((s) => ({
        leagueId: s.leagueId,
        leagueName: names.get(s.leagueId) ?? 'League',
        points: s.points,
        isStarter: s.isStarter,
        updatedAt: new Date(s.updatedAt).toISOString(),
        finalized: s.isFinalized,
      }))
      .sort((a, b) => Number(b.isStarter) - Number(a.isStarter) || a.leagueName.localeCompare(b.leagueName))
  }
  return { game, leagues }
}
