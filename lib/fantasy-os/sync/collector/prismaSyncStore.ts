/**
 * Fantasy OS — Prisma-backed `SyncStore` for the durable Sleeper collector.
 *
 * Persists durable per-connection sync state to the MAIN application database (so the dashboard and
 * analytical consumers see fresh data), NOT the separate `fos_phase4` executive portfolio DB:
 *   - per-scope checkpoints + certified freshness live on `LeagueSyncState` (keyed by run key),
 *   - `persistScope` applies each scope to EVERY canonical `League` row that mirrors the connection
 *     via the idempotent, claim-preserving `applySleeperScopeToLeague`,
 *   - `recordRun` writes a `SyncJobRun` telemetry row and stamps `League.syncStatus`/`syncError`,
 *   - `setLastSuccessfulSyncAt` advances freshness ONLY on a fully completed run (runner-enforced),
 *     stamping every mirror row's `League.lastSyncedAt`.
 */
import { prisma } from '@/lib/prisma'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import type { RunResult, SyncStore, SyncScope } from '@/lib/fantasy-os/sync/runner'
import { applySleeperScopeToLeague } from './applySleeperLeagueSync'
import { resolveLeagueIdsForConnection } from './enumerate'
import type { ApplyScopeResult, SleeperSyncConnection, SleeperSyncScope } from './types'

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export interface PrismaSleeperSyncStore extends SyncStore {
  /** Per-run apply notes (removals, empty-guard engagements) accumulated for telemetry. */
  readonly notes: string[]
  removedTotal(): number
}

export function createPrismaSleeperSyncStore(deps: {
  connection: SleeperSyncConnection
  loadNormalized: () => Promise<NormalizedImportResult>
  reconcileRemovals: boolean
}): PrismaSleeperSyncStore {
  const { connection } = deps
  const notes: string[] = []
  let removed = 0

  async function ensureRow(): Promise<{ checkpoints: Record<string, unknown>; consecutiveFailures: number }> {
    const row = await prisma.leagueSyncState.upsert({
      where: { runKey: connection.runKey },
      create: {
        runKey: connection.runKey,
        provider: connection.provider,
        externalLeagueId: connection.externalLeagueId,
        season: connection.season,
        sport: connection.sport,
      },
      update: {},
      select: { checkpoints: true, consecutiveFailures: true },
    })
    return { checkpoints: asRecord(row.checkpoints), consecutiveFailures: row.consecutiveFailures }
  }

  return {
    notes,
    removedTotal: () => removed,

    async getCheckpoint(_runKey: string, scope: SyncScope): Promise<string | null> {
      const row = await prisma.leagueSyncState.findUnique({
        where: { runKey: connection.runKey },
        select: { checkpoints: true },
      })
      const cp = asRecord(row?.checkpoints)[scope]
      return typeof cp === 'string' ? cp : null
    },

    async saveCheckpoint(_runKey: string, scope: SyncScope, checkpoint: string): Promise<void> {
      const { checkpoints } = await ensureRow()
      checkpoints[scope] = checkpoint
      await prisma.leagueSyncState.update({
        where: { runKey: connection.runKey },
        data: { checkpoints: checkpoints as object },
      })
    },

    async persistScope(
      _runKey: string,
      scope: SyncScope,
      _records: { id: string }[],
    ): Promise<{ imported: number; unchanged: number; rejected: number }> {
      const normalized = await deps.loadNormalized()
      const leagues = await resolveLeagueIdsForConnection(connection)
      let agg: ApplyScopeResult = { imported: 0, unchanged: 0, rejected: 0, removed: 0, notes: [] }
      for (const l of leagues) {
        const r = await applySleeperScopeToLeague({
          leagueId: l.id,
          scope: scope as SleeperSyncScope,
          normalized,
          options: { reconcileRemovals: deps.reconcileRemovals },
        })
        agg = {
          imported: agg.imported + r.imported,
          unchanged: agg.unchanged + r.unchanged,
          rejected: agg.rejected + r.rejected,
          removed: agg.removed + r.removed,
          notes: [...agg.notes, ...r.notes],
        }
      }
      removed += agg.removed
      for (const n of agg.notes) notes.push(`[${scope}] ${n}`)
      return { imported: agg.imported, unchanged: agg.unchanged, rejected: agg.rejected }
    },

    async setLastSuccessfulSyncAt(_runKey: string, iso: string): Promise<void> {
      // `iso` is AllFantasy's successful-collection time — recorded ONLY as `lastSuccessfulSyncAt`.
      // `sourceDataTimestamp` is reserved for a genuine provider-reported source time and is left
      // null until one is reliably available (Sleeper exposes no dependable per-league data mtime),
      // so AF execution time is never misfiled under a provider-source name.
      await prisma.leagueSyncState.update({
        where: { runKey: connection.runKey },
        data: { lastSuccessfulSyncAt: new Date(iso) },
      }).catch(() => undefined)
      // Stamp every mirror row's freshness (dashboard reads League.lastSyncedAt/syncStatus).
      await prisma.league.updateMany({
        where: {
          platform: connection.provider,
          platformLeagueId: connection.externalLeagueId,
          season: connection.season,
        },
        data: { lastSyncedAt: new Date(iso), syncStatus: 'synced', syncError: null },
      }).catch(() => undefined)
    },

    async recordRun(result: RunResult): Promise<void> {
      const succeeded = result.status === 'completed'
      const failedOrPartial = result.status === 'failed' || result.status === 'partial'
      const { consecutiveFailures } = await ensureRow()
      const nextFailures = succeeded ? 0 : failedOrPartial ? consecutiveFailures + 1 : consecutiveFailures
      const lastError = failedOrPartial ? (result.warnings[0] ?? `run ${result.status}`) : null

      await prisma.leagueSyncState.update({
        where: { runKey: connection.runKey },
        data: {
          seasonState: result.seasonState,
          syncStatus: result.status,
          completedScopes: result.completedScopes as object,
          incompleteScopes: result.incompleteScopes as object,
          lastRunAccounting: { ...result.accounting, removed } as object,
          lastAttemptedSyncAt: new Date(result.startedAt),
          consecutiveFailures: nextFailures,
          lastError,
        },
      }).catch(() => undefined)

      // Unified sync telemetry (DB-first observability) — one row per run.
      const durationMs = Math.max(0, new Date(result.finishedAt).getTime() - new Date(result.startedAt).getTime())
      const job = await prisma.syncJobRun.create({
        data: {
          jobName: 'fantasy-os-sleeper-sync',
          jobScope: connection.runKey,
          trigger: 'cron',
          status: result.status,
          rowsRead: result.accounting.logicalRequests,
          rowsWritten: result.accounting.imported,
          rowsSkipped: result.accounting.unchanged,
          durationMs,
          errorMessage: lastError,
          completedAt: new Date(result.finishedAt),
          metadata: {
            completedScopes: result.completedScopes,
            incompleteScopes: result.incompleteScopes,
            advancedFreshness: result.advancedFreshness,
            removed,
            notes: notes.slice(0, 25),
            accounting: result.accounting,
          } as object,
        },
      }).catch(() => null)

      if (job?.id) {
        await prisma.leagueSyncState.update({
          where: { runKey: connection.runKey },
          data: { lastRunId: job.id.slice(0, 64) },
        }).catch(() => undefined)
      }

      // Reflect failure/partiality on the mirror rows so the dashboard can surface honest freshness.
      if (failedOrPartial) {
        await prisma.league.updateMany({
          where: {
            platform: connection.provider,
            platformLeagueId: connection.externalLeagueId,
            season: connection.season,
          },
          data: { syncStatus: result.status, syncError: lastError },
        }).catch(() => undefined)
      }
    },
  }
}
