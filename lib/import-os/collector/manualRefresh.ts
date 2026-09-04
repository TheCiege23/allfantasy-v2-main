/**
 * Fantasy OS — authorized manual refresh + sync-state inspection for a connected league, any provider.
 *
 * Both entry points require a caller with real access to the connected league (owner OR a claimed team,
 * via the canonical `resolveLeagueAccess`) — another user can neither refresh nor inspect its sync state.
 * The refresh drives the SAME durable collector the cron uses (one sync architecture), with `force: true`
 * to bypass the cadence gate while still respecting the per-league distributed lock. Read-only upstream.
 */
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import { buildRunKey } from './enumerate'
import { syncConnectedLeague, type SyncConnectedResult } from './syncConnectedSleeperLeague'
import { SYNCABLE_PROVIDERS, type LeagueSyncConnection } from './types'
import type { ImportProvider } from '@/lib/league-import/types'

export type ManualRefreshResult =
  | { ok: true; leagueId: string; sync: SyncConnectedResult }
  | { ok: false; status: 400 | 403 | 404; error: string }

async function authorizeConnection(
  userId: string | null | undefined,
  leagueId: string,
): Promise<
  | { ok: true; connection: LeagueSyncConnection }
  | { ok: false; status: 400 | 403 | 404; error: string }
> {
  if (!userId) return { ok: false, status: 403, error: 'Authentication required' }

  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access) return { ok: false, status: 403, error: 'You do not have access to this league' }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, platformLeagueId: true, season: true, sport: true },
  })
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  /*
   * 🛑 THIS REFUSED EVERY NON-SLEEPER LEAGUE, WHICH IS WHY "SYNC NOW" DID NOT EXIST FOR THEM.
   *
   * The product decision is cron where we can, a manual pull where we cannot — but the manual
   * pull was gated to one provider, so the five that most needed a fallback were exactly the
   * five that had none. `/api/leagues/import/resync` said as much in its own comment.
   */
  const provider = String(league.platform ?? '').toLowerCase() as ImportProvider
  if (!SYNCABLE_PROVIDERS.includes(provider as (typeof SYNCABLE_PROVIDERS)[number]) || !league.platformLeagueId) {
    return {
      ok: false,
      status: 400,
      error: 'This league is not connected to a platform AllFantasy can refresh',
    }
  }

  const connection: LeagueSyncConnection = {
    runKey: buildRunKey(provider, league.platformLeagueId, league.season),
    provider,
    externalLeagueId: league.platformLeagueId,
    season: league.season,
    sport: String(league.sport),
  }
  return { ok: true, connection }
}

/** Force a durable, authorized refresh of the connected league the caller can access, any provider. */
export async function manualRefreshConnectedSleeperLeague(input: {
  userId: string | null | undefined
  leagueId: string
  now?: Date
  fetchNormalized?: (externalLeagueId: string) => Promise<NormalizedImportResult>
}): Promise<ManualRefreshResult> {
  const auth = await authorizeConnection(input.userId, input.leagueId)
  if (!auth.ok) return auth

  const sync = await syncConnectedLeague(auth.connection, input.now ?? new Date(), {
    force: true,
    fetchNormalized: input.fetchNormalized,
  })
  return { ok: true, leagueId: input.leagueId, sync }
}

export type SyncStateInspection =
  | {
      ok: true
      leagueId: string
      runKey: string
      state: {
        syncStatus: string | null
        seasonState: string | null
        lastAttemptedSyncAt: string | null
        lastSuccessfulSyncAt: string | null
        sourceDataTimestamp: string | null
        consecutiveFailures: number
        completedScopes: unknown
        incompleteScopes: unknown
        lastError: string | null
      } | null
    }
  | { ok: false; status: 400 | 403 | 404; error: string }

/** Read the durable sync state for a connected league — gated identically to refresh. */
export async function getConnectedLeagueSyncState(input: {
  userId: string | null | undefined
  leagueId: string
}): Promise<SyncStateInspection> {
  const auth = await authorizeConnection(input.userId, input.leagueId)
  if (!auth.ok) return auth

  const row = await prisma.leagueSyncState.findUnique({
    where: { runKey: auth.connection.runKey },
    select: {
      syncStatus: true, seasonState: true, lastAttemptedSyncAt: true, lastSuccessfulSyncAt: true,
      sourceDataTimestamp: true, consecutiveFailures: true, completedScopes: true,
      incompleteScopes: true, lastError: true,
    },
  })
  return {
    ok: true,
    leagueId: input.leagueId,
    runKey: auth.connection.runKey,
    state: row
      ? {
          syncStatus: row.syncStatus,
          seasonState: row.seasonState,
          lastAttemptedSyncAt: row.lastAttemptedSyncAt?.toISOString() ?? null,
          lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
          sourceDataTimestamp: row.sourceDataTimestamp?.toISOString() ?? null,
          consecutiveFailures: row.consecutiveFailures,
          completedScopes: row.completedScopes,
          incompleteScopes: row.incompleteScopes,
          lastError: row.lastError,
        }
      : null,
  }
}
