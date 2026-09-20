import { prisma } from '@/lib/prisma'
import { isInSeason, resolveSeasonState } from '@/lib/import-os/season'
import { enumerateConnectedLeagues } from './enumerate'
import { isInLeagueGoneBackoff } from './leagueGone'
import { runDueLeagues, type RunDueResult } from './runDueSleeperLeagues'
import { SYNCABLE_PROVIDERS, type LeagueSyncConnection } from './types'

export const ACTIVE_SYNC_CADENCE_MINUTES = 5
export const ACTIVE_SYNC_SCOPES = ['transactions', 'teams_rosters'] as const
/**
 * Per-league work budget for the active lane.
 *
 * ⚠ 20s WAS NOT WRONG ABOUT THE WORK, IT WAS WRONG ABOUT WHAT IT WAS MEASURING. Successful runs
 * of this lane finish at p50 1.9s and p95 7.3s (5,585 runs, production 2026-09-18 onward), so 20s
 * carried roughly 3x headroom over anything a scope actually does. What exhausted it was queueing
 * charged to the same clock — see `budgetStartedAt` in `runner.ts`, which no longer does that.
 *
 * 60s is ~8x the p95 and still a real bound. It is raised rather than removed because the
 * distribution has a genuine tail (max 466s on a large league), and an unbounded lane on a worker
 * with one JS thread is how one slow league stalls the ones behind it.
 */
export const ACTIVE_SYNC_LEAGUE_TIMEOUT_MS = 60_000
const ACTIVE_LANE_SUFFIX = 'active'
const RECENT_VIEW_WINDOW_MS = 30 * 60_000

export type ActiveSyncLaneResult = RunDueResult & {
  eligible: number
  selected: number
  recentlyViewedSelected: number
}

function activeSeasonYear(now: Date): number {
  return now.getUTCMonth() <= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
}

/**
 * Pick a bounded, fair slice for the five-minute lane. Its state key is separate
 * from the full collector, so a mutable-scope refresh cannot postpone the full
 * league-state pass. Recently viewed leagues lead the queue; the rest rotate by
 * their oldest active-lane attempt.
 */
export async function selectActiveSyncConnections(input?: {
  now?: Date
  limitPerProvider?: number
}): Promise<{ connections: LeagueSyncConnection[]; eligible: number; recentlyViewedSelected: number }> {
  const now = input?.now ?? new Date()
  const limitPerProvider = Math.max(1, Math.min(input?.limitPerProvider ?? 4, 50))
  const season = activeSeasonYear(now)

  const perProvider = await Promise.all(
    SYNCABLE_PROVIDERS.map((provider) => enumerateConnectedLeagues([provider])),
  )
  const eligible = perProvider
    .flat()
    .filter((connection) => connection.season === season)
    .filter((connection) =>
      isInSeason(resolveSeasonState({
        sport: connection.sport,
        provider: connection.provider,
        season: connection.season,
        now,
      }).state),
    )
    .map((connection) => ({ ...connection, runKey: `${connection.runKey}:${ACTIVE_LANE_SUFFIX}` }))

  if (eligible.length === 0) return { connections: [], eligible: 0, recentlyViewedSelected: 0 }

  const [states, leagueRows] = await Promise.all([
    prisma.leagueSyncState.findMany({
      where: { runKey: { in: eligible.map((connection) => connection.runKey) } },
      select: { runKey: true, lastAttemptedSyncAt: true, syncStatus: true, lastError: true },
    }),
    prisma.league.findMany({
      where: {
        season,
        platform: { in: [...SYNCABLE_PROVIDERS] },
        platformLeagueId: { not: '' },
      },
      select: { platform: true, platformLeagueId: true, season: true, lastViewedAt: true },
    }),
  ])

  const attemptedAt = new Map(states.map((row) => [row.runKey, row.lastAttemptedSyncAt?.getTime() ?? null]))
  /*
   * A league the provider said is gone stops advancing its attempt time for a day, so the
   * oldest-attempt ordering below would hand it a slot every tick only for the due check to
   * decline it. See ./leagueGone.
   */
  const goneBackoff = new Set(states.filter((row) => isInLeagueGoneBackoff(row, now)).map((row) => row.runKey))
  const viewedAt = new Map<string, number>()
  for (const row of leagueRows) {
    const key = `${String(row.platform).toLowerCase()}:${row.platformLeagueId}:${row.season}:${ACTIVE_LANE_SUFFIX}`
    const at = row.lastViewedAt?.getTime() ?? 0
    if (at > (viewedAt.get(key) ?? 0)) viewedAt.set(key, at)
  }

  const chosen: LeagueSyncConnection[] = []
  let recentlyViewedSelected = 0
  for (const provider of SYNCABLE_PROVIDERS) {
    const rows = eligible
      .filter((connection) => connection.provider === provider && !goneBackoff.has(connection.runKey))
      .map((connection, index) => ({
        connection,
        index,
        attemptedAt: attemptedAt.get(connection.runKey) ?? null,
        viewedAt: viewedAt.get(connection.runKey) ?? 0,
      }))
      .sort((a, b) => {
        const aRecent = now.getTime() - a.viewedAt <= RECENT_VIEW_WINDOW_MS
        const bRecent = now.getTime() - b.viewedAt <= RECENT_VIEW_WINDOW_MS
        if (aRecent !== bRecent) return aRecent ? -1 : 1
        if (aRecent && a.viewedAt !== b.viewedAt) return b.viewedAt - a.viewedAt
        if (a.attemptedAt === null && b.attemptedAt !== null) return -1
        if (a.attemptedAt !== null && b.attemptedAt === null) return 1
        if (a.attemptedAt !== b.attemptedAt) return (a.attemptedAt ?? 0) - (b.attemptedAt ?? 0)
        return a.index - b.index
      })
      .slice(0, limitPerProvider)

    recentlyViewedSelected += rows.filter(
      (row) => now.getTime() - row.viewedAt <= RECENT_VIEW_WINDOW_MS,
    ).length
    chosen.push(...rows.map((row) => row.connection))
  }

  return { connections: chosen, eligible: eligible.length, recentlyViewedSelected }
}

export async function runActiveSyncLane(input?: {
  now?: Date
  limitPerProvider?: number
  concurrency?: number
}): Promise<ActiveSyncLaneResult> {
  const now = input?.now ?? new Date()
  const selected = await selectActiveSyncConnections({ now, limitPerProvider: input?.limitPerProvider })
  const summary = await runDueLeagues({
    now,
    connections: selected.connections,
    concurrency: input?.concurrency ?? 6,
    cadenceMinutesOverride: ACTIVE_SYNC_CADENCE_MINUTES,
    scopes: [...ACTIVE_SYNC_SCOPES],
    matchupStaleThresholdMs: ACTIVE_SYNC_CADENCE_MINUTES * 60_000,
    runTimeoutMs: ACTIVE_SYNC_LEAGUE_TIMEOUT_MS,
  })
  return {
    ...summary,
    eligible: selected.eligible,
    selected: selected.connections.length,
    recentlyViewedSelected: selected.recentlyViewedSelected,
  }
}
