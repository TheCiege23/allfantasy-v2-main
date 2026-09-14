import { runActiveSyncLane } from './activeSyncLane'
import { refreshRedraftRosterPlayersAfterSync } from './refreshRedraftRosterPlayersAfterSync'
import { recordSyncJobRun, withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

export const ACTIVE_SYNC_JOB = 'cron-fantasy-os-active-sync'

/** Shared by the manual route and the existing five-minute notification heartbeat. */
export async function runActiveSyncHeartbeat(limitPerProvider = 4) {
  if (process.env.FANTASY_OS_EXEC_SYNC_LIVE !== 'true') {
    await recordSyncJobRun(
      { jobName: ACTIVE_SYNC_JOB, provider: 'multi', trigger: 'cron' },
      { status: 'success', rowsRead: 0, rowsWritten: 0, metadata: { enabled: false } },
      0,
    )
    return { executed: false as const, reason: 'live sync disabled' }
  }

  const payload = await withSyncJobRun(
    { jobName: ACTIVE_SYNC_JOB, provider: 'multi', trigger: 'cron' },
    async () => {
      const summary = await runActiveSyncLane({ limitPerProvider })
      const rosterRefresh = summary.executed > 0
        ? await refreshRedraftRosterPlayersAfterSync({
            results: summary.results,
            maxLeagues: 8,
            budgetMs: 25_000,
          }).catch((error) => ({ error: error instanceof Error ? error.message : 'roster refresh failed' }))
        : { skipped: true, reason: 'no league sync executed' }
      return { summary, rosterRefresh }
    },
    ({ summary, rosterRefresh }) => ({
      status: summary.failed > 0 || summary.errored > 0 ? 'partial' : 'success',
      rowsRead: summary.selected,
      rowsWritten: summary.completed,
      rowsSkipped: summary.notDue + summary.locked + summary.skipped,
      metadata: {
        enabled: true,
        cadenceMinutes: 5,
        scopes: ['transactions', 'teams_rosters'],
        eligible: summary.eligible,
        selected: summary.selected,
        recentlyViewedSelected: summary.recentlyViewedSelected,
        byProvider: summary.byProvider,
        rosterRefresh,
      },
    }),
  )

  return { executed: true as const, ...payload }
}
