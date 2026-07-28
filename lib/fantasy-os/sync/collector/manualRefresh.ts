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

/**
 * Resolve the accessible canonical Sleeper connection for a caller from the EXTERNAL Sleeper league id
 * (the resync entry point holds the Sleeper league id, not the AF `League.id`). Finds the canonical
 * mirror rows for that external league, verifies the caller can access one, and builds the connection /
 * run key — with NO provider fetch (the fetch happens inside the locked run). One external Sleeper
 * league id maps to exactly one season, so every mirror row shares one run key.
 */
export async function resolveSleeperConnectionForSource(
  userId: string | null | undefined,
  externalLeagueId: string,
): Promise<
  | { ok: true; connection: SleeperSyncConnection; leagueId: string }
  | { ok: false; status: 400 | 403 | 404; error: string }
> {
  if (!userId) return { ok: false, status: 403, error: 'Authentication required' }
  const cleanId = externalLeagueId.trim()
  if (!cleanId) return { ok: false, status: 400, error: 'Missing league id' }

  const mirrors = await prisma.league.findMany({
    where: { platform: 'sleeper', platformLeagueId: cleanId },
    select: { id: true, season: true, sport: true },
    orderBy: { season: 'desc' },
  })
  if (mirrors.length === 0) {
    return { ok: false, status: 404, error: 'This league is not connected. Import it first.' }
  }
  // Verify the caller can access at least one mirror row (owner or a claimed team) before doing anything.
  let accessibleLeagueId: string | null = null
  for (const m of mirrors) {
    if (await resolveLeagueAccess(m.id, userId)) {
      accessibleLeagueId = m.id
      break
    }
  }
  if (!accessibleLeagueId) {
    return { ok: false, status: 403, error: 'You do not have access to this league' }
  }
  const chosen = mirrors.find((m) => m.id === accessibleLeagueId)!
  const connection: SleeperSyncConnection = {
    runKey: buildRunKey('sleeper', cleanId, chosen.season),
    provider: 'sleeper',
    externalLeagueId: cleanId,
    season: chosen.season,
    sport: String(chosen.sport),
  }
  return { ok: true, connection, leagueId: accessibleLeagueId }
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
