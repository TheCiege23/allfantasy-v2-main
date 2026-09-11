import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `syncGate` in the admin import-health view.
 *
 * The heartbeat at `/api/cron/fantasy-os-exec-sync` no-ops unless
 * `FANTASY_OS_EXEC_SYNC_LIVE === 'true'` AND RETURNS 200 WHEN IT DOES, so a
 * disabled sync is indistinguishable from a working one everywhere else in the
 * product. These tests pin the operator states apart, pin that the raw value
 * never leaves the process, and pin that an unobservable effect is reported as
 * unobservable rather than as absent.
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
   * 🛑 THE FIELD THIS ALMOST SHIPPED WAS A CHECK THAT COULD NEVER SUCCEED.
   *
   * The first version reported `lastRunAt` out of SyncJobRun. But the heartbeat
   * route records no run — it returns JSON and nothing else — so that field
   * would have read null forever, announcing "never ran" about a job that might
   * be running perfectly.
   *
   * `runsObservable: false` names the gap instead. It is the same distinction as
   * configured-vs-enabled above: "cannot see" and "saw nothing" are different
   * answers, and collapsing them produces a confident wrong one.
   */
  it('says the effect is unobservable rather than reporting a null last run', async () => {
    process.env[ENV] = 'true'
    const g = await status()
    expect(g.enabled).toBe(true)
    expect(g.runsObservable).toBe(false)
    expect(g.runsObservableNote).toContain('writes no SyncJobRun')
    // The trap: no field a reader could mistake for "it has never run".
    expect(g).not.toHaveProperty('lastRunAt')
    expect(g).not.toHaveProperty('lastRunStatus')
  })

  it('reports the gate state independently of unrelated run history', async () => {
    process.env[ENV] = 'true'
    findManyMock.mockResolvedValue([
      {
        jobName: 'cron-import-players',
        jobScope: null,
        status: 'success',
        rowsWritten: 1,
        rowsSkipped: 0,
        errorMessage: null,
        startedAt: new Date('2026-09-11T15:00:00Z'),
        completedAt: null,
      },
    ])
    const g = await status()
    expect(g.enabled).toBe(true)
    expect(g.configured).toBe(true)
    expect(g.runsObservable).toBe(false)
  })
})
