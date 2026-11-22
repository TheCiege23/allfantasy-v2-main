import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/college-weekly-projections/route'

const { cache, nba, college } = vi.hoisted(() => ({
  cache: { createMany: vi.fn(), deleteMany: vi.fn() },
  nba: vi.fn(),
  college: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: cache } }))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: (request: NextRequest) => request.headers.has('authorization') }))
vi.mock('@/lib/af-projections/nbaFantraxRecheck', () => ({ runNbaFantraxProjectionRecheck: nba }))
vi.mock('@/lib/af-projections/collegeRosterRecheck.cjs', () => ({ runCollegeProjectionRecheck: college }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ withSyncJobRun: (_ctx: unknown, run: () => unknown) => run() }))

const request = () => new NextRequest('http://localhost/api/cron/college-weekly-projections', { headers: { authorization: 'mock' } })

beforeEach(() => {
  vi.resetAllMocks()
  const claimed = new Set<string>()
  cache.createMany.mockImplementation(({ data }) => {
    const key = data[0].cacheKey
    if (claimed.has(key)) return { count: 0 }
    claimed.add(key)
    return { count: 1 }
  })
  cache.deleteMany.mockImplementation(({ where }) => { claimed.delete(where.cacheKey) })
  college.mockResolvedValue([{ sport: 'NCAAF', checked: 10, projected: 1, warnings: ['Unavailable evidence'] }])
  nba.mockResolvedValue({ sport: 'NBA', checked: 62, projected: 0, weeklyWindow: true, warnings: [], writer: [{ written: 0, seasonLinesWritten: 0 }] })
})

it('retries the failed college cohort without rerunning successful NBA work', async () => {
  const first = await GET(request())
  expect(first.status).toBe(503)
  expect(await first.json()).toMatchObject({ ok: false, runs: [{ sport: 'NCAAF', warnings: 1 }, { sport: 'NBA', checked: 62, warnings: 0 }] })
  college.mockResolvedValue([{ sport: 'NCAAF', checked: 10, projected: 1 }])
  const retry = await GET(request())
  expect(retry.status).toBe(200)
  expect(await retry.json()).toMatchObject({ ok: true, runs: [{ sport: 'NCAAF', warnings: 0 }] })
  expect(nba).toHaveBeenCalledTimes(1)
  expect(await (await GET(request())).json()).toEqual({ skipped: 'hour-already-claimed' })
})

it('rejects unauthenticated dispatches before making any claims', async () => {
  const response = await GET(new NextRequest('http://localhost/api/cron/college-weekly-projections'))
  expect(response.status).toBe(401)
  expect(cache.createMany).not.toHaveBeenCalled()
})
