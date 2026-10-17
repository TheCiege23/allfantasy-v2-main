// @vitest-environment node
/**
 * Owner decision 2026-09-29: Market Movers' `player-valuations:{sport}` rows get a SCHEDULED
 * writer without a new cron slot — the daily `/api/cron/adp-refresh` runs the writer the
 * `sync:player-valuations` script used to be the only caller of.
 *
 * Pins: the host cron actually invokes the phase (a writer with no clock behind it is the bug
 * being fixed), passes it a bound and a day-long TTL, and SURVIVES its failure — every earlier
 * phase has already written, so a Rolling Insights outage must not turn the ADP run red. Every
 * dependency is mocked: no database, no provider.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  runAdpImporter: vi.fn(),
  ingestPlayerValues: vi.fn(),
  runAiAdpJob: vi.fn(),
  refreshBoard: vi.fn(),
  syncPlayerValuations: vi.fn(),
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/workers/adp-importer', () => ({ runAdpImporter: h.runAdpImporter }))
vi.mock('@/lib/player-values/ingestPlayerValues', () => ({ ingestPlayerValues: h.ingestPlayerValues }))
vi.mock('@/lib/ai-adp-engine', () => ({ runAiAdpJob: h.runAiAdpJob }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/values/canonicalDefenderBoardCache', () => ({
  refreshCanonicalDefenderBoardCache: h.refreshBoard,
}))
vi.mock('@/lib/player-valuation-sync', () => ({
  PLAYER_VALUATION_SPORTS: ['nfl', 'nba', 'mlb', 'nhl', 'ncaaf', 'ncaab', 'soccer_euro'],
  syncPlayerValuations: h.syncPlayerValuations,
}))

import { GET } from '@/app/api/cron/adp-refresh/route'

const call = (query = '') => GET(new NextRequest(`https://af.test/api/cron/adp-refresh${query}`))

const SUMMARY = { total: 42, written: { nfl: 40, nba: 2 }, failed: {}, skipped: [] }

beforeEach(() => {
  vi.clearAllMocks()
  h.runAdpImporter.mockResolvedValue({
    imported: 1,
    sports: ['NFL'],
    season: 2026,
    week: 4,
    providerRowsRead: 1,
    providerRowsWritten: 1,
    consensusRowsAttempted: 1,
    consensusRowsWritten: 1,
    skippedRows: 0,
    providerRowsWrittenBySport: {},
    consensusRowsBySport: {},
  })
  h.ingestPlayerValues.mockResolvedValue({ captured: 10 })
  h.runAiAdpJob.mockResolvedValue({ snapshots: 3 })
  h.refreshBoard.mockResolvedValue({ ok: false, reason: 'test' })
  h.syncPlayerValuations.mockResolvedValue(SUMMARY)
})

describe('adp-refresh schedules the Market Movers valuation writer', () => {
  it('invokes the writer once, for every sport, bounded, with a TTL that outlives a day', async () => {
    const before = Date.now()
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(h.syncPlayerValuations).toHaveBeenCalledTimes(1)
    const [opts] = h.syncPlayerValuations.mock.calls[0] as [{ sports: string[]; ttlMs: number; deadlineAt: number }]
    expect(opts.sports).toEqual(['nfl', 'nba', 'mlb', 'nhl', 'ncaaf', 'ncaab', 'soccer_euro'])
    expect(opts.ttlMs).toBeGreaterThan(24 * 60 * 60 * 1000)
    // Bounded: a deadline in the future, and inside the route's own 300s.
    expect(opts.deadlineAt).toBeGreaterThan(before)
    expect(opts.deadlineAt).toBeLessThanOrEqual(before + 300_000)

    expect(body.ok).toBe(true)
    expect(body.playerValuations).toEqual(SUMMARY)
  })

  it('runs AFTER the earlier phases, so a slow provider cannot starve them', async () => {
    await call()
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]
    expect(order(h.syncPlayerValuations)).toBeGreaterThan(order(h.runAdpImporter))
    expect(order(h.syncPlayerValuations)).toBeGreaterThan(order(h.ingestPlayerValues))
    expect(order(h.syncPlayerValuations)).toBeGreaterThan(order(h.refreshBoard))
    expect(order(h.syncPlayerValuations)).toBeGreaterThan(order(h.runAiAdpJob))
  })

  it('survives the writer failing: 200, ok, every other phase still reported', async () => {
    h.syncPlayerValuations.mockRejectedValueOnce(new Error('rolling insights down'))
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.playerValuations).toEqual({ error: 'rolling insights down' })
    expect(body.playerValues).toEqual({ captured: 10 })
    expect(body.aiAdp).toEqual({ snapshots: 3 })
    expect(body.imported).toBe(1)
  })

  it('redacts a Rolling Insights token out of a failure before it reaches the response', async () => {
    h.syncPlayerValuations.mockRejectedValueOnce(
      new Error('GET https://rest.example/api/v1/nfl/players?RSC_token=abc123secret failed'),
    )
    const body = await (await call()).json()
    expect(JSON.stringify(body)).not.toContain('abc123secret')
    expect(body.playerValuations.error).toContain('RSC_token=***')
  })

  it('honours ?sport= — maps it to the writer vocabulary, and skips when nothing maps', async () => {
    await call('?sport=NFL,NCAAF')
    expect(h.syncPlayerValuations.mock.calls[0]![0]).toMatchObject({ sports: ['nfl', 'ncaaf'] })

    h.syncPlayerValuations.mockClear()
    const body = await (await call('?sport=CRICKET')).json()
    expect(h.syncPlayerValuations).not.toHaveBeenCalled()
    expect(body.playerValuations).toHaveProperty('skipped')
  })

  it('a dry run writes nothing, this phase included', async () => {
    await call('?dryRun=true')
    expect(h.syncPlayerValuations).not.toHaveBeenCalled()
  })
})
