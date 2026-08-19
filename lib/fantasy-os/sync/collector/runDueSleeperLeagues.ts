/**
 * Fantasy OS — portfolio driver: refresh every DUE connected Sleeper league.
 *
 * Enumerates canonical imported Sleeper leagues and syncs each due connection with bounded concurrency
 * and per-league isolation — one league's failure NEVER blocks another (each is caught independently),
 * and the per-league distributed lock guarantees overlapping cron executions never process the same
 * league twice. Rate-safe: bounded concurrency + one memoized provider burst per league.
 */
import type { NormalizedImportResult } from '@/lib/league-import/types'
import { enumerateConnectedSleeperLeagues } from './enumerate'
import { syncConnectedSleeperLeague, type SyncConnectedResult } from './syncConnectedSleeperLeague'
import type { SleeperSyncConnection } from './types'

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) break
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

export interface RunDueResult {
  enumerated: number
  executed: number
  completed: number
  partial: number
  failed: number
  locked: number
  notDue: number
  errored: number
  results: Array<SyncConnectedResult & { error?: string }>
}

export async function runDueSleeperLeagues(input?: {
  now?: Date
  /** Max connections to enumerate this tick (bounded provider load). */
  limit?: number
  /** Bounded parallelism across leagues (Sleeper safe-rate). Default 4. */
  concurrency?: number
  reconcileRemovals?: boolean
  /** Injectable normalized loader (controlled fixtures in tests). Default = live Sleeper. */
  fetchNormalized?: (externalLeagueId: string) => Promise<NormalizedImportResult>
  /** Explicit connection set (ops targeting / deterministic tests). Default = enumerate all connected. */
  connections?: SleeperSyncConnection[]
}): Promise<RunDueResult> {
  const now = input?.now ?? new Date()
  const connections = input?.connections ?? (await enumerateConnectedSleeperLeagues(input?.limit))

  const results = await mapWithConcurrency(
    connections,
    input?.concurrency ?? 4,
    async (connection): Promise<SyncConnectedResult & { error?: string }> => {
      try {
        return await syncConnectedSleeperLeague(connection, now, {
          fetchNormalized: input?.fetchNormalized,
          reconcileRemovals: input?.reconcileRemovals,
        })
      } catch (err) {
        // Per-league isolation: a thrown error is contained so the rest of the portfolio still syncs.
        return {
          runKey: connection.runKey,
          executed: false,
          due: true,
          seasonState: 'unknown',
          cadenceMinutes: 0,
          nextEligibleAt: now.toISOString(),
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )

  const summary: RunDueResult = {
    enumerated: connections.length,
    executed: 0, completed: 0, partial: 0, failed: 0, locked: 0, notDue: 0, errored: 0,
    results,
  }
  for (const r of results) {
    if (r.error) summary.errored += 1
    else if (!r.due || (!r.executed && r.reason?.includes('not due'))) summary.notDue += 1
    else if (r.status === 'locked') summary.locked += 1
    else {
      summary.executed += 1
      if (r.status === 'completed') summary.completed += 1
      else if (r.status === 'partial') summary.partial += 1
      else if (r.status === 'failed') summary.failed += 1
    }
  }
  return summary
}
