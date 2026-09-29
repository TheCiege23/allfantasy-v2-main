// @vitest-environment node
/**
 * `/api/cron/adp-refresh` records a `sync_job_runs` heartbeat, because its output table cannot
 * serve as one.
 *
 * `adp_data` is unique per calendar week, so only the first run of a week inserts. Measured
 * 2026-09-29: `providerRowsRead: 3550, providerRowsWritten: 0`, HTTP 200 — and the freshness
 * probe, reading `adp_data.created_at`, reported the job STALE hourly.
 *
 * Pins: a zero-write run still beats (success), a zero-READ run beats as FAILED so a feed outage
 * still alarms, a thrown import beats as failed, and a hand run scoped with `?sport=` does not beat.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  runAdpImporter: vi.fn(),
  recordSyncJobRun: vi.fn(),
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/workers/adp-importer', () => ({ runAdpImporter: h.runAdpImporter }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ recordSyncJobRun: h.recordSyncJobRun }))
vi.mock('@/lib/player-values/ingestPlayerValues', () => ({ ingestPlayerValues: vi.fn(async () => ({})) }))
vi.mock('@/lib/ai-adp-engine', () => ({ runAiAdpJob: vi.fn(async () => ({})) }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/values/canonicalDefenderBoardCache', () => ({
  refreshCanonicalDefenderBoardCache: vi.fn(async () => ({ ok: false, reason: 'test' })),
}))
vi.mock('@/lib/player-valuation-sync', () => ({
  PLAYER_VALUATION_SPORTS: ['nfl'],
  syncPlayerValuations: vi.fn(async () => ({ total: 0, written: {}, failed: {}, skipped: [] })),
}))

import { GET } from '@/app/api/cron/adp-refresh/route'
import { PROBES } from '../../scripts/cron-freshness-check.mjs'

const call = (query = '') => GET(new NextRequest(`https://af.test/api/cron/adp-refresh${query}`))

function importResult(read: number, written: number) {
  return {
    imported: written,
    sports: ['NFL'],
    season: 2026,
    week: 40,
    providerRowsRead: read,
    providerRowsWritten: written,
    consensusRowsAttempted: 0,
    consensusRowsWritten: 0,
    skippedRows: 0,
    providerRowsWrittenBySport: {},
    consensusRowsBySport: {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.recordSyncJobRun.mockResolvedValue(undefined)
})

describe('adp-refresh heartbeat', () => {
  it('🛑 beats as SUCCESS when it read feeds but every row was a same-week duplicate', async () => {
    h.runAdpImporter.mockResolvedValue(importResult(3550, 0))
    const res = await call()
    expect(res.status).toBe(200)

    expect(h.recordSyncJobRun).toHaveBeenCalledTimes(1)
    const [ctx, outcome] = h.recordSyncJobRun.mock.calls[0]!
    // Against the REAL probe map: a mismatch leaves the probe on CONFIG forever, silently.
    expect(ctx.jobName).toBe((PROBES as Record<string, { heartbeat?: string }>)['/api/cron/adp-refresh']!.heartbeat)
    expect(outcome.rowsRead).toBe(3550)
    expect(outcome.rowsWritten).toBe(0)
    expect(outcome.rowsSkipped).toBe(3550)
    expect(outcome.errors).toEqual([])
  })

  it('⚠ beats as FAILED when the import read nothing, so a feed outage still alarms', async () => {
    h.runAdpImporter.mockResolvedValue(importResult(0, 0))
    await call()
    const [, outcome] = h.recordSyncJobRun.mock.calls[0]!
    expect(outcome.errors).toEqual(['ADP import read 0 provider rows'])
  })

  it('beats as FAILED when the import throws', async () => {
    h.runAdpImporter.mockRejectedValue(new Error('provider down'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(h.recordSyncJobRun).toHaveBeenCalledTimes(1)
    expect(h.recordSyncJobRun.mock.calls[0]![1].errors).toEqual(['provider down'])
  })

  it('does not beat for a hand run scoped with ?sport=', async () => {
    h.runAdpImporter.mockResolvedValue(importResult(10, 10))
    await call('?sport=NFL')
    expect(h.recordSyncJobRun).not.toHaveBeenCalled()
  })

  it('does not beat on a dry run', async () => {
    await call('?dryRun=true')
    expect(h.recordSyncJobRun).not.toHaveBeenCalled()
  })
})
