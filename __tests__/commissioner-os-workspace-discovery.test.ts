import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which leagues the daily Workspace scan picks, and in what order.
 *
 * 🛑 THE ORDERING IS THE ENTIRE CORRECTNESS OF THIS FILE, and the failure it guards against is one
 * that no smaller test would catch: with a `limit` in play, ordering by DATA STALENESS starves
 * every healthy league permanently. The stalest N sort to the front every day, so they are the only
 * ones ever scanned; a healthy league is never reached, its findings never auto-resolve, and
 * `hasEverBeenScanned` stays false — so its commissioner sees "not scanned yet" forever.
 *
 * That version passes every test with fewer leagues than the limit, and in production it starves
 * exactly the leagues that have nothing to report, so nobody complains. The fixture below is
 * therefore deliberately LARGER than the limit — a smaller one cannot see the bug at all.
 */

const mocks = vi.hoisted(() => ({
  activityGroupBy: vi.fn(),
  runGroupBy: vi.fn(),
  isLiveReady: vi.fn(),
  runAutomationJob: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    decisionOsImportedActivity: { groupBy: mocks.activityGroupBy },
    automationRun: { groupBy: mocks.runGroupBy },
  },
}))

vi.mock('@/lib/commissioner-ui/liveReadiness', () => ({ isLiveReady: mocks.isLiveReady }))
vi.mock('@/lib/automation/engine', () => ({ runAutomationJob: mocks.runAutomationJob }))
vi.mock('@/lib/automation/locks', () => ({ withAutomationLock: vi.fn() }))
vi.mock('@/lib/commissioner-workspace/taskStore', () => ({ reconcileLeagueTasks: vi.fn() }))

import { discoverWorkspaceRefreshLeagues } from '@/lib/automation/jobs/workspace/discoverWorkspaceRefreshLeagues'
import { refreshWorkspaceTasksBatch } from '@/lib/automation/jobs/workspace/refreshWorkspaceTasksJob'

const NOW = new Date('2026-09-08T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runGroupBy.mockResolvedValue([])
  mocks.isLiveReady.mockResolvedValue(true)
  mocks.runAutomationJob.mockResolvedValue({ status: 'completed', jobId: 'j', runId: 'r' })
})

describe('discoverWorkspaceRefreshLeagues', () => {
  it('🛑 ROTATES so a healthy league is reached even though a staler one exists', async () => {
    mocks.activityGroupBy.mockResolvedValue([
      // Very stale, but scanned today — it has had its turn.
      { afLeagueId: 'stale-but-done', _max: { occurredAt: daysAgo(90) } },
      // Perfectly healthy, and nobody has looked at it in a week.
      { afLeagueId: 'healthy-overdue', _max: { occurredAt: daysAgo(1) } },
    ])
    mocks.runGroupBy.mockResolvedValue([
      { leagueId: 'stale-but-done', _max: { startedAt: daysAgo(0) } },
      { leagueId: 'healthy-overdue', _max: { startedAt: daysAgo(7) } },
    ])

    const due = await discoverWorkspaceRefreshLeagues({ limit: 1, now: NOW })

    /*
     * Under the starvation bug this returns `stale-but-done` — the stalest data — and would keep
     * returning it every day while `healthy-overdue` was never scanned again.
     */
    expect(due.map((d) => d.leagueId)).toEqual(['healthy-overdue'])
  })

  it('puts a never-scanned league ahead of every scanned one, however fresh its data', async () => {
    mocks.activityGroupBy.mockResolvedValue([
      { afLeagueId: 'scanned-long-ago', _max: { occurredAt: daysAgo(60) } },
      { afLeagueId: 'never-scanned', _max: { occurredAt: daysAgo(1) } },
    ])
    mocks.runGroupBy.mockResolvedValue([{ leagueId: 'scanned-long-ago', _max: { startedAt: daysAgo(30) } }])

    const due = await discoverWorkspaceRefreshLeagues({ limit: 2, now: NOW })

    // A league nobody has scanned is showing its commissioner an error right now; that outranks
    // re-checking one we already have an answer for, even a very old answer.
    expect(due.map((d) => d.leagueId)).toEqual(['never-scanned', 'scanned-long-ago'])
    expect(due[0].lastScannedAt).toBeNull()
  })

  it('breaks a tie between equally-overdue leagues by data staleness', async () => {
    mocks.activityGroupBy.mockResolvedValue([
      { afLeagueId: 'fresher', _max: { occurredAt: daysAgo(2) } },
      { afLeagueId: 'staler', _max: { occurredAt: daysAgo(40) } },
    ])
    // Neither has ever been scanned, so the scan clock cannot separate them.
    const due = await discoverWorkspaceRefreshLeagues({ limit: 2, now: NOW })

    expect(due.map((d) => d.leagueId)).toEqual(['staler', 'fresher'])
  })

  it('every league eventually reaches the front — the property the limit must not break', async () => {
    /*
     * The real shape: more leagues than one batch can hold. Simulated over enough days to cover
     * them all, feeding each run's picks back in as scan times. Under stalest-first this loops on
     * the same slice forever and the assertion below fails with most leagues never seen.
     */
    const leagues = Array.from({ length: 10 }, (_, i) => `lg-${i}`)
    const scanned = new Map<string, Date>()

    mocks.activityGroupBy.mockResolvedValue(
      // Deliberately anti-correlated with rotation: lg-0 is the stalest and would hog every batch.
      leagues.map((id, i) => ({ afLeagueId: id, _max: { occurredAt: daysAgo(90 - i * 9) } })),
    )

    const seen = new Set<string>()
    for (let day = 0; day < 5; day += 1) {
      const at = new Date(NOW.getTime() + day * 86_400_000)
      mocks.runGroupBy.mockResolvedValue(
        [...scanned.entries()].map(([leagueId, startedAt]) => ({ leagueId, _max: { startedAt } })),
      )
      const due = await discoverWorkspaceRefreshLeagues({ limit: 2, now: at })
      for (const row of due) {
        seen.add(row.leagueId)
        scanned.set(row.leagueId, at)
      }
    }

    expect([...seen].sort()).toEqual([...leagues].sort())
  })

  it('drops a row with no league id or no activity rather than scanning something it cannot name', async () => {
    mocks.activityGroupBy.mockResolvedValue([
      { afLeagueId: null, _max: { occurredAt: daysAgo(1) } },
      { afLeagueId: 'lg-1', _max: { occurredAt: null } },
      { afLeagueId: 'lg-2', _max: { occurredAt: daysAgo(3) } },
    ])

    const due = await discoverWorkspaceRefreshLeagues({ limit: 10, now: NOW })

    expect(due.map((d) => d.leagueId)).toEqual(['lg-2'])
  })

  it('gives one league per day one idempotency key, and a different one tomorrow', async () => {
    mocks.activityGroupBy.mockResolvedValue([{ afLeagueId: 'lg-1', _max: { occurredAt: daysAgo(1) } }])

    const today = await discoverWorkspaceRefreshLeagues({ now: NOW })
    const laterToday = await discoverWorkspaceRefreshLeagues({ now: new Date('2026-09-08T23:59:00.000Z') })
    const tomorrow = await discoverWorkspaceRefreshLeagues({ now: new Date('2026-09-09T00:01:00.000Z') })

    // Two dispatches on the same day must collapse to one run; the next day is real new work.
    expect(laterToday[0].idempotencyKey).toBe(today[0].idempotencyKey)
    expect(tomorrow[0].idempotencyKey).not.toBe(today[0].idempotencyKey)
  })
})

describe('refreshWorkspaceTasksBatch — the readiness gate', () => {
  it('🛑 WRITES NOTHING, AND DISCOVERS NOTHING, WHILE THE MODULE IS NOT LIVE-READY', async () => {
    /*
     * The table this job writes arrives in a migration that is not applied. Code shipping ahead of
     * its migration does not no-op — a missing table is Prisma P2021 — so the gate has to stop the
     * work before the first query, not filter its results afterwards.
     */
    mocks.isLiveReady.mockResolvedValue(false)
    mocks.activityGroupBy.mockResolvedValue([{ afLeagueId: 'lg-1', _max: { occurredAt: daysAgo(40) } }])

    const result = await refreshWorkspaceTasksBatch({ limit: 10, now: NOW })

    expect(result.enabled).toBe(false)
    expect(result.discovered).toBe(0)
    expect(mocks.activityGroupBy).not.toHaveBeenCalled()
    expect(mocks.runAutomationJob).not.toHaveBeenCalled()
  })

  it('⚠ reports `enabled` so a gated run cannot be mistaken for a healthy empty one', async () => {
    // Both produce discovered: 0 — the flag is the only thing that separates "switched off" from
    // "every league is healthy", and the freshness monitor reads exactly this.
    mocks.isLiveReady.mockResolvedValue(true)
    mocks.activityGroupBy.mockResolvedValue([])

    const result = await refreshWorkspaceTasksBatch({ limit: 10, now: NOW })

    expect(result).toMatchObject({ enabled: true, discovered: 0 })
  })

  it('runs each discovered league through the automation engine', async () => {
    mocks.activityGroupBy.mockResolvedValue([
      { afLeagueId: 'lg-1', _max: { occurredAt: daysAgo(40) } },
      { afLeagueId: 'lg-2', _max: { occurredAt: daysAgo(20) } },
    ])

    const result = await refreshWorkspaceTasksBatch({ limit: 10, now: NOW })

    expect(result.discovered).toBe(2)
    expect(result.completed).toBe(2)
    expect(mocks.runAutomationJob).toHaveBeenCalledTimes(2)
    // Every run is filed under the one job type, so the Automation Center reads a single ledger.
    expect(mocks.runAutomationJob.mock.calls.map((c) => c[0].jobType)).toEqual([
      'workspace.refreshTasks',
      'workspace.refreshTasks',
    ])
  })
})
