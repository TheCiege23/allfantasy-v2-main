/**
 * The NCAAB devy pool phase on the `?intel=1` tick.
 *
 * It sits beside `mlb-fantrax-identities`, under its own heartbeat (`ncaab-devy-pool`), so that
 * "inside the weekly cadence", "declined for runway" and "the seed threw" each leave a row and
 * none reads like a tick that never fired.
 *
 * What is pinned, behaviourally:
 *   - admitted with runway, and handed a deadline that leaves the devy intel sweep its 150s;
 *   - declined below the runway floor, without calling the seed, and still recorded;
 *   - a seed that throws does not stop the intel sweep or the psych rotation behind it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  ingest: vi.fn(),
  refresh: vi.fn(async () => ({ leaguesProfiled: 0, managersProfiled: 0, leagueIds: [], stoppedEarly: false, deferred: 0 })),
  intel: vi.fn(async () => ({ feeds: 'inside cadence' })),
  heartbeats: [] as Array<{ jobName: string; outcome: Record<string, unknown> | null; threw: boolean }>,
  remainingMs: null as number | null,
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/sports-data-importer', () => ({
  runSportsDataImporter: vi.fn(async () => {
    throw new Error('the main run must not be reached by an intel tick')
  }),
}))
vi.mock('@/lib/psychological-profiles/ProfileRefreshService', () => ({ refreshStaleLeagueProfiles: h.refresh }))
vi.mock('@/lib/devy/devyIntelRefresh', () => ({ refreshDevyIntelSources: h.intel }))
vi.mock('@/lib/devy/ingestFantraxDevyAdp', () => ({
  ingestFantraxDevyAdp: vi.fn(async () => ({ priced: 0, withSchool: 0, updated: 0, unmatched: 0, ambiguous: 0, teamEntries: 0 })),
}))
vi.mock('@/lib/devy/devyHeadshotRefresh', () => ({
  refreshDevyHeadshots: vi.fn(async () => ({ refreshed: 0 })),
  refreshCollegeSportsPlayerHeadshots: vi.fn(async () => ({ refreshed: 0 })),
}))
vi.mock('@/lib/espn/ncaabEspnIngest', () => ({
  isNcaabRosterSeason: vi.fn(() => false),
  syncEspnNcaabTeamMapIfDue: vi.fn(),
  syncEspnNcaabRosters: vi.fn(),
}))
vi.mock('@/lib/player-identity/ingestMlbFantraxIdentities', () => ({
  ingestMlbFantraxIdentities: vi.fn(async () => ({ skipped: 'weekly cadence', updated: 0 })),
}))
vi.mock('@/lib/player-identity/ingestNcaafFantraxIdentities', () => ({
  ingestNcaafFantraxIdentities: vi.fn(async () => ({ skipped: 'weekly cadence', updated: 0 })),
}))
vi.mock('@/lib/devy/ingestNcaabDevyPool', () => ({ ingestNcaabDevyPoolIfDue: h.ingest }))

/* Faithful to the real contract: run fn, derive the outcome from its result, record, rethrow. */
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async <T,>(
    ctx: { jobName: string },
    fn: () => Promise<T>,
    extract?: (r: T) => Record<string, unknown>,
  ): Promise<T> => {
    try {
      const result = await fn()
      h.heartbeats.push({ jobName: ctx.jobName, outcome: extract ? extract(result) : {}, threw: false })
      return result
    } catch (err) {
      h.heartbeats.push({ jobName: ctx.jobName, outcome: null, threw: true })
      throw err
    }
  },
}))

vi.mock('@/lib/cron/runBudget', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cron/runBudget')>('@/lib/cron/runBudget')
  return {
    ...actual,
    createRunBudget: (...args: Parameters<typeof actual.createRunBudget>) => {
      const real = actual.createRunBudget(...args)
      if (h.remainingMs == null) return real
      return { ...real, remainingMs: () => h.remainingMs as number, exhausted: () => false }
    },
  }
})

import { GET } from '@/app/api/cron/import-players/route'

const JOB = 'ncaab-devy-pool'
const intelTick = () => GET(new NextRequest('http://localhost/api/cron/import-players?intel=1'))

beforeEach(() => {
  h.ingest.mockReset()
  h.refresh.mockClear()
  h.intel.mockClear()
  h.heartbeats.length = 0
  h.remainingMs = null
})

afterEach(() => vi.restoreAllMocks())

describe('runs when the budget allows', () => {
  it('calls the weekly-gated writer with a deadline that leaves the intel sweep its runway', async () => {
    h.remainingMs = 230_000
    h.ingest.mockResolvedValue({ seeded: 900, fetched: 910, totalInPool: 4000, complete: true, resumeFrom: 0, source: 'rolling_insights', errors: 0 })

    // Measure the deadline contract independently of CI scheduling and async import latency.
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-20T03:00:00Z').getTime())
    const before = Date.now()
    const body = await (await intelTick()).json()

    expect(h.ingest).toHaveBeenCalledTimes(1)
    const { deadlineAt } = h.ingest.mock.calls[0][0] as { deadlineAt: number }
    // At most 45s, and never into the 150s the devy intel sweep refuses to start without.
    expect(deadlineAt - before).toBeLessThanOrEqual(230_000 - 150_000)
    expect(deadlineAt - before).toBeLessThanOrEqual(45_000)
    expect(deadlineAt).toBeGreaterThan(before)

    const row = h.heartbeats.find((b) => b.jobName === JOB)
    expect(row).toMatchObject({ threw: false, outcome: { rowsWritten: 900 } })
    expect(body.ncaabDevyPool).toMatchObject({ seeded: 900, complete: true })
  })

  it('runs before the devy intel sweep, beside the identity phases', async () => {
    h.ingest.mockResolvedValue({ skipped: 'weekly cadence' })

    await intelTick()

    expect(h.ingest.mock.invocationCallOrder[0]).toBeLessThan(h.intel.mock.invocationCallOrder[0])
  })

  it('a weekly-cadence skip is recorded as a clean row, not a warning', async () => {
    h.ingest.mockResolvedValue({ skipped: 'weekly cadence', lastRunAt: '2026-10-15T00:00:00.000Z' })

    await intelTick()

    const row = h.heartbeats.find((b) => b.jobName === JOB)
    // The row must EXIST; without this, a missing heartbeat would satisfy the check below.
    expect(row).toBeDefined()
    expect(row!.threw).toBe(false)
    expect(row!.outcome?.warnings ?? []).toEqual([])
  })
})

describe('declines when the budget is short — and still leaves a record', () => {
  it('does not call the seed and records a deferred outcome', async () => {
    h.remainingMs = 170_000

    const body = await (await intelTick()).json()

    expect(h.ingest).not.toHaveBeenCalled()
    expect(body.ncaabDevyPool).toMatchObject({ skipped: expect.stringMatching(/^deferred/) })
    const row = h.heartbeats.find((b) => b.jobName === JOB)
    expect(row).toBeDefined()
    expect(row!.threw).toBe(false)
    expect(String((row!.outcome?.warnings as string[] | undefined)?.[0])).toMatch(/deferred/)
  })
})

describe('an error in the seed does not stop the tick', () => {
  it('records the failure, and the intel sweep and psych rotation still run', async () => {
    h.ingest.mockRejectedValue(new Error('NCAAB players: provider chain returned no rows'))

    const res = await intelTick()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(h.heartbeats.find((b) => b.jobName === JOB)?.threw).toBe(true)
    expect(body.ncaabDevyPool).toMatchObject({ error: expect.stringMatching(/no rows/) })
    expect(h.intel).toHaveBeenCalledTimes(1)
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })
})
