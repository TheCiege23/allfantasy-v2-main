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
 * 🛑 THAT LAST EXCLUSION STRANDS A `league_sync_state` ROW, AND THE ROW IS WHAT LIES LATER.
 * Selection reads `leagues`; `league_sync_state` has no foreign key to it and nothing deletes from
 * it. So disconnecting a league leaves its state row behind, and that row is thereafter never
 * enumerated, never retried, and costs ZERO provider requests — while `consecutiveFailures` stays
 * frozen at whatever it reached on the day it was disconnected. Nothing can ever reset it, because
 * only a run resets it and it will never run again.
 *
 * ⚠ SO A FAILURE COUNT READ OFF `league_sync_state` IS NOT A LIVE-COST MEASURE, AND ORPHANS CARRY
 * THE BIGGEST NUMBERS — they failed longest before somebody gave up and disconnected them.
 * Measured on production 2026-09-06: of 3 rows with `consecutiveFailures > 0`, two were orphans
 * (92 and 70 failures, last attempted 2026-08-24) and one was live (15). A release-register entry
 * had already been written off the 165 total, describing a retry storm that was 98% dead rows.
 *
 * Join before you quote it:
 *
 *     LEFT JOIN leagues l ON l.platform = s.provider
 *       AND l."platformLeagueId" = s."externalLeagueId" AND l.season = s.season
 *     -- l.id IS NULL  =>  orphan: not enumerated, not retried, not a cost
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
     * A stable base order — newest season first, then platform and id. This is the TIE-BREAKER
     * now, not the selection order: the batch is chosen by staleness below.
     *
     * 🛑 IT USED TO BE THE SELECTION ORDER, WITH `take: limit` APPLIED HERE, AND THAT
     * SILENTLY FROZE 87% OF THE PORTFOLIO. Measured 2026-09-03 against production, with the
     * cron's default limit of 25 per provider:
     *
     *     first 25 by this order    25 leagues   25 synced in 24h  (100%)
     *     rank 26+                 170 leagues    2 synced in 24h  (1.2%, both manual refreshes)
     *
     * The comment that used to sit here named this exact failure and asserted the cadence check
     * prevented it — "the cadence check is what rotates the portfolio". It cannot. `take` runs
     * in the DATABASE, so the cadence check only ever saw the same first 25 rows: it could skip
     * members of a fixed set but never change the set. The heartbeat reported a healthy 25/25
     * every tick while 170 leagues had not been enumerated once.
     */
    orderBy: [{ season: 'desc' }, { platform: 'asc' }, { platformLeagueId: 'asc' }],
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

  return selectStalestFirst(connections, limit)
}

/**
 * Choose which connections this tick refreshes: the STALEST first.
 *
 * ⚠ SAME PROVIDER LOAD, DIFFERENT TARGETS. This does not fetch more leagues per tick — it
 * picks a better `limit` of them. At the cron's default of 25 per provider a ~195-league
 * portfolio cycles completely in ~8 ticks instead of never reaching league 26.
 *
 * Ordering, in priority order:
 *   1. NEVER attempted (no sync-state row, or a null timestamp) — these have never synced.
 *   2. Oldest `lastAttemptedSyncAt` first.
 *   3. The caller's stable base order, so the result is deterministic when timestamps tie.
 *
 * ⚠ IT DELIBERATELY READS `lastAttemptedSyncAt`, NOT `lastSuccessfulSyncAt`. Ordering by
 * success would pin a permanently failing league to the head of every tick forever, starving the
 * rest — the same starvation this function exists to remove, with a different victim. Attempt
 * time advances whether or not the sync succeeds, so a failing league yields its slot after one
 * try.
 *
 * ⚠ AND IT MUST NOT CONSULT `syncStatus`. A league left in `partial` or `failed` is exactly
 * the one that most needs re-attempting; gating on status is how 37 leagues sat frozen for 39
 * hours after a 17-minute incident.
 */
async function selectStalestFirst(
  connections: LeagueSyncConnection[],
  limit?: number,
): Promise<LeagueSyncConnection[]> {
  const bounded = typeof limit === 'number' && limit > 0
  // Nothing to choose between: keep the base order and skip the extra query entirely.
  if (!bounded || connections.length <= limit) return connections

  const states = await prisma.leagueSyncState.findMany({
    where: { runKey: { in: connections.map((c) => c.runKey) } },
    select: { runKey: true, lastAttemptedSyncAt: true },
  })
  const lastAttemptAt = new Map<string, number | null>()
  for (const row of states) lastAttemptAt.set(row.runKey, row.lastAttemptedSyncAt?.getTime() ?? null)

  /*
   * Decorate-sort-undecorate carrying the original index, so the tie-break is explicit in the
   * comparator rather than relying on the engine's sort stability.
   */
  return connections
    .map((c, i) => ({ c, i, at: lastAttemptAt.get(c.runKey) ?? null }))
    .sort((a, b) => {
      if (a.at === null && b.at === null) return a.i - b.i
      if (a.at === null) return -1
      if (b.at === null) return 1
      if (a.at !== b.at) return a.at - b.at
      return a.i - b.i
    })
    .slice(0, limit)
    .map((x) => x.c)
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
