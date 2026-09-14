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
import type { RunResult, SyncStore, SyncScope } from '@/lib/import-os/runner'
import { applySleeperScopeToLeague } from './applySleeperLeagueSync'
import { resolveLeagueIdsForConnection } from './enumerate'
import { LEAGUE_GONE_ERROR_PREFIX } from './leagueGone'
import type { ApplyScopeResult, SleeperSyncConnection, SleeperSyncScope } from './types'

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export interface PrismaSleeperSyncStore extends SyncStore {
  /** Per-run apply notes (removals, empty-guard engagements) accumulated for telemetry. */
  readonly notes: string[]
  removedTotal(): number
  /**
   * Leagues whose rosters this run changed (created, changed or reconciled away). The cron route
   * refreshes their `RedraftRosterPlayer` rows afterwards; see `refreshRedraftRosterPlayersAfterSync`.
   */
  rosterChangedLeagueIds(): string[]
}

export function createPrismaSleeperSyncStore(deps: {
  connection: SleeperSyncConnection
  loadNormalized: () => Promise<NormalizedImportResult>
  reconcileRemovals: boolean
}): PrismaSleeperSyncStore {
  const { connection } = deps
  const notes: string[] = []
  let removed = 0
  const rosterChanged = new Set<string>()

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
    rosterChangedLeagueIds: () => [...rosterChanged],

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
        /*
         * ⚠ RECORDED, NOT ACTED ON. A changed roster leaves `RedraftRosterPlayer` behind it, but
         * materializing here would spend this connection's run budget on enrichment. `unchanged`
         * rosters are skipped on purpose: nothing moved, so nothing is newly stale.
         */
        if (scope === 'teams_rosters' && (r.imported > 0 || r.removed > 0)) rosterChanged.add(l.id)
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
      /*
       * The provider said the league does not exist (see ./leagueGone). Not a failure — a failure
       * count against a provider answering correctly drives backoff and alerting at nothing — but
       * the prefixed note is what the due check and both selectors read to stop re-asking.
       */
      const leagueGone = result.status === 'skipped' && typeof result.terminalError === 'string'
      const { consecutiveFailures } = await ensureRow()
      const nextFailures = succeeded ? 0 : failedOrPartial ? consecutiveFailures + 1 : consecutiveFailures
      const lastError = failedOrPartial
        ? (result.warnings[0] ?? `run ${result.status}`)
        : leagueGone
          ? `${LEAGUE_GONE_ERROR_PREFIX}${result.terminalError}`
          : null

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
          /*
           * 🛑 MAPPED HERE, AT THE WRITE SITE, AND EMPHATICALLY NOT AT `result.status`.
           *
           * `sync_job_runs.status` carried two words for "fine": `syncJobRunTelemetry` types it
           * `success | partial | failed` and is the only writer that does, while this one and two
           * others emitted `completed`. The history was normalised to `success` on 2026-09-06
           * (27,277 rows) and this keeps new rows consistent with it.
           *
           * ⚠ `result.status` FEEDS THREE COLUMNS FROM THIS FILE, AND ONLY THIS ONE MAY CHANGE:
           *
           *     :136   leagueSyncState.syncStatus
           *     here   sync_job_runs.status
           *     :186   League.syncStatus  (failure path)
           *
           * `verdictFrom` in lib/decision-os/import/assertions.ts maps `leagueSyncState.syncStatus
           * === 'completed'` to the parity verdict `matched`, and ANY unrecognised value falls
           * through to `unchecked`. Renaming at the source would therefore turn every synced
           * league's parity from "matched" into "never checked" — silently, with no error and no
           * failing test. That file's own comment calls an unearned verdict its worst failure
           * mode; this would be the mirror image of it, an unearned "unchecked".
           */
          status: result.status === 'completed' ? 'success' : result.status,
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
      /*
       * ⚠ A GONE LEAGUE STAYS `failed` ON `League`, deliberately unlike `leagueSyncState`. To a
       * manager the league cannot refresh, and the surfaces that flag that (`formatHubs` reads
       * `includes('fail')`) should keep doing so; only the collector's own bookkeeping changes.
       */
      if (failedOrPartial || leagueGone) {
        await prisma.league.updateMany({
          where: {
            platform: connection.provider,
            platformLeagueId: connection.externalLeagueId,
            season: connection.season,
          },
          data: { syncStatus: leagueGone ? 'failed' : result.status, syncError: lastError },
        }).catch(() => undefined)
      }
    },
  }
}
