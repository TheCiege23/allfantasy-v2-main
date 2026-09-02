/**
 * Fantasy OS — enumerate the canonical imported leagues the durable collector must refresh.
 *
 * Selects canonical imported leagues for the requested providers, each with a real external league
 * id. This inherently EXCLUDES:
 *   - AF-native leagues (platform `manual`/`allfantasy`/`af`/`native` per lib/league/write-authority),
 *   - Legacy-only imports (no `platform='sleeper'` League row exists for them),
 *   - providers not in the requested set,
 *   - deleted/disconnected leagues (hard-deleted rows simply don't return).
 *
 * Multiple `League` rows (one per importing user) can mirror the same external league+season; they
 * collapse to ONE deterministic run key `<provider>:<externalLeagueId>:<season>` so a single fetch
 * refreshes every mirror without duplicate provider load.
 */
import { prisma } from '@/lib/prisma'
import type { ImportProvider } from '@/lib/league-import/types'
import { SYNCABLE_PROVIDERS, type LeagueSyncConnection } from './types'

export function buildRunKey(provider: string, externalLeagueId: string, season: number): string {
  return `${provider}:${externalLeagueId}:${season}`
}

/**
 * Distinct connected leagues for the given providers, deduped to one connection per
 * (provider, externalLeagueId, season).
 *
 * ⚠ THE GROUPING MUST INCLUDE `platform`, AND IT DID NOT NEED TO WHEN THIS WAS SLEEPER-ONLY.
 * With one provider, `(platformLeagueId, season)` was already unique. Across six it is not:
 * league ids are provider-scoped namespaces, and an ESPN numeric id can collide with a
 * Fleaflicker one. Grouping without the platform would collapse two different leagues into a
 * single run key and refresh one of them with the other's data.
 *
 * `limit` caps the batch for bounded provider load; undefined = all.
 */
export async function enumerateConnectedLeagues(
  providers: readonly ImportProvider[] = SYNCABLE_PROVIDERS,
  limit?: number,
): Promise<LeagueSyncConnection[]> {
  if (providers.length === 0) return []

  const groups = await prisma.league.groupBy({
    by: ['platform', 'platformLeagueId', 'season', 'sport'],
    where: {
      platform: { in: [...providers] },
      platformLeagueId: { not: '' },
    },
    /*
     * Newest season first, then a stable secondary order. Stability matters more than it looks:
     * the per-league due-check plus a bounded batch means a fixed order would refresh the head
     * of the list forever and never reach the tail — the same starvation `runBudget` documents.
     * The cadence check is what rotates the portfolio, and it can only do that if the order does
     * not shuffle between heartbeats.
     */
    orderBy: [{ season: 'desc' }, { platform: 'asc' }, { platformLeagueId: 'asc' }],
    ...(typeof limit === 'number' && limit > 0 ? { take: limit } : {}),
  })

  const seen = new Set<string>()
  const connections: LeagueSyncConnection[] = []
  for (const g of groups) {
    const externalLeagueId = String(g.platformLeagueId ?? '').trim()
    if (!externalLeagueId) continue
    const provider = String(g.platform ?? '').toLowerCase() as ImportProvider
    if (!provider) continue
    const season = g.season
    const sport = String(g.sport ?? 'NFL')
    const runKey = buildRunKey(provider, externalLeagueId, season)
    if (seen.has(runKey)) continue
    seen.add(runKey)
    connections.push({ runKey, provider, externalLeagueId, season, sport })
  }
  return connections
}

/**
 * @deprecated Use `enumerateConnectedLeagues(['sleeper'], limit)`. Kept so the existing Sleeper
 * call sites and their tests are untouched by the generalisation.
 */
export async function enumerateConnectedSleeperLeagues(
  limit?: number,
): Promise<LeagueSyncConnection[]> {
  return enumerateConnectedLeagues(['sleeper'], limit)
}

/** Resolve every canonical League row that mirrors a given connection (usually one; may be several). */
export async function resolveLeagueIdsForConnection(
  connection: LeagueSyncConnection,
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
