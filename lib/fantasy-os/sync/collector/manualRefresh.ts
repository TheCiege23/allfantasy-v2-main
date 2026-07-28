/**
 * Fantasy OS — authorized manual refresh + sync-state inspection for a connected Sleeper league.
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
import { syncConnectedSleeperLeague, type SyncConnectedResult } from './syncConnectedSleeperLeague'
import type { SleeperSyncConnection } from './types'

export type ManualRefreshResult =
  | { ok: true; leagueId: string; sync: SyncConnectedResult }
  | { ok: false; status: 400 | 403 | 404; error: string }

async function authorizeSleeperConnection(
  userId: string | null | undefined,
  leagueId: string,
): Promise<
  | { ok: true; connection: SleeperSyncConnection }
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
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return { ok: false, status: 400, error: 'This league is not a connected Sleeper league' }
  }

  const connection: SleeperSyncConnection = {
    runKey: buildRunKey('sleeper', league.platformLeagueId, league.season),
    provider: 'sleeper',
    externalLeagueId: league.platformLeagueId,
    season: league.season,
    sport: String(league.sport),
  }
  return { ok: true, connection }
}

/** Force a durable, authorized refresh of the connected Sleeper league the caller can access. */
export async function manualRefreshConnectedSleeperLeague(input: {
  userId: string | null | undefined
  leagueId: string
  now?: Date
  fetchNormalized?: (externalLeagueId: string) => Promise<NormalizedImportResult>
}): Promise<ManualRefreshResult> {
  const auth = await authorizeSleeperConnection(input.userId, input.leagueId)
  if (!auth.ok) return auth

  const sync = await syncConnectedSleeperLeague(auth.connection, input.now ?? new Date(), {
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
  const auth = await authorizeSleeperConnection(input.userId, input.leagueId)
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
