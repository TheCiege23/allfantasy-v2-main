// @vitest-environment node
/**
 * The power-rankings "psychology" job is retired (Milestone 32: manager characterisation labels
 * are shown to nobody). It used to fetch `league-v2`, POST the roster to
 * `/api/rankings/manager-psychology`, write the returned archetype into
 * `League.settings.psychologyCache`, and hand it back to the page as the job result.
 *
 * Two doors, both asserted:
 *   - the enqueue route refuses the job type, so a stale client cannot queue it;
 *   - the worker fails a stale "psychology" job already sitting in Redis BEFORE any fetch or
 *     League.settings write — and does not silently complete it with an undefined result.
 * The dynasty-roadmap job is the positive control: the same worker still runs it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ processor: null as null | ((job: unknown) => Promise<unknown>) }))
const prismaMock = vi.hoisted(() => ({
  league: { findMany: vi.fn(async () => [{ id: 'row-1', settings: {} }]), update: vi.fn(async () => ({})) },
}))
const queueAdd = vi.hoisted(() => vi.fn(async () => ({ id: 'job-1' })))

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_name: string, processor: (job: unknown) => Promise<unknown>) {
      captured.processor = processor
    }
    on() {
      return this
    }
    async close() {}
  },
  Job: class {},
}))
vi.mock('@/lib/queues/bullmq', () => ({
  isRedisConfigured: () => true,
  getRedisConnection: () => ({ host: 'localhost', port: 6379 }),
  getQueue: () => ({ add: queueAdd }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'viewer-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { startPowerRankingsWorker, stopPowerRankingsWorker } from '@/lib/workers/power-rankings-worker'
import { POST } from '@/app/api/power-rankings/worker/route'

const fetchMock = vi.fn()

function job(data: Record<string, unknown>) {
  return { id: 'j', data: { leagueId: '999', baseUrl: 'http://app.test', ...data }, updateProgress: vi.fn(async () => {}) }
}

beforeEach(() => {
  fetchMock.mockReset()
  prismaMock.league.findMany.mockClear()
  prismaMock.league.update.mockClear()
  queueAdd.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  startPowerRankingsWorker()
})

afterEach(async () => {
  await stopPowerRankingsWorker()
  vi.unstubAllGlobals()
})

describe('power-rankings worker — the psychology job is retired', () => {
  it('fails a stale "psychology" job before any fetch or League.settings write', async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ teams: [{ rosterId: 7, username: 'rival' }], archetype: 'The Aggressive Trader' }), {
        status: 200,
      }),
    )
    expect(captured.processor).toBeTypeOf('function')
    await expect(captured.processor!(job({ jobType: 'psychology', rosterId: 7 }))).rejects.toThrow(
      /Unsupported power-rankings job type: psychology/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prismaMock.league.update).not.toHaveBeenCalled()
  })

  it('still runs the dynasty-roadmap job (positive control)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/rankings/league-v2')) {
        return new Response(
          JSON.stringify({
            leagueName: 'L',
            isDynasty: true,
            isSuperFlex: false,
            teams: [{ rosterId: 7, username: 'rival', displayName: null, composite: 70, phase: 'x', totalRosterValue: 1 }],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ roadmap: { horizon: '3y' } }), { status: 200 })
    })
    const result = (await captured.processor!(job({ jobType: 'dynasty-roadmap', rosterId: 7 }))) as {
      roadmap: unknown
    }
    expect(result.roadmap).toEqual({ horizon: '3y' })
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('http://app.test/api/rankings/manager-psychology')
  })
})

describe('POST /api/power-rankings/worker — refuses the retired job type', () => {
  function post(body: unknown) {
    return POST(
      new Request('http://app.test/api/power-rankings/worker', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }) as never,
    )
  }

  it('answers 400 to jobType "psychology" and queues nothing', async () => {
    const res = await post({ jobType: 'psychology', leagueId: '999', rosterId: 7 })
    expect(res.status).toBe(400)
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('still queues a dynasty-roadmap job (positive control)', async () => {
    const res = await post({ jobType: 'dynasty-roadmap', leagueId: '999', rosterId: 7 })
    expect(res.status).toBe(200)
    expect(queueAdd).toHaveBeenCalledTimes(1)
    expect((queueAdd.mock.calls[0] as unknown[])[0]).toBe('dynasty-roadmap')
  })
})
