/**
 * Fantasy OS — enumerate the canonical imported Sleeper leagues the durable collector must refresh.
 *
 * Selects ONLY canonical imported Sleeper leagues: `platform === 'sleeper'` with a real external league
 * id. This inherently EXCLUDES:
 *   - AF-native leagues (platform `manual`/`allfantasy`/`af`/`native` per lib/league/write-authority),
 *   - Legacy-only imports (no `platform='sleeper'` League row exists for them),
 *   - other providers (espn/yahoo/mfl/fantrax/fleaflicker),
 *   - deleted/disconnected leagues (hard-deleted rows simply don't return).
 *
 * Multiple `League` rows (one per importing user) can mirror the same external league+season; they
 * collapse to ONE deterministic run key `<provider>:<externalLeagueId>:<season>` so a single fetch
 * refreshes every mirror without duplicate provider load.
 */
import { prisma } from '@/lib/prisma'
import type { SleeperSyncConnection } from './types'

export function buildRunKey(provider: string, externalLeagueId: string, season: number): string {
  return `${provider}:${externalLeagueId}:${season}`
}

/**
 * Distinct connected Sleeper leagues, deduped to one connection per (externalLeagueId, season).
 * `limit` caps the batch for bounded provider load (Sleeper safe-rate); undefined = all.
 */
export async function enumerateConnectedSleeperLeagues(
  limit?: number,
): Promise<SleeperSyncConnection[]> {
  const groups = await prisma.league.groupBy({
    by: ['platformLeagueId', 'season', 'sport'],
    where: {
      platform: 'sleeper',
      platformLeagueId: { not: '' },
    },
    orderBy: [{ season: 'desc' }, { platformLeagueId: 'asc' }],
    ...(typeof limit === 'number' && limit > 0 ? { take: limit } : {}),
  })

  const seen = new Set<string>()
  const connections: SleeperSyncConnection[] = []
  for (const g of groups) {
    const externalLeagueId = String(g.platformLeagueId ?? '').trim()
    if (!externalLeagueId) continue
    const season = g.season
    const sport = String(g.sport ?? 'NFL')
    const runKey = buildRunKey('sleeper', externalLeagueId, season)
    if (seen.has(runKey)) continue
    seen.add(runKey)
    connections.push({ runKey, provider: 'sleeper', externalLeagueId, season, sport })
  }
  return connections
}

/** Resolve every canonical League row that mirrors a given connection (usually one; may be several). */
export async function resolveLeagueIdsForConnection(
  connection: SleeperSyncConnection,
): Promise<{ id: string; userId: string }[]> {
  return prisma.league.findMany({
    where: {
      platform: connection.provider,
      platformLeagueId: connection.externalLeagueId,
      season: connection.season,
    },
    select: { id: true, userId: true },
  })
}
