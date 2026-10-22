import 'server-only'
import { prisma } from '@/lib/prisma'
import { getTeamIndex, isTeamFollowSport, listFollowerIdsForTeam } from '@/lib/follows/teamFollows'
import { resolveTeam } from '@/lib/follows/teamResolver'
import { starterImpactsByPlayerId } from '@/lib/live/bigPlayNotifier'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'
import type { GameObservation } from './gameEvents'

/**
 * The people with a stake in one game — the audience for its plays, period scores and final.
 *
 *   followers — anyone following either team (team_follows).
 *   starters  — managers with a player from this game in a starting lineup. Found by joining the
 *               box score's ESPN athlete ids to PlayerIdentityMap and on to rosters through the same
 *               starter resolver the personal big-play alerts use (lib/live/bigPlayNotifier), so a
 *               bench player never makes someone part of a game's audience.
 *
 * Best effort and fails quiet: a lookup that throws gives an empty set, never an exception that
 * stops a game's alerts. Starters cost two queries per game, so they are cached per process.
 */
const CACHE_MS = 5 * 60_000
const starterCache = new Map<string, { at: number; value: { users: Set<string>; byAthlete: Map<string, Set<string>> } }>()

export async function gameFollowerIds(sport: string, game: GameObservation): Promise<string[]> {
  if (!isTeamFollowSport(sport)) return []
  try {
    const index = await getTeamIndex(sport)
    if (!index) return []
    const ids = new Set<string>()
    for (const name of [game.homeTeamFull, game.awayTeamFull, game.homeTeam, game.awayTeam]) {
      const abbr = resolveTeam(index, name, { exactNames: true })
      if (!abbr) continue
      for (const id of (await listFollowerIdsForTeam(sport, abbr)) ?? []) ids.add(id)
    }
    return [...ids]
  } catch {
    return []
  }
}

export async function gameStarterIds(sport: string, gameId: string, detail: LiveGameDetail | null): Promise<{ users: Set<string>; byAthlete: Map<string, Set<string>> }> {
  const empty = { users: new Set<string>(), byAthlete: new Map<string, Set<string>>() }
  const espnIds = Object.keys(detail?.players ?? {})
  if (!espnIds.length) return empty
  const key = `${sport}:${gameId}`
  const hit = starterCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  try {
    const identities = await prisma.playerIdentityMap.findMany({
      where: { sport, espnId: { in: espnIds }, rollingInsightsId: { not: null } },
      select: { espnId: true, rollingInsightsId: true },
    })
    const espnByRi = new Map(identities.filter(i => i.espnId && i.rollingInsightsId).map(i => [i.rollingInsightsId!, i.espnId!]))
    const impacts = await starterImpactsByPlayerId([...espnByRi.keys()], sport)
    const value = { users: new Set<string>(), byAthlete: new Map<string, Set<string>>() }
    for (const [ri, users] of impacts) {
      const espnId = espnByRi.get(ri)
      if (!espnId) continue
      const set = value.byAthlete.get(espnId) ?? new Set<string>()
      for (const u of users) { set.add(u.userId); value.users.add(u.userId) }
      value.byAthlete.set(espnId, set)
    }
    starterCache.set(key, { at: Date.now(), value })
    return value
  } catch {
    return empty
  }
}

/** Invert athlete → users into user → athletes, for the post-game recap. */
export function startersByUser(byAthlete: Map<string, Set<string>>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [athleteId, users] of byAthlete) for (const u of users) out.set(u, [...(out.get(u) ?? []), athleteId])
  return out
}
