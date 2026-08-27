import type { PrismaClient } from '@prisma/client'

import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'

/**
 * A projection from what a player has actually been doing, for the players no feed covers.
 *
 * ⚠ THIS EXISTS BECAUSE THE VENDOR FEED IS ONE WEEK DEEP. `FantasyProjection` holds ~1,000 rows,
 * all season 2026 week 1, one scoring preset — so on a standard league only 141 of 449 startable
 * free agents had a projection at all, and the waiver board could not rank the other 308. They
 * are not obscure players; they simply are not in that snapshot.
 *
 * ⚠ AND IT IS NOT THE SAME KIND OF NUMBER, WHICH IS WHY IT NEVER OVERRIDES ONE. A vendor
 * projection is forward-looking — it knows about a coming bye, a return from injury, a changed
 * depth chart. This is backward-looking: a recency-weighted mean of what he has scored under THIS
 * league's rules. It is the honest answer to "what has he been worth", not to "what will he be
 * worth", so it fills gaps and defers wherever a real projection exists, and the caller is told
 * which basis it got.
 */

export interface FormProjection {
  points: number
  /** How many scoreable games it is built from — the reader's confidence signal. */
  games: number
}

/**
 * Below this, one big game defines the player.
 *
 * Two is deliberately low: on a waiver wire the interesting players are the ones who just started
 * playing, and a four-game minimum would exclude precisely the breakout the board exists to find.
 * The game count travels with the number so a two-game estimate can be weighed as one.
 */
export const MIN_FORM_GAMES = 2

/** Games back to consider. Beyond this the player is a different player. */
const WINDOW = 6

/**
 * Weight halves every `HALF_LIFE` games back.
 *
 * Recency matters more than sample size on a waiver wire — the reason a player is available is
 * usually that he was not producing until recently.
 */
const HALF_LIFE = 3

export async function projectFromRecentForm(args: {
  prisma: Pick<PrismaClient, 'playerGameStat'>
  sport?: string
  season: number
  playerIds: readonly string[]
  scoring: Record<string, unknown> | null | undefined
  minGames?: number
}): Promise<Map<string, FormProjection>> {
  const out = new Map<string, FormProjection>()
  const ids = [...new Set(args.playerIds.filter((x) => typeof x === 'string' && x.length > 0))]
  if (ids.length === 0 || !args.scoring || typeof args.scoring !== 'object') return out

  const rows = await args.prisma.playerGameStat
    .findMany({
      where: { sportType: args.sport ?? 'NFL', season: args.season, playerId: { in: ids } },
      select: { playerId: true, weekOrRound: true, normalizedStatMap: true },
      orderBy: [{ weekOrRound: 'desc' }],
    })
    .catch(() => [] as Array<{ playerId: string; weekOrRound: number; normalizedStatMap: unknown }>)

  /*
   * ⚠ THE WINDOW COUNTS SCOREABLE GAMES, NOT ROWS, AND CAPPING ROWS FIRST SILENTLY LOST PLAYERS.
   * Most players carry stat rows this league prices at nothing — a snaps-only line, a
   * special-teams appearance. Taking the six most recent ROWS and scoring afterwards let those
   * consume the window, so a player with plenty of real games could arrive with fewer than the
   * minimum and be dropped. Measured on a live league: 199 startable free agents have two or more
   * scoreable games and this returned 144 of them.
   *
   * A game the league prices at nothing is skipped rather than counted as a zero — that is the
   * league declining to score a line, not the player producing nothing.
   */
  const minGames = args.minGames ?? MIN_FORM_GAMES
  const scoredByPlayer = new Map<string, number[]>()

  for (const r of rows) {
    const taken = scoredByPlayer.get(r.playerId) ?? []
    if (taken.length >= WINDOW) continue
    const scored = computeLeagueProjectedPoints(
      r.normalizedStatMap as Record<string, unknown>,
      args.scoring,
    )
    if (!scored) continue
    taken.push(scored.points)
    scoredByPlayer.set(r.playerId, taken)
  }

  for (const [playerId, points] of scoredByPlayer) {
    if (points.length < minGames) continue
    let weighted = 0
    let weight = 0
    points.forEach((value, index) => {
      // index 0 is the most recent scoreable game, so weight decays as index grows.
      const w = Math.pow(0.5, index / HALF_LIFE)
      weighted += value * w
      weight += w
    })
    if (weight <= 0) continue
    out.set(playerId, { points: Math.round((weighted / weight) * 100) / 100, games: points.length })
  }

  return out
}
