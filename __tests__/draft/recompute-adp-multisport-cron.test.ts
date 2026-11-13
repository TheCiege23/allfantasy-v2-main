/**
 * The scheduled ADP fire is `?sport=NFL,MLB,NBA,NHL` (one cron slot — see the route). Each sport is
 * recomputed separately, NFL keeps its reference capture, and one sport failing does not stop the rest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ recompute: vi.fn(), heartbeat: vi.fn(), market: vi.fn(), cached: vi.fn(), provider: vi.fn(), tradeMarket: vi.fn(), wrapped: vi.fn() }))
vi.mock('@/lib/adp/recomputeAllFantasyAdp', () => ({ recomputeAllFantasyAdp: m.recompute }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  recordSyncJobRun: m.heartbeat,
  withSyncJobRun: async (ctx: unknown, fn: () => Promise<unknown>) => {
    m.wrapped(ctx)
    return fn()
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/trade-market/scheduledMarketRecalc', () => ({ runScheduledMarketRecalc: m.tradeMarket }))
vi.mock('@/lib/draft-archive/ingestion/referenceWriter', () => ({
  syncMarketReferences: m.market,
  captureCachedReferences: m.cached,
  captureProviderAdp: m.provider,
}))

import { GET } from '@/app/api/cron/recompute-allfantasy-adp/route'

const req = (url: string) =>
  new Request(url, { headers: { authorization: 'Bearer s' } }) as unknown as Parameters<typeof GET>[0]
const URL_ALL = 'http://localhost/api/cron/recompute-allfantasy-adp?sport=NFL,MLB,NBA,NHL'

describe('recompute-allfantasy-adp multi-sport fire', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's'
    for (const fn of Object.values(m)) fn.mockReset()
    m.recompute.mockImplementation(async ({ sport }: { sport: string }) => ({ sport, snapshotsWritten: 10, errors: [] }))
    m.market.mockResolvedValue({ failed: 0 })
    m.cached.mockResolvedValue({})
    m.provider.mockResolvedValue({ unavailable: false })
    m.tradeMarket.mockResolvedValue({ written: 280, published: 280, tradesUsed: 4000, sinceSeason: 2026, medianAdjustment: 0.2, attempts: [] })
  })
  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('recomputes every sport, NFL first, and captures references once', async () => {
    const res = await GET(req(URL_ALL))
    expect(res.status).toBe(200)
    expect(m.recompute.mock.calls.map((c) => c[0].sport)).toEqual(['NFL', 'MLB', 'NBA', 'NHL'])
    expect(m.market).toHaveBeenCalledTimes(1)
    expect(m.heartbeat).toHaveBeenCalledTimes(1)
    expect(m.heartbeat.mock.calls[0][0]).toMatchObject({ jobName: 'cron-recompute-allfantasy-adp-multisport' })
    expect(m.heartbeat.mock.calls[0][1]).toMatchObject({ rowsWritten: 40, errors: [] })
  })

  it('keeps going when one sport throws, and reports it as 207', async () => {
    m.recompute.mockImplementation(async ({ sport }: { sport: string }) => {
      if (sport === 'NBA') throw new Error('boom')
      return { sport, snapshotsWritten: 1, errors: [] }
    })
    const res = await GET(req(URL_ALL))
    expect(res.status).toBe(207)
    expect(m.recompute).toHaveBeenCalledTimes(4)
    expect(m.heartbeat.mock.calls[0][1].errors).toEqual(['NBA: boom'])
  })

  it('records no heartbeat for a dry run', async () => {
    await GET(req(`${URL_ALL}&dryRun=true`))
    expect(m.heartbeat).not.toHaveBeenCalled()
  })

  it('leaves a single-sport call unchanged (no heartbeat)', async () => {
    const res = await GET(req('http://localhost/api/cron/recompute-allfantasy-adp?sport=nhl'))
    expect(res.status).toBe(200)
    expect(m.recompute).toHaveBeenCalledTimes(1)
    expect(m.recompute.mock.calls[0][0].sport).toBe('NHL')
    expect(m.heartbeat).not.toHaveBeenCalled()
    expect(m.tradeMarket).not.toHaveBeenCalled()
  })
})

/*
 * The AllFantasy trade market rebuild rides this slot (cron ceiling). It runs after every sport, under its
 * own heartbeat, and never changes the ADP fire's status.
 */
describe('the trade market rebuild folded into the multi-sport fire', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's'
    for (const fn of Object.values(m)) fn.mockReset()
    m.recompute.mockImplementation(async ({ sport }: { sport: string }) => ({ sport, snapshotsWritten: 10, errors: [] }))
    m.market.mockResolvedValue({ failed: 0 })
    m.cached.mockResolvedValue({})
    m.provider.mockResolvedValue({ unavailable: false })
    m.tradeMarket.mockResolvedValue({ written: 280, published: 280, tradesUsed: 4000, sinceSeason: 2026, medianAdjustment: 0.2, attempts: [] })
  })
  afterEach(() => {
    delete process.env.CRON_SECRET
    vi.useRealTimers()
  })

  it('runs once, after every sport, under its own heartbeat', async () => {
    const order: string[] = []
    m.recompute.mockImplementation(async ({ sport }: { sport: string }) => { order.push(sport); return { sport, snapshotsWritten: 1, errors: [] } })
    m.tradeMarket.mockImplementation(async () => { order.push('market'); return { written: 1, published: 1, tradesUsed: 1, sinceSeason: 2026, medianAdjustment: 0, attempts: [] } })
    const res = await GET(req(URL_ALL))
    expect(res.status).toBe(200)
    expect(order).toEqual(['NFL', 'MLB', 'NBA', 'NHL', 'market'])
    expect(m.wrapped).toHaveBeenCalledWith(expect.objectContaining({ jobName: 'cron-af-market-values' }))
    expect((await res.json()).tradeMarket).toMatchObject({ ran: true, result: { written: 1 } })
  })

  it('a rebuild that throws does not turn the ADP fire red', async () => {
    m.tradeMarket.mockRejectedValue(new Error('db down'))
    const res = await GET(req(URL_ALL))
    expect(res.status).toBe(200)
    expect((await res.json()).tradeMarket).toMatchObject({ ran: false, reason: 'failed: db down' })
  })

  it('never runs on a dry run, a test-draft run, or with the kill switch', async () => {
    await GET(req(`${URL_ALL}&dryRun=true`))
    await GET(req(`${URL_ALL}&includeTest=true`))
    await GET(req(`${URL_ALL}&includeTradeMarket=false`))
    expect(m.tradeMarket).not.toHaveBeenCalled()
  })

  it('skips — and says so in its heartbeat — when the sports used the start budget', async () => {
    let t = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => t)
    m.recompute.mockImplementation(async ({ sport }: { sport: string }) => { t += 60_000; return { sport, snapshotsWritten: 1, errors: [] } })
    const res = await GET(req(URL_ALL))
    expect(m.tradeMarket).not.toHaveBeenCalled()
    expect((await res.json()).tradeMarket).toMatchObject({ ran: false })
    const skip = m.heartbeat.mock.calls.find((c) => c[0].jobName === 'cron-af-market-values')
    expect(skip?.[1]).toMatchObject({ status: 'partial', rowsWritten: 0 })
    vi.restoreAllMocks()
  })
})
