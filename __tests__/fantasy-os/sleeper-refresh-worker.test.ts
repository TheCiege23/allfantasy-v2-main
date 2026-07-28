// @vitest-environment node
/**
 * B6 durable worker + runner guarantees:
 *  - the runner acquires the per-league LOCK before any provider fetch (deep-dynasty work can never run
 *    outside the lock), a second executor is rejected as locked with zero fetches, and a failed run
 *    never advances freshness (previous data preserved);
 *  - the worker handler maps the durable outcome HONESTLY (completed → done; locked/partial/failed →
 *    retryable, never a false success; bad payload → fatal);
 *  - scheduled and manual refresh call the SAME collector entry (`syncConnectedSleeperLeague`).
 * Fully deterministic — no DB, no live provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ sync: vi.fn() }))
vi.mock('@/lib/automation/engine', () => ({
  // Thin engine stand-in: run the handler and surface its outcome (or its thrown retryable/fatal error).
  runAutomationJob: async (ctx: unknown, handler: (c: unknown) => Promise<unknown>) => {
    const r = await handler(ctx)
    return { ...(r as object), jobId: 'j', runId: 'r' }
  },
}))
vi.mock('@/lib/fantasy-os/sync/collector/syncConnectedSleeperLeague', () => ({ syncConnectedSleeperLeague: h.sync }))
// `runDueSleeperLeagues` imports `enumerate`, which imports the real prisma client at module load. The
// shared-worker test uses explicit connections (no enumerate DB call) + a mocked sync, so an inert
// prisma stub is enough to avoid a DB connection during import.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { runSync } from '@/lib/fantasy-os/sync/runner'
import { runSleeperRefreshJob } from '@/lib/fantasy-os/sync/refreshJob/runSleeperRefreshJob'
import { runDueSleeperLeagues } from '@/lib/fantasy-os/sync/collector/runDueSleeperLeagues'
import { SLEEPER_REFRESH_JOB_TYPE } from '@/lib/fantasy-os/sync/refreshJob/constants'

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    getCheckpoint: vi.fn(async () => null),
    saveCheckpoint: vi.fn(async () => {}),
    persistScope: vi.fn(async () => ({ imported: 0, unchanged: 0, rejected: 0 })),
    recordRun: vi.fn(async () => {}),
    setLastSuccessfulSyncAt: vi.fn(async () => {}),
    ...over,
  }
}
const baseOpts = (over: Record<string, unknown>) => ({
  runKey: 'k',
  seasonState: 'offseason' as never,
  scopes: ['league_state'],
  clock: { now: () => new Date(1_000) },
  rng: { next: () => 0 },
  sleep: async () => {},
  leaseMs: 60_000,
  maxRetries: 1,
  runTimeoutMs: 60_000,
  baseBackoffMs: 1,
  ...over,
})

describe('runner — lock precedes fetch; failure preserves freshness', () => {
  it('acquires the lock BEFORE any scope fetch', async () => {
    const order: string[] = []
    const lock = {
      acquire: vi.fn(async () => { order.push('lock'); return { acquired: true, token: 't' } }),
      release: vi.fn(async () => {}),
    }
    const fetchScope = vi.fn(async () => { order.push('fetch'); return { records: [], nextCheckpoint: 'c', attempts: 1, logical: 1, notFound: 0, cacheHits: 0 } })
    await runSync(baseOpts({ lock, store: fakeStore(), fetchScope }) as never)
    expect(order[0]).toBe('lock')
    expect(order.indexOf('lock')).toBeLessThan(order.indexOf('fetch'))
  })

  it('a failed run does NOT advance freshness (setLastSuccessfulSyncAt never called)', async () => {
    const lock = { acquire: vi.fn(async () => ({ acquired: true, token: 't' })), release: vi.fn(async () => {}) }
    const store = fakeStore()
    const fetchScope = vi.fn(async () => { throw new Error('provider down') })
    const res = await runSync(baseOpts({ lock, store, fetchScope }) as never)
    expect(res.status).toBe('failed')
    expect(res.advancedFreshness).toBe(false)
    expect(store.setLastSuccessfulSyncAt).not.toHaveBeenCalled()
  })

  it('a second executor is rejected as locked and performs ZERO fetches', async () => {
    const lock = { acquire: vi.fn(async () => ({ acquired: false })), release: vi.fn(async () => {}) }
    const fetchScope = vi.fn(async () => ({ records: [], nextCheckpoint: 'c', attempts: 1, logical: 1, notFound: 0, cacheHits: 0 }))
    const res = await runSync(baseOpts({ lock, store: fakeStore(), fetchScope }) as never)
    expect(res.status).toBe('locked')
    expect(fetchScope).not.toHaveBeenCalled()
  })
})

const CONN = { runKey: 'sleeper:131353:2026', provider: 'sleeper', externalLeagueId: '131353', season: 2026, sport: 'NFL' }
const ctx = () => ({ jobType: SLEEPER_REFRESH_JOB_TYPE, idempotencyKey: 'sleeper-refresh:sleeper:131353:2026:1', metadata: { connection: CONN } })

describe('worker handler — honest outcome mapping + shared worker', () => {
  beforeEach(() => vi.clearAllMocks())

  it('completed run → completed, marks `changed` from the run accounting', async () => {
    h.sync.mockResolvedValue({ status: 'completed', advancedFreshness: true, removed: 0, result: { accounting: { imported: 3, unchanged: 1 } } })
    const out = await runSleeperRefreshJob(ctx())
    expect(out.status).toBe('completed')
    expect(out.metadata?.changed).toBe(true)
    expect(h.sync).toHaveBeenCalledWith(
      expect.objectContaining({ runKey: CONN.runKey }),
      expect.any(Date),
      expect.objectContaining({ force: true }),
    )
  })

  it('completed with no changes → completed but not `changed`', async () => {
    h.sync.mockResolvedValue({ status: 'completed', advancedFreshness: true, removed: 0, result: { accounting: { imported: 0, unchanged: 12 } } })
    const out = await runSleeperRefreshJob(ctx())
    expect(out.status).toBe('completed')
    expect(out.metadata?.changed).toBe(false)
  })

  it('locked run → retryable (thrown), never a false success', async () => {
    h.sync.mockResolvedValue({ status: 'locked' })
    await expect(runSleeperRefreshJob(ctx())).rejects.toThrow(/already running/i)
  })

  it('partial/failed run → retryable (thrown)', async () => {
    h.sync.mockResolvedValue({ status: 'partial', advancedFreshness: false })
    await expect(runSleeperRefreshJob(ctx())).rejects.toThrow(/partial|incomplete|failed/i)
  })

  it('invalid job payload → fatal (never retried)', async () => {
    await expect(
      runSleeperRefreshJob({ jobType: SLEEPER_REFRESH_JOB_TYPE, idempotencyKey: 'x', metadata: {} }),
    ).rejects.toThrow(/invalid/i)
  })

  it('scheduled (runDueSleeperLeagues) and the manual worker call the SAME collector entry', async () => {
    h.sync.mockResolvedValue({ status: 'completed', advancedFreshness: true, removed: 0, due: true, executed: true, result: { accounting: { imported: 0, unchanged: 2 } } })
    await runDueSleeperLeagues({ connections: [CONN as never] })
    await runSleeperRefreshJob(ctx())
    const targets = h.sync.mock.calls.map((c) => (c[0] as { runKey: string }).runKey)
    expect(targets.filter((k) => k === CONN.runKey).length).toBeGreaterThanOrEqual(2)
  })
})
