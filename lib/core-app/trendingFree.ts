import 'server-only'

import { scanFreeAgentLeagues, type FollowingFreeAgentLeague, type FollowingLeague } from './followingCard'

/**
 * "Most added this week" → "and he's free in 9 of YOUR leagues — add him" (Guap, 2026-10-08, #6).
 *
 * The trending list says who the rest of the world is grabbing; this says where YOU can still grab
 * him. Same rule as every other "free agent" claim on the Finder (followingCard.scanFreeAgentLeagues):
 * only a league of yours whose every roster could be read, so a partial import never calls someone
 * free.
 *
 * Bounded: rosters for at most MAX_LEAGUES of your leagues, read SCAN_CHUNK at a time (the scan's own
 * cap). Any failure returns what it has — a missing chip, never a wrong one.
 */
export const MAX_LEAGUES = 48
const SCAN_CHUNK = 12

export type TrendingFreeIn = Record<string, FollowingFreeAgentLeague[]>

export async function loadTrendingFreeIn(
  userId: string,
  leagues: readonly FollowingLeague[],
  sleeperIds: readonly string[],
): Promise<TrendingFreeIn> {
  const out: TrendingFreeIn = {}
  const ids = [...new Set(sleeperIds.filter(Boolean))]
  const nfl = leagues.filter((l) => String(l.sport ?? 'NFL').toUpperCase() === 'NFL').slice(0, MAX_LEAGUES)
  if (ids.length === 0 || nfl.length === 0) return out
  const chunks: FollowingLeague[][] = []
  for (let i = 0; i < nfl.length; i += SCAN_CHUNK) chunks.push(nfl.slice(i, i + SCAN_CHUNK))
  const parts = await Promise.all(chunks.map((c) => scanFreeAgentLeagues(userId, c, ids).catch(() => null)))
  for (const part of parts) {
    if (!part) continue
    for (const [id, list] of part.free) out[id] = [...(out[id] ?? []), ...list]
  }
  return out
}
