// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  auth: vi.fn(), claim: vi.fn(), release: vi.fn(), check: vi.fn(), telemetry: vi.fn(),
}))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: m.auth }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: {
  createMany: m.claim, delete: m.release, deleteMany: m.release,
} } }))
vi.mock('@/lib/af-projections/collegeRosterRecheck.cjs', () => ({ runCollegeProjectionRecheck: m.check }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ withSyncJobRun: m.telemetry }))
import { GET } from '@/app/api/cron/college-weekly-projections/route'

const req = new Request('https://example.test/api/cron/college-weekly-projections') as NextRequest
describe('hourly college rechecks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.auth.mockReturnValue(true)
    m.claim.mockResolvedValue({ count: 1 })
    m.telemetry.mockImplementation(async (_, check, extract) => {
      const runs = await check()
      extract(runs)
      return runs
    })
  })
  it('requires the scheduler secret before claiming an hour', async () => {
    m.auth.mockReturnValue(false)
    expect((await GET(req)).status).toBe(401)
    expect(m.auth).toHaveBeenCalledWith(req, 'CRON_SECRET')
    expect(m.claim).not.toHaveBeenCalled()
  })
  it('skips duplicate dispatches', async () => {
    m.claim.mockResolvedValue({ count: 0 })
    expect((await GET(req)).status).toBe(200)
    expect(m.check).not.toHaveBeenCalled()
  })
  it('accepts verified missing projections as a completed check', async () => {
    m.check.mockResolvedValue([{ sport: 'NCAAF', checked: 10, projected: 0, warnings: [] }])
    expect((await GET(req)).status).toBe(200)
    expect(m.release).not.toHaveBeenCalled()
  })
  it('makes a parity failure or partial source read retryable', async () => {
    m.check.mockResolvedValue([{ sport: 'NCAAF', error: 'roster parity' }, { sport: 'NCAAB', warnings: ['feed unavailable'] }])
    expect((await GET(req)).status).toBe(503)
    expect(m.release).toHaveBeenCalledOnce()
  })
})
