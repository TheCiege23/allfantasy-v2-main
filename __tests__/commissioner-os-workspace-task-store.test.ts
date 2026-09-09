import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Commissioner Workspace's task store: what gets detected, and what the reconciler does with it.
 *
 * 🛑 EVERY ASSERTION HERE HAS BEEN SEEN TO FAIL. The repo's own rule — an assertion that has never
 * gone red is not evidence — bites unusually hard on this file, because the whole feature is a
 * scheduled job writing rows nobody watches. A green suite over a reconciler that silently
 * duplicated a task every run would look exactly like this one.
 *
 * The two properties worth the most are both easy to break and invisible in production:
 *
 *   - IDEMPOTENCE. The scan runs daily. A reconciler that inserted instead of updating would add
 *     365 copies of "your data is stale" a year, and the first symptom would be a commissioner's
 *     task list rather than a failing test.
 *   - `updatedAt` MEANING "THIS CHANGED", NOT "THE JOB RAN". Bumping it on every re-observation
 *     compiles, passes any test that only counts rows, and quietly destroys the one column a
 *     commissioner uses to see what is new.
 */

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  runFindFirst: vi.fn(),
  readActivityWindow: vi.fn(),
  readManagerActivity: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    commissionerWorkspaceTask: {
      findMany: mocks.findMany,
      create: mocks.create,
      update: mocks.update,
    },
    automationRun: { findFirst: mocks.runFindFirst },
  },
}))

vi.mock('@/lib/league-history/leagueWarehouseReads', () => ({
  readActivityWindow: mocks.readActivityWindow,
  readManagerActivity: mocks.readManagerActivity,
}))

import {
  detectInactiveManagers,
  detectNeverImported,
  detectOrphanTeams,
  detectStaleImport,
} from '@/lib/commissioner-workspace/taskSources'
import { hasEverBeenScanned, reconcileLeagueTasks, readLeagueTasks } from '@/lib/commissioner-workspace/taskStore'

const NOW = new Date('2026-09-08T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

function storedRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-1',
    leagueId: 'lg-1',
    sourceKey: 'data-stale:v1',
    title: 'League data has stopped arriving',
    description: 'old description',
    status: 'open',
    priority: 'elevated',
    dueAt: null,
    automationCandidate: true,
    relatedLinks: [],
    resolvedAt: null,
    autoResolvedAt: null,
    lastSeenAt: daysAgo(1),
    createdAt: daysAgo(5),
    updatedAt: daysAgo(5),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findMany.mockResolvedValue([])
  mocks.create.mockResolvedValue({})
  mocks.update.mockResolvedValue({})
  mocks.runFindFirst.mockResolvedValue(null)
  mocks.readManagerActivity.mockResolvedValue([])
})

describe('detectStaleImport', () => {
  it('says nothing while the feed is inside the inactivity threshold', () => {
    expect(detectStaleImport(daysAgo(13), 500, NOW)).toBeNull()
  })

  it('opens a finding once the feed is past it, and escalates past a month', () => {
    const warn = detectStaleImport(daysAgo(20), 500, NOW)
    expect(warn?.sourceKey).toBe('data-stale:v1')
    expect(warn?.priority).toBe('elevated')
    expect(warn?.description).toContain('20 days')

    expect(detectStaleImport(daysAgo(45), 500, NOW)?.priority).toBe('critical')
  })

  it('stays silent for a league that has never imported anything at all', () => {
    /*
     * "Your feed stopped" is a claim about a feed that started. A league with no imported events
     * has a different problem and a different fix, and reporting this one would send a
     * commissioner to re-run an import that has never run.
     */
    expect(detectStaleImport(null, 0, NOW)).toBeNull()
    expect(detectStaleImport(daysAgo(90), 0, NOW)).toBeNull()
  })
})

describe('detectNeverImported', () => {
  /*
   * The gap this detector was added to close. `detectStaleImport` declines a league with no events
   * ("your feed stopped" is a claim about a feed that started) and `detectInactiveManagers` needs a
   * `lastActivityAt` to gate on, so between them a connected league that has never sent anything got
   * no task at all. Measured on production 2026-09-09: 141 of 288 commissioned leagues.
   */
  it('opens a finding for a league that has never sent a single event', () => {
    const found = detectNeverImported(null, 0)
    expect(found?.sourceKey).toBe('never-imported:v1')
    expect(found?.priority).toBe('elevated')
    expect(found?.automationCandidate).toBe(true)
  })

  it('stays silent the moment any event has arrived', () => {
    expect(detectNeverImported(null, 1)).toBeNull()
    expect(detectNeverImported(daysAgo(400), 1)).toBeNull()
  })

  /*
   * 🛑 THE MUTUAL EXCLUSION WITH `detectStaleImport` IS THE POINT, NOT A DETAIL. A league with old
   * events is stale, not un-imported: it needs "your feed stopped", and a second task saying "you
   * have never imported" would be the same problem under a name that sends the commissioner somewhere
   * else. A timestamp with no events is a contradictory read and is treated as "something arrived".
   */
  it('never fires on a league that is merely stale', () => {
    expect(detectNeverImported(daysAgo(90), 500)).toBeNull()
    expect(detectStaleImport(daysAgo(90), 500, NOW)).not.toBeNull()

    expect(detectNeverImported(daysAgo(90), 0)).toBeNull()
  })
})

describe('detectOrphanTeams', () => {
  it('says nothing when every seat is filled', () => {
    expect(detectOrphanTeams(0, 12)).toBeNull()
  })

  it('reports a single vacancy in the singular, and does not claim the league is partial', () => {
    const found = detectOrphanTeams(1, 12)
    expect(found?.sourceKey).toBe('orphan-teams:v1')
    expect(found?.title).toBe('One team has no manager')
    expect(found?.priority).toBe('standard')
    // Never automated: who fills a seat is a judgement call about people.
    expect(found?.automationCandidate).toBe(false)
  })

  /*
   * A mostly-unclaimed league is a different situation from one seat to fill — it has probably not
   * finished being set up. The severity says so without claiming to know which it is, and the copy
   * warns that every per-manager figure elsewhere is partial.
   */
  it('escalates and reframes once half the league or more is unclaimed', () => {
    const half = detectOrphanTeams(6, 12)
    expect(half?.priority).toBe('elevated')
    expect(half?.description).toContain('6 of the 12')

    expect(detectOrphanTeams(5, 12)?.priority).toBe('standard')
  })

  it('does not divide by a total it does not have', () => {
    // totalTeams 0 means the roster read degraded; the vacancy is still real, the ratio is not.
    const found = detectOrphanTeams(3, 0)
    expect(found).not.toBeNull()
    expect(found?.priority).toBe('standard')
  })
})

describe('detectInactiveManagers', () => {
  const idle = [
    { managerName: 'Ada', currentCount: 0 },
    { managerName: 'Bo', currentCount: 4 },
  ]

  it('names the idle managers when the league data is current', () => {
    const found = detectInactiveManagers(idle, daysAgo(2), NOW)
    expect(found?.sourceKey).toBe('inactive-managers:v1')
    expect(found?.title).toContain('1 manager')
    expect(found?.description).toContain('Ada')
    expect(found?.description).not.toContain('Bo')
  })

  it('🛑 REFUSES TO FIRE ON A STALE LEAGUE, which is the whole correctness of this detector', () => {
    /*
     * Past the threshold every manager reads inactive because no events have arrived, so without
     * this gate the detector duplicates the stale-import finding under a name that blames people.
     * Deleting the gate leaves every other assertion in this file green.
     */
    expect(detectInactiveManagers(idle, daysAgo(30), NOW)).toBeNull()
  })

  it('reports everyone-idle as a fact about the league, not an accusation about its managers', () => {
    const all = [
      { managerName: 'Ada', currentCount: 0 },
      { managerName: 'Bo', currentCount: 0 },
    ]
    const found = detectInactiveManagers(all, daysAgo(2), NOW)
    expect(found?.title).toBe('No manager has acted in the last two weeks')
    expect(found?.priority).toBe('advisory')
    expect(found?.description).not.toContain('Ada')
  })

  it('says nothing when everyone has been active', () => {
    expect(detectInactiveManagers([{ managerName: 'Ada', currentCount: 3 }], daysAgo(2), NOW)).toBeNull()
  })
})

describe('reconcileLeagueTasks', () => {
  it('opens a row the first time a condition is seen', async () => {
    mocks.readActivityWindow.mockResolvedValue({ lastActivityAt: daysAgo(20), tradeCount: 0, waiverCount: 0, eventCount: 400 })

    const outcome = await reconcileLeagueTasks('lg-1', NOW)

    expect(outcome.opened).toBe(1)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const created = mocks.create.mock.calls[0][0].data
    expect(created.sourceKey).toBe('data-stale:v1')
    expect(created.status).toBe('open')
    expect(created.createdAt).toEqual(NOW)
  })

  it('🛑 RE-RUNNING ADDS NOTHING — one row per condition, however many times the job fires', async () => {
    mocks.readActivityWindow.mockResolvedValue({ lastActivityAt: daysAgo(20), tradeCount: 0, waiverCount: 0, eventCount: 400 })
    // Same description the detector produces for a 20-day-old feed, so nothing has visibly changed.
    const detected = detectStaleImport(daysAgo(20), 400, NOW)!
    mocks.findMany.mockResolvedValue([storedRow({ description: detected.description, title: detected.title })])

    const outcome = await reconcileLeagueTasks('lg-1', NOW)

    expect(mocks.create).not.toHaveBeenCalled()
    expect(outcome.opened).toBe(0)
    expect(outcome.unchanged).toBe(1)
  })

  it('⚠ moves lastSeenAt WITHOUT moving updatedAt when nothing a commissioner would notice changed', async () => {
    mocks.readActivityWindow.mockResolvedValue({ lastActivityAt: daysAgo(20), tradeCount: 0, waiverCount: 0, eventCount: 400 })
    const detected = detectStaleImport(daysAgo(20), 400, NOW)!
    mocks.findMany.mockResolvedValue([storedRow({ description: detected.description, title: detected.title })])

    await reconcileLeagueTasks('lg-1', NOW)

    const patch = mocks.update.mock.calls[0][0].data
    expect(patch).toEqual({ lastSeenAt: NOW })
    expect(patch).not.toHaveProperty('updatedAt')
  })

  it('moves updatedAt when the finding itself changed — here, severity escalating with age', async () => {
    mocks.readActivityWindow.mockResolvedValue({ lastActivityAt: daysAgo(45), tradeCount: 0, waiverCount: 0, eventCount: 400 })
    mocks.findMany.mockResolvedValue([storedRow({ priority: 'elevated' })])

    const outcome = await reconcileLeagueTasks('lg-1', NOW)

    expect(outcome.changed).toBe(1)
    const patch = mocks.update.mock.calls[0][0].data
    expect(patch.priority).toBe('critical')
    expect(patch.updatedAt).toEqual(NOW)
  })

  it('closes a task on its own once the condition stops being true', async () => {
    // A fresh feed and active managers: neither detector fires, so the stored row is stale work.
    mocks.readActivityWindow.mockResolvedValue({ lastActivityAt: daysAgo(1), tradeCount: 2, waiverCount: 3, eventCount: 400 })
    mocks.readManagerActivity.mockResolvedValue([{ managerName: 'Ada', currentCount: 5 }])
    mocks.findMany.mockResolvedValue([storedRow()])

    const outcome = await reconcileLeagueTasks('lg-1', NOW)

    expect(outcome.autoResolved).toBe(1)
    const patch = mocks.update.mock.calls[0][0].data
    expect(patch.status).toBe('completed')
    // Separate from resolvedAt, so "this stopped being true" never reads as "you fixed this".
    expect(patch.autoResolvedAt).toEqual(NOW)
    expect(patch).not.toHaveProperty('resolvedAt')
  })

  it('🛑 NEVER REOPENS SOMETHING A COMMISSIONER ARCHIVED, even while the condition persists', async () => {
    mocks.readActivityWindow.mockResolvedValue({ lastActivityAt: daysAgo(45), tradeCount: 0, waiverCount: 0, eventCount: 400 })
    mocks.findMany.mockResolvedValue([storedRow({ status: 'archived', priority: 'elevated' })])

    const outcome = await reconcileLeagueTasks('lg-1', NOW)

    expect(outcome.opened).toBe(0)
    // The condition is still recorded as seen — it is not lost — but their decision stands.
    expect(mocks.update.mock.calls[0][0].data).toEqual({ lastSeenAt: NOW })
    expect(outcome.autoResolved).toBe(0)
  })

  it('skips the manager read entirely on a stale league rather than filtering its answer away', async () => {
    mocks.readActivityWindow.mockResolvedValue({ lastActivityAt: daysAgo(20), tradeCount: 0, waiverCount: 0, eventCount: 400 })

    await reconcileLeagueTasks('lg-1', NOW)

    expect(mocks.readManagerActivity).not.toHaveBeenCalled()
  })
})

describe('readLeagueTasks', () => {
  it('puts live work above settled work, newest first inside each', async () => {
    mocks.findMany.mockResolvedValue([
      storedRow({ id: 'done-new', sourceKey: 'a', status: 'completed', createdAt: daysAgo(1) }),
      storedRow({ id: 'open-old', sourceKey: 'b', status: 'open', createdAt: daysAgo(9) }),
      storedRow({ id: 'open-new', sourceKey: 'c', status: 'waiting_on_manager', createdAt: daysAgo(2) }),
    ])

    const rows = await readLeagueTasks('lg-1')

    expect(rows.map((r) => r.id)).toEqual(['open-new', 'open-old', 'done-new'])
  })

  it('drops a related link that is not a well-formed {label, moduleId, href}', async () => {
    // The column is JSONB, so anything can be in it; a half-built link must not reach the view.
    mocks.findMany.mockResolvedValue([
      storedRow({ relatedLinks: [{ label: 'ok', moduleId: 'analytics', href: '/a' }, { label: 'broken' }, 'nope'] }),
    ])

    const rows = await readLeagueTasks('lg-1')

    expect(rows[0].relatedLinks).toEqual([{ label: 'ok', moduleId: 'analytics', href: '/a' }])
  })
})

describe('hasEverBeenScanned', () => {
  it('🛑 ANSWERS FROM THE RUN LEDGER, because a healthy league writes no task rows to answer from', async () => {
    mocks.runFindFirst.mockResolvedValue({ id: 'run-1' })
    await expect(hasEverBeenScanned('lg-1')).resolves.toBe(true)

    const where = mocks.runFindFirst.mock.calls[0][0].where
    expect(where.jobType).toBe('workspace.refreshTasks')
    expect(where.leagueId).toBe('lg-1')

    mocks.runFindFirst.mockResolvedValue(null)
    await expect(hasEverBeenScanned('lg-1')).resolves.toBe(false)
  })
})
