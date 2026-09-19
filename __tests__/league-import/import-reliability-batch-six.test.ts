import { describe, expect, it, vi } from 'vitest'

import { buildImportProgressView } from '@/lib/import/importProgressView'
import { buildIncrementalSeasonPlan } from '@/lib/import/incrementalSeasonPlan'
import {
  getSleeperImportFailureResponse,
  runSleeperImportRequest,
} from '@/lib/import/sleeperImportRetry'

describe('Batch 6 import reliability', () => {
  it('reuses terminal historical years while refreshing the latest known and current years', () => {
    expect(
      buildIncrementalSeasonPlan({
        launchYear: 2021,
        currentYear: 2026,
        terminalYears: [2021, 2022, 2023, 2024, 2025],
      }),
    ).toEqual({
      yearsToDiscover: [2025, 2026],
      reusedYears: [2021, 2022, 2023, 2024],
    })
  })

  it('honors provider retry-after metadata before succeeding', async () => {
    const sleep = vi.fn(async () => undefined)
    const request = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('failed (429)'), { status: 429, retryAfterMs: 2_000 }))
      .mockResolvedValue('ok')

    await expect(runSleeperImportRequest(request, { sleep })).resolves.toBe('ok')
    expect(sleep).toHaveBeenCalledWith(2_000)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not retry a permanent provider response', async () => {
    const request = vi.fn<() => Promise<string>>().mockRejectedValue(Object.assign(new Error('failed (404)'), { status: 404 }))
    await expect(runSleeperImportRequest(request, { sleep: async () => undefined })).rejects.toThrow('404')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('uses bounded exponential delay when the provider omits retry-after, including nested failures', async () => {
    const sleep = vi.fn(async () => undefined)
    const providerError = Object.assign(new Error('HTTP 503'), { status: 503, retryAfterMs: null })
    const request = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('season failed', { cause: providerError }))
      .mockResolvedValue('ok')

    await expect(runSleeperImportRequest(request, { sleep })).resolves.toBe('ok')
    expect(sleep).toHaveBeenCalledWith(300)
  })

  it('returns actionable rate-limit metadata instead of an empty-season result', () => {
    expect(
      getSleeperImportFailureResponse(Object.assign(new Error('failed (429)'), { status: 429, retryAfterMs: 12_000 })),
    ).toMatchObject({ status: 429, retryAfterSec: 12, code: 'SLEEPER_RATE_LIMITED' })
  })

  it('describes the active season and makes interrupted imports safely retryable', () => {
    expect(
      buildImportProgressView({
        status: 'running',
        progress: 42,
        currentSeason: 2024,
        totalSeasons: 5,
        seasonsCompleted: 2,
        seasonStatuses: ['complete', 'complete', 'processing', 'pending', 'pending'],
      }),
    ).toMatchObject({ stage: 'importing', message: 'Importing the 2024 season…', retryable: false })

    expect(
      buildImportProgressView({
        status: 'error',
        progress: 42,
        currentSeason: 2024,
        totalSeasons: 5,
        seasonsCompleted: 2,
        seasonStatuses: ['complete', 'complete', 'error', 'pending', 'pending'],
      }),
    ).toMatchObject({ stage: 'failed', retryable: true, pollAfterMs: null })
  })
})
