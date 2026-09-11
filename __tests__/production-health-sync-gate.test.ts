import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `syncGate` in the admin import-health view.
 *
 * The heartbeat at `/api/cron/fantasy-os-exec-sync` no-ops unless
 * `FANTASY_OS_EXEC_SYNC_LIVE === 'true'` AND RETURNS 200 WHEN IT DOES, so a
 * disabled sync is indistinguishable from a working one everywhere else in the
 * product. These tests pin the three operator states apart, pin that the raw
 * value never leaves the process, and pin the two combinations that matter
 * operationally: an open gate with no runs (a dead scheduler) against a closed
 * gate that is still firing (deliberately idle).
 */

vi.mock('server-only', () => ({}))

const findManyMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    syncJobRun: { findMany: findManyMock },
    providerSyncState: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

const ENV = 'FANTASY_OS_EXEC_SYNC_LIVE'

describe('production health: sync gate', () => {
  const original = process.env[ENV]

  beforeEach(() => {
    vi.clearAllMocks()
    findManyMock.mockResolvedValue([])
  })

  afterEach(() => {
    if (original === undefined) delete process.env[ENV]
    else process.env[ENV] = original
    vi.resetModules()
  })

  async function status() {
    const { getImportStatus } = await import('@/lib/production-health/ProductionHealthService')
    return (await getImportStatus()).syncGate
  }

  it('reports unset as not configured and not enabled', async () => {
    delete process.env[ENV]
    const g = await status()
    expect(g.configured).toBe(false)
    expect(g.enabled).toBe(false)
    expect(g.recognized).toBe(true)
  })

  /*
   * The distinction that matters operationally: "nobody set it" and "somebody
   * deliberately turned it off" are different situations with different fixes,
   * and a single `enabled: false` cannot tell them apart.
   */
  it('separates a deliberate false from an unset variable', async () => {
    process.env[ENV] = 'false'
    const g = await status()
    expect(g.configured).toBe(true)
    expect(g.enabled).toBe(false)
    expect(g.recognized).toBe(true)
  })

  it('enables only on the exact string true', async () => {
    process.env[ENV] = 'true'
    const g = await status()
    expect(g.configured).toBe(true)
    expect(g.enabled).toBe(true)
    expect(g.recognized).toBe(true)
  })

  /*
   * 'TRUE' is the operator meaning to switch it on and silently failing. Without
   * `recognized` this renders identically to a deliberate disable, and the
   * person who typed it has no way to find out.
   */
  it.each(['TRUE', 'True', '1', 'yes', 'on', ' true', ''])(
    'flags %o as present but unrecognized',
    async (value) => {
      process.env[ENV] = value
      const g = await status()
      expect(g.configured).toBe(true)
      expect(g.enabled).toBe(false)
      expect(g.recognized).toBe(false)
    }
  )

  it('never returns the raw value', async () => {
    process.env[ENV] = 'super-secret-looking-value'
    const g = await status()
    expect(JSON.stringify(g)).not.toContain('super-secret-looking-value')
  })

  /*
   * The job records a run on EVERY invocation, gated or not, so a null lastRunAt
   * now means something: nothing fired inside the lookback window.
   *
   * An earlier version of this field reported `runsObservable: false`, because
   * the route wrote no run record and `lastRunAt` would have read null forever —
   * "never ran" about a job that might be running perfectly. The writer landed
   * with this change, so the field means what it says.
   */
  it('reports the last recorded heartbeat', async () => {
    process.env[ENV] = 'true'
    findManyMock.mockResolvedValue([
      {
        jobName: 'cron-fantasy-os-exec-sync',
        jobScope: null,
        status: 'success',
        rowsRead: 8,
        rowsWritten: 3,
        rowsSkipped: 5,
        errorMessage: null,
        startedAt: new Date('2026-09-11T15:00:00Z'),
        completedAt: new Date('2026-09-11T15:01:00Z'),
      },
    ])
    const g = await status()
    expect(g.runsObservable).toBe(true)
    expect(g.lastRunAt).toBe('2026-09-11T15:00:00.000Z')
    expect(g.lastRunStatus).toBe('success')
  })

  /*
   * The alarming combination, and the reason both fields exist: the gate is open
   * and nothing is coming through it. That is a dead scheduler, not a disabled
   * feature, and neither field alone can say so.
   */
  it('shows an open gate with no runs as the distinct alarming state', async () => {
    process.env[ENV] = 'true'
    findManyMock.mockResolvedValue([
      {
        jobName: 'cron-import-players',
        jobScope: null,
        status: 'success',
        rowsRead: 1,
        rowsWritten: 1,
        rowsSkipped: 0,
        errorMessage: null,
        startedAt: new Date('2026-09-11T15:00:00Z'),
        completedAt: null,
      },
    ])
    const g = await status()
    expect(g.enabled).toBe(true)
    expect(g.runsObservable).toBe(true)
    expect(g.lastRunAt).toBeNull()
  })

  /* The calm combination: firing on time, deliberately doing nothing. */
  it('shows a closed gate that is still firing as healthy-but-off', async () => {
    process.env[ENV] = 'false'
    findManyMock.mockResolvedValue([
      {
        jobName: 'cron-fantasy-os-exec-sync',
        jobScope: null,
        status: 'success',
        rowsRead: 0,
        rowsWritten: 0,
        rowsSkipped: 0,
        errorMessage: null,
        startedAt: new Date('2026-09-11T15:30:00Z'),
        completedAt: new Date('2026-09-11T15:30:01Z'),
      },
    ])
    const g = await status()
    expect(g.enabled).toBe(false)
    expect(g.configured).toBe(true)
    expect(g.lastRunAt).toBe('2026-09-11T15:30:00.000Z')
  })
})
