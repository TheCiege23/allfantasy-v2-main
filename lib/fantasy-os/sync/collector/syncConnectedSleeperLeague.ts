/**
 * Fantasy OS — synchronize ONE connected Sleeper league through the durable runner.
 *
 * Resolves the season-aware cadence, decides whether the connection is due (never hammering the
 * provider), then drives `runSync` with the Prisma store + AutomationLock + memoized Sleeper fetcher.
 * The normalized-payload loader is injectable (`fetchNormalized`) so tests drive deterministic
 * controlled fixtures without touching the live Sleeper API; production defaults to the canonical
 * `runImportedLeagueNormalizationPipeline` (a single live provider burst per run).
 */
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import { prisma } from '@/lib/prisma'
import { resolveCadence } from '@/lib/fantasy-os/sync/season'
import { isSyncDue } from '@/lib/fantasy-os/sync/freshness'
import {
  runSync,
  type Clock,
  type Rng,
  type Sleep,
  type RunResult,
  type SyncScope,
} from '@/lib/fantasy-os/sync/runner'
import { createSleeperScopeFetcher } from './sleeperScopeFetcher'
import { createPrismaSleeperSyncStore } from './prismaSyncStore'
import { createAutomationSyncLock } from './automationSyncLock'
import { SLEEPER_SYNC_SCOPES, type SleeperSyncConnection } from './types'

const realClock: Clock = { now: () => new Date() }
const realRng: Rng = { next: () => Math.random() }
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Live provider load: fetch + normalize the current Sleeper league (read-only, keyless). Throws on hard failure. */
async function fetchNormalizedFromSleeper(externalLeagueId: string): Promise<NormalizedImportResult> {
  const result = await runImportedLeagueNormalizationPipeline({ provider: 'sleeper', sourceId: externalLeagueId })
  if (!result.success) throw new Error(`sleeper normalize failed: ${result.error}`)
  return result.normalized
}

/**
 * Memoize the fetch PROMISE so all scopes of a run share ONE provider burst — but ONLY while it is
 * in-flight or resolved. On rejection the slot is released so the runner's next retry performs a
 * genuinely NEW bounded provider attempt (transient failures can recover), while a resolved payload
 * stays shared so successful scopes never refetch. Provider load stays bounded by the runner's
 * `maxRetries`. The runner processes scopes sequentially, so there is no intra-run race on the slot.
 */
export function createMemoizedNormalizedLoader(
  fn: () => Promise<NormalizedImportResult>,
): () => Promise<NormalizedImportResult> {
  let memo: Promise<NormalizedImportResult> | null = null
  return () => {
    if (!memo) {
      const p = fn()
      memo = p
      // Fire-and-forget: release the slot on rejection. Does not change the returned promise, so the
      // caller still observes the original rejection and rethrows it up to the runner.
      p.then(undefined, () => {
        if (memo === p) memo = null
      })
    }
    return memo
  }
}

export interface SyncConnectedResult {
  runKey: string
  executed: boolean
  reason?: string
  seasonState: string
  cadenceMinutes: number
  due: boolean
  nextEligibleAt: string
  status?: RunResult['status']
  advancedFreshness?: boolean
  removed?: number
  notes?: string[]
  result?: RunResult
  warning?: string
}

export interface SyncConnectedDeps {
  /** Injectable normalized-payload loader (controlled fixture in tests). Default = live Sleeper. */
  fetchNormalized?: (externalLeagueId: string) => Promise<NormalizedImportResult>
  /** Bypass the cadence due-check (manual refresh). Default false. */
  force?: boolean
  /** Reconcile removals from complete authoritative responses. Default true. */
  reconcileRemovals?: boolean
  /** Overridable scope set (tests may add an immutable scope to exercise skip-refetch). */
  scopes?: SyncScope[]
  immutableScopes?: SyncScope[]
  clock?: Clock
  rng?: Rng
  sleep?: Sleep
  leaseMs?: number
  maxRetries?: number
  runTimeoutMs?: number
}

export async function syncConnectedSleeperLeague(
  connection: SleeperSyncConnection,
  now: Date,
  deps: SyncConnectedDeps = {},
): Promise<SyncConnectedResult> {
  const { state: seasonState, cadenceMinutes, warning } = resolveCadence({
    sport: connection.sport,
    provider: connection.provider,
    now,
  })

  const stateRow = await prisma.leagueSyncState.findUnique({
    where: { runKey: connection.runKey },
    select: { lastAttemptedSyncAt: true },
  })
  const lastAttempt = stateRow?.lastAttemptedSyncAt ? stateRow.lastAttemptedSyncAt.toISOString() : null
  const due = deps.force === true || isSyncDue(lastAttempt, cadenceMinutes, now)
  const nextEligibleAt = lastAttempt
    ? new Date(new Date(lastAttempt).getTime() + cadenceMinutes * 60_000).toISOString()
    : now.toISOString()

  const base = { runKey: connection.runKey, seasonState, cadenceMinutes, due, nextEligibleAt, warning }

  if (!due) {
    return { ...base, executed: false, reason: 'not due for this season cadence' }
  }

  const loadNormalized = createMemoizedNormalizedLoader(() =>
    (deps.fetchNormalized ?? fetchNormalizedFromSleeper)(connection.externalLeagueId),
  )
  const store = createPrismaSleeperSyncStore({
    connection,
    loadNormalized,
    reconcileRemovals: deps.reconcileRemovals ?? true,
  })
  const fetchScope = createSleeperScopeFetcher({ loadNormalized })
  const lock = createAutomationSyncLock()

  const result = await runSync({
    runKey: connection.runKey,
    seasonState,
    scopes: deps.scopes ?? (SLEEPER_SYNC_SCOPES as unknown as SyncScope[]),
    immutableScopes: deps.immutableScopes ?? [],
    lock,
    store,
    clock: deps.clock ?? realClock,
    rng: deps.rng ?? realRng,
    sleep: deps.sleep ?? realSleep,
    fetchScope,
    leaseMs: deps.leaseMs ?? 5 * 60_000,
    maxRetries: deps.maxRetries ?? 2,
    runTimeoutMs: deps.runTimeoutMs ?? 4 * 60_000,
  })

  return {
    ...base,
    executed: result.status !== 'locked',
    reason: result.status === 'locked' ? 'another executor holds the lock' : undefined,
    status: result.status,
    advancedFreshness: result.advancedFreshness,
    removed: store.removedTotal(),
    notes: store.notes,
    result,
  }
}
