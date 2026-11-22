import 'server-only'

import { prisma } from '@/lib/prisma'
import { summarizeSpecialistGames, type SpecialistRate } from './nflSpecialistRatesModel'

/**
 * Per-game rates for NFL kickers and team defenses, from this season's stored game logs
 * (`player_game_stats`). The AF engine's season snapshot carries a kicker's field goals with no
 * distance and no team defense at all, so neither could be priced in a league's own scoring.
 * Keyed as rosters key them: a kicker by Sleeper id, a team defense by club code.
 */
const cache = new Map<number, { at: number; rows: Promise<Map<string, SpecialistRate>> }>()
const TTL_MS = 10 * 60_000

async function read(season: number): Promise<Map<string, SpecialistRate>> {
  // `jsonb_exists` is the `?` operator spelled out; it keeps only the rows that carry one of the stats.
  const rows = await prisma.$queryRaw<Array<{ playerId: string; normalizedStatMap: unknown }>>`
    SELECT "playerId", normalized_stat_map AS "normalizedStatMap"
    FROM player_game_stats
    WHERE "sportType" = 'NFL' AND season = ${season}
      AND (jsonb_exists(normalized_stat_map::jsonb, 'pts_allow')
        OR jsonb_exists(normalized_stat_map::jsonb, 'fga')
        OR jsonb_exists(normalized_stat_map::jsonb, 'xpa'))`
  const byId = new Map<string, Array<Record<string, unknown>>>()
  for (const row of rows) {
    const stats = row.normalizedStatMap
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) continue
    const list = byId.get(row.playerId) ?? []
    list.push(stats as Record<string, unknown>)
    byId.set(row.playerId, list)
  }
  const out = new Map<string, SpecialistRate>()
  for (const [id, games] of byId) {
    const rate = summarizeSpecialistGames(games)
    if (rate) out.set(id, rate)
  }
  return out
}

export function loadNflSpecialistRates(season: number): Promise<Map<string, SpecialistRate>> {
  const now = Date.now()
  const hit = cache.get(season)
  if (hit && now - hit.at < TTL_MS) return hit.rows
  const rows = read(season).catch((error) => {
    if (cache.get(season)?.rows === rows) cache.delete(season)
    throw error
  })
  cache.set(season, { at: now, rows })
  return rows
}
