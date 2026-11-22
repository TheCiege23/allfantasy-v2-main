import { prisma } from '@/lib/prisma'
import { normalizeSeasonType } from '@/lib/scores/gameScoreProviders'

/**
 * How long after kickoff a game still counts as "in play" for the game-day stat refresh: the game
 * itself (rarely past 3h45m with overtime), then one more pass so the line read after the final
 * whistle is the finished one.
 */
export const NFL_GAME_IN_PLAY_MS = 5 * 60 * 60 * 1000

type InPlayGameRow = { season: number | null; week: number | null; startTime: Date | null; seasonType: string | null }

/**
 * The regular-season week that has a game in play at `now`, or null when none does.
 *
 * Pure. A game is in play from its kickoff until `NFL_GAME_IN_PLAY_MS` after it. When two weeks
 * overlap (they should not), the later one wins: its games are the ones still moving.
 */
export function nflWeekInPlay(games: readonly InPlayGameRow[], now: Date): { season: number; week: number } | null {
  const at = now.getTime()
  let best: { season: number; week: number } | null = null
  for (const game of games) {
    if (game.season == null || game.week == null || game.startTime == null) continue
    // Preseason week 1 and regular week 1 share a number; only regular weeks are imported.
    if (normalizeSeasonType(game.seasonType) !== 'regular') continue
    const kickoff = game.startTime.getTime()
    if (kickoff > at || at > kickoff + NFL_GAME_IN_PLAY_MS) continue
    if (!best || game.season > best.season || (game.season === best.season && game.week > best.week)) {
      best = { season: game.season, week: game.week }
    }
  }
  return best
}

/**
 * `nflWeekInPlay` over the stored schedule. Postgres only: this is the gate that decides whether the
 * game-day refresh (`/api/cron/import-player-game-stats?gameDay=1`) calls the provider at all. A
 * failed read answers null, so the refresh does nothing.
 */
export async function findNflWeekInPlay(deps: { now?: Date } = {}): Promise<{ season: number; week: number } | null> {
  const now = deps.now ?? new Date()
  try {
    const rows = await prisma.sportsGame.findMany({
      where: {
        sport: 'NFL',
        week: { not: null },
        startTime: { gte: new Date(now.getTime() - NFL_GAME_IN_PLAY_MS), lte: now },
      },
      select: { season: true, week: true, startTime: true, seasonType: true },
    })
    return nflWeekInPlay(rows, now)
  } catch {
    return null
  }
}
