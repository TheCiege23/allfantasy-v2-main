/**
 * Fantasy OS — portfolio driver: refresh every DUE connected league, across providers.
 *
 * Enumerates canonical imported leagues and syncs each due connection with bounded concurrency and
 * per-league isolation — one league's failure NEVER blocks another (each is caught independently),
 * and the per-league distributed lock guarantees overlapping cron executions never process the same
 * league twice. Rate-safe: bounded concurrency + one memoized provider burst per league.
 *
 * ⚠ ENUMERATION IS PER PROVIDER, NOT ONE POOLED QUERY, AND THAT IS A FAIRNESS FIX RATHER THAN
 * A STYLE CHOICE. A single `take: limit` across all providers ordered by season would be filled
 * almost entirely by whichever provider has the most leagues — today Sleeper by a wide margin —
 * so ESPN and Fantrax would be starved out of every bounded tick and never refresh at all. That
 * is the same starvation `runBudget` documents, arriving through the ORDER BY instead of a
 * budget. A per-provider slice guarantees each platform a share of every heartbeat.
 */
import type { ImportProvider } from '@/lib/league-import/types'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import { enumerateConnectedLeagues } from './enumerate'
import {
  syncConnectedLeague,
  type SyncConnectedResult,
} from './syncConnectedSleeperLeague'
import { SYNCABLE_PROVIDERS, type LeagueSyncConnection } from './types'

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
  /**
   * Due, but deliberately not attempted — today only "nobody has stored credentials for this
   * provider".
   *
   * ⚠ IT NEEDED ITS OWN BUCKET. Without one, a credential skip fell through the `notDue` test
   * (its reason does not say "not due") into the final `else`, and was counted as EXECUTED and
   * COMPLETED — so the heartbeat would report a full refresh of leagues it had not touched.
   * That is the "check that reports success over work it did not do" shape this repo keeps
   * paying for, and generalising the collector is exactly what would have introduced it.
   */
  skipped: number
  errored: number
  /** Per-provider enumeration counts, so a starved or empty provider is visible at a glance. */
  byProvider: Record<string, number>
  results: Array<SyncConnectedResult & { error?: string }>
}

export interface RunDueInput {
  now?: Date
  /**
   * Max connections to enumerate PER PROVIDER this tick (bounded provider load).
   *
   * ⚠ PER PROVIDER, NOT IN TOTAL — see the fairness note in this file's header. With six
   * providers and a limit of 25, a tick considers at most 150 leagues, and no provider can be
   * crowded out by another's volume.
   */
  limit?: number
  /** Bounded parallelism across leagues. Default 4. */
  concurrency?: number
  reconcileRemovals?: boolean
  /** Injectable normalized loader (controlled fixtures in tests). Default = the live provider read. */
  fetchNormalized?: (
    externalLeagueId: string,
    connection?: LeagueSyncConnection,
  ) => Promise<NormalizedImportResult>
  /** Explicit connection set (ops targeting / deterministic tests). Default = enumerate all connected. */
  connections?: LeagueSyncConnection[]
  /** Which platforms to refresh. Default = every syncable provider. */
  providers?: readonly ImportProvider[]
  /** Tests inject fixtures and hold no real credentials. */
  skipCredentialPreflight?: boolean
}

export async function runDueLeagues(input?: RunDueInput): Promise<RunDueResult> {
  const now = input?.now ?? new Date()
  const providers = input?.providers ?? SYNCABLE_PROVIDERS

  let connections: LeagueSyncConnection[]
  if (input?.connections) {
    connections = input.connections
  } else {
    const perProvider = await Promise.all(
      providers.map((provider) => enumerateConnectedLeagues([provider], input?.limit)),
    )
    connections = perProvider.flat()
  }

  const byProvider: Record<string, number> = {}
  for (const c of connections) {
    byProvider[c.provider] = (byProvider[c.provider] ?? 0) + 1
  }

  const results = await mapWithConcurrency(
    connections,
    input?.concurrency ?? 4,
    async (connection): Promise<SyncConnectedResult & { error?: string }> => {
      try {
        return await syncConnectedLeague(connection, now, {
          fetchNormalized: input?.fetchNormalized,
          reconcileRemovals: input?.reconcileRemovals,
          skipCredentialPreflight: input?.skipCredentialPreflight,
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
    executed: 0, completed: 0, partial: 0, failed: 0, locked: 0, notDue: 0, skipped: 0, errored: 0,
    byProvider,
    results,
  }
  for (const r of results) {
    if (r.error) summary.errored += 1
    else if (!r.due || (!r.executed && r.reason?.includes('not due'))) summary.notDue += 1
    else if (r.status === 'locked') summary.locked += 1
    /*
     * ⚠ THIS CLAUSE MUST COME BEFORE THE `else`, AND ITS ABSENCE WAS THE BUG.
     * A connection that returned `executed: false` with no run `status` did nothing — today
     * that means the credential pre-flight declined it. The old chain had no test for it, so
     * it landed in the final `else` and was counted as executed AND completed: a heartbeat
     * cheerfully reporting a refresh of every ESPN league on the platform while touching none
     * of them. `status === undefined` is the honest discriminator — a real run always sets one.
     */
    else if (!r.executed && r.status === undefined) summary.skipped += 1
    else {
      summary.executed += 1
      if (r.status === 'completed') summary.completed += 1
      else if (r.status === 'partial') summary.partial += 1
      else if (r.status === 'failed') summary.failed += 1
    }
  }
  return summary
}

/**
 * @deprecated Use `runDueLeagues({ providers: ['sleeper'] })`. Kept so the existing cron entry
 * point and its tests are untouched by the generalisation.
 */
export async function runDueSleeperLeagues(
  input?: Omit<RunDueInput, 'providers'>,
): Promise<RunDueResult> {
  return runDueLeagues({ ...input, providers: ['sleeper'] })
}
