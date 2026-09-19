import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  importSeason: vi.fn(),
  finalize: vi.fn(),
  schedule: vi.fn(),
  updateSeason: vi.fn(),
  updateJob: vi.fn(),
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/import/processImportJob', () => ({
  importLegacySeasonAtIndex: mocks.importSeason,
  finalizeLegacyImportJob: mocks.finalize,
}))
vi.mock('@/lib/import/triggerImportChain', () => ({
  scheduleImportSeasonStep: mocks.schedule,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    importJobSeason: { update: mocks.updateSeason },
    legacyImportJob: { update: mocks.updateJob },
  },
}))

import { POST } from '@/app/api/leagues/import/internal-step/route'

describe('legacy import chained worker retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateSeason.mockResolvedValue({})
    mocks.updateJob.mockResolvedValue({})
  })

  it('requeues the same season after a transient provider failure', async () => {
    const providerError = Object.assign(new Error('HTTP 503'), { status: 503 })
    mocks.importSeason.mockRejectedValue(new Error('season failed', { cause: providerError }))

    const response = await POST(
      new NextRequest('http://localhost/api/leagues/import/internal-step', {
        method: 'POST',
        body: JSON.stringify({
          jobId: 'job-1',
          userId: 'user-1',
          sleeperUserId: 'sleeper-1',
          seasons: [2025, 2026],
          seasonIndex: 0,
        }),
      }),
    )

    expect(response.status).toBe(202)
    expect(mocks.updateSeason).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId_season: { jobId: 'job-1', season: 2025 } },
        data: { status: 'pending', completedAt: null },
      }),
    )
    expect(mocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ seasonIndex: 0, retryAttempt: 1 }),
    )
    expect(mocks.updateJob).not.toHaveBeenCalled()
  })

  it('stops after two worker retries and records the terminal error', async () => {
    const providerError = Object.assign(new Error('HTTP 503'), { status: 503 })
    mocks.importSeason.mockRejectedValue(new Error('season failed', { cause: providerError }))

    const response = await POST(
      new NextRequest('http://localhost/api/leagues/import/internal-step', {
        method: 'POST',
        body: JSON.stringify({
          jobId: 'job-1',
          userId: 'user-1',
          sleeperUserId: 'sleeper-1',
          seasons: [2025],
          seasonIndex: 0,
          retryAttempt: 2,
        }),
      }),
    )

    expect(response.status).toBe(500)
    expect(mocks.schedule).not.toHaveBeenCalled()
    expect(mocks.updateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'error' }),
      }),
    )
  })
})
