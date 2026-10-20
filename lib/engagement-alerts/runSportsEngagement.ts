import { randomUUID } from 'node:crypto'
import { acquireAutomationLock, releaseAutomationLock } from '@/lib/automation/locks'
import { rotateForFairness } from '@/lib/cron/runBudget'
import { SUPPORTED_SPORTS, LIVE_ONLY_SPORTS } from '@/lib/sport-scope'
import { getLiveScoresForSport, resolveGameState } from '@/lib/sports-live-scores-service'
import { engagementGameDetail } from './ingestGameDetail'
import { observeGameAlerts, sportAlertAudience } from '@/lib/engagement-alerts/gameAlertService'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

export async function runSportsEngagement() {
  const owner = randomUUID()
  const lock = await acquireAutomationLock('sports-engagement', { owner, ttlMs: 120_000 })
  if (!lock.ok) return { games: 0, delivered: 0, errors: [], skipped: lock.reason }
  try {
    const started = Date.now()
    const report = await withSyncJobRun({ jobName: 'cron-sports-engagement', trigger: 'cron', provider: 'espn_live', sport: 'ALL' }, async () => {
      const errors: string[] = []
      let games = 0
      let delivered = 0
      // Sport work runs concurrently, so a slow football feed cannot starve another sport.
      await Promise.all([...SUPPORTED_SPORTS, ...LIVE_ONLY_SPORTS].map(async sport => {
        try {
          const users = await sportAlertAudience(sport)
          if (!users.length) return
          const slate = await getLiveScoresForSport({ sport, forceRefresh: true })
          // Summary ids belong to ESPN. Never send an RI game id to an ESPN endpoint.
          if (slate.source !== 'espn_live') { errors.push(`${sport}: ESPN scoreboard unavailable`); return }
          const queue = rotateForFairness(slate.scores.filter(g => {
            const state = resolveGameState(g.status)
            const untilStart = Date.parse(g.startTime) - Date.now()
            return state === 'in_progress' || state === 'final' && untilStart > -12 * 3600_000 ||
              state === 'scheduled' && untilStart <= 30 * 60_000 && untilStart >= -60 * 60_000
          }), 60_000)
          // Bounded per-sport concurrency, with no truncation of the slate.
          let index = 0
          await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
            while (index < queue.length) {
              if (Date.now() - started > 35_000) { errors.push(`${sport}: remaining games deferred to next tick`); break }
              const game = queue[index++]!
              try {
                const summary = await engagementGameDetail(sport, game.gameId)
                delivered += await observeGameAlerts(sport, game, summary.failed || summary.stale ? null : summary.detail, users)
                if (summary.failed) errors.push(`${sport}/${game.gameId}: play feed unavailable`)
                games++
              } catch (e) { errors.push(`${sport}/${game.gameId}: ${e instanceof Error ? e.message : String(e)}`) }
            }
          }))
        } catch (e) { errors.push(`${sport}: ${e instanceof Error ? e.message : String(e)}`) }
      }))
      return { games, delivered, errors }
    }, r => ({ rowsRead: r.games, rowsUpdated: r.delivered, status: r.errors.length ? 'partial' : 'success', metadata: { errors: r.errors } }))
    return report
  } finally { await releaseAutomationLock('sports-engagement', owner) }
}
