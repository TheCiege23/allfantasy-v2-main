// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  cacheFindMany: vi.fn(),
  teamFindMany: vi.fn(),
  build: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { upsert: h.upsert, findMany: h.cacheFindMany },
    leagueTeam: { findMany: h.teamFindMany },
  },
}))
vi.mock('@/lib/core-app/portfolioInsights', async (orig) => ({
  ...(await orig<typeof import('@/lib/core-app/portfolioInsights')>()),
  buildPortfolioInsights: h.build,
}))

import {
  leagueSetFingerprint,
  readRecordedValueDays,
  runPortfolioDailyTotals,
  totalsKey,
  writeDailyTotals,
  TOTALS_USERS_PER_FIRE,
} from '@/lib/core-app/portfolioInsightsSummary'
import { getScreenSummaryDefinition } from '@/lib/sports-os/summaries'
import type { PortfolioInsights } from '@/lib/core-app/portfolioInsightsTypes'

// 15:00Z on 2026-09-16 is 11:00 in New York — the same Eastern day.
const NOW = new Date('2026-09-16T15:00:00Z')

function withValues(values: Array<number | null>, dates = ['2026-09-15', '2026-09-16']): PortfolioInsights {
  return {
    version: 1,
    builtAt: NOW.toISOString(),
    leagues: values.map((_, i) => ({ id: `l${i}` }) as PortfolioInsights['leagues'][number]),
    players: [],
    risk: [],
    nflWeek: null,
    byeWeeks: [],
    injuryGaps: [],
    injuryFeedStale: false,
    valueDates: dates,
    valueSeries: values.map((v, i) => ({ leagueIndex: i, values: [1, v], priced: [1, 1], rosterSize: 1 })),
    movers: [],
    playerValueBook: 'dynasty · superflex',
    notes: {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CORE_PORTFOLIO_TOTALS_DISABLED
  h.upsert.mockResolvedValue({})
})

describe('fingerprint', () => {
  it('🛑 changes with the league SET, not its order — and not with a sync', () => {
    const a = leagueSetFingerprint([{ id: 'x', season: 2026 }, { id: 'y', season: 2026 }])
    const b = leagueSetFingerprint([{ id: 'y', season: 2026 }, { id: 'x', season: 2026 }])
    expect(a).toBe(b)
    expect(leagueSetFingerprint([{ id: 'x', season: 2026 }])).not.toBe(a)
    const synced = leagueSetFingerprint([
      { id: 'x', season: 2026, lastSyncedAt: new Date() } as { id: string; season: number },
      { id: 'y', season: 2026 },
    ])
    expect(synced).toBe(a)
  })

  it('is registered as a screen summary with a version in its key', () => {
    const def = getScreenSummaryDefinition('portfolio-insights')
    expect(def?.version).toBe(1)
    expect(def?.ttlMs).toBe(20 * 60_000)
  })
})

describe('daily totals', () => {
  it('records the last capture day’s value per league under the Eastern day', async () => {
    expect(await writeDailyTotals('u1', withValues([100, null]), NOW)).toBe(true)
    const arg = h.upsert.mock.calls[0][0]
    expect(arg.where.cacheKey).toBe('core-portfolio:totals:v1:2026-09-16:u=u1')
    expect(arg.create.data).toMatchObject({ date: '2026-09-16', values: { l0: 100 } })
    const days = (arg.create.expiresAt.getTime() - NOW.getTime()) / 86_400_000
    expect(days).toBe(400)
  })

  it('writes nothing for an unpriced portfolio unless asked for a marker', async () => {
    expect(await writeDailyTotals('u1', withValues([null]), NOW)).toBe(false)
    expect(h.upsert).not.toHaveBeenCalled()
    expect(await writeDailyTotals('u1', null, NOW, { allowEmpty: true })).toBe(false)
    expect(h.upsert).toHaveBeenCalledTimes(1)
    expect(h.upsert.mock.calls[0][0].create.data).toMatchObject({ values: {} })
  })

  it('🛑 reads stored days back one per CAPTURE day, the later write winning, markers ignored', async () => {
    h.cacheFindMany.mockResolvedValue([
      { data: { date: '2026-09-14', builtAt: '2026-09-15T02:00:00Z', values: { l0: 90 } } },
      { data: { date: '2026-09-14', builtAt: '2026-09-14T20:00:00Z', values: { l0: 80 } } },
      { data: { date: '2026-09-16', builtAt: '2026-09-16T12:00:00Z', values: {} } },
      { data: { nonsense: true } },
      { data: { date: '2026-09-13', builtAt: '2026-09-13T12:00:00Z', values: { l0: 70 } } },
    ])
    const days = await readRecordedValueDays('u1', NOW, 3)
    expect(days).toEqual([
      { date: '2026-09-13', values: { l0: 70 } },
      { date: '2026-09-14', values: { l0: 90 } },
    ])
    const keys = h.cacheFindMany.mock.calls[0][0].where.cacheKey.in
    expect(keys).toEqual([
      totalsKey('2026-09-16', 'u1'),
      totalsKey('2026-09-15', 'u1'),
      totalsKey('2026-09-14', 'u1'),
      totalsKey('2026-09-13', 'u1'),
    ])
  })
})

describe('the scheduled writer', () => {
  it('does nothing when disabled', async () => {
    process.env.CORE_PORTFOLIO_TOTALS_DISABLED = 'true'
    const out = await runPortfolioDailyTotals(NOW)
    expect(out.date).toBeNull()
    expect(h.teamFindMany).not.toHaveBeenCalled()
  })

  it('skips users already recorded today and builds the rest, bounded per fire', async () => {
    const users = Array.from({ length: TOTALS_USERS_PER_FIRE + 3 }, (_, i) => `u${i}`)
    h.teamFindMany.mockResolvedValue(users.map((u) => ({ claimedByUserId: u })))
    h.cacheFindMany.mockResolvedValue([{ cacheKey: totalsKey('2026-09-16', 'u0') }])
    h.build.mockResolvedValue(withValues([10]))
    const out = await runPortfolioDailyTotals(NOW, { budgetMs: 60_000 })
    expect(out).toMatchObject({
      date: '2026-09-16',
      considered: users.length,
      alreadyWritten: 1,
      written: TOTALS_USERS_PER_FIRE,
      deferred: 2,
      failed: 0,
    })
    expect(h.build).not.toHaveBeenCalledWith('u0', NOW)
  })

  it('🛑 marks an unpriced user and a failing user done, so neither is retried first forever', async () => {
    h.teamFindMany.mockResolvedValue([{ claimedByUserId: 'empty' }, { claimedByUserId: 'broken' }, { claimedByUserId: 'ok' }])
    h.cacheFindMany.mockResolvedValue([])
    h.build.mockImplementation(async (u: string) => {
      if (u === 'broken') throw new Error('boom')
      return withValues([u === 'ok' ? 5 : null])
    })
    const out = await runPortfolioDailyTotals(NOW)
    expect(out).toMatchObject({ written: 1, empty: 1, failed: 1, deferred: 0 })
    expect(out.errors[0]).toMatch(/boom/)
    const written = h.upsert.mock.calls.map((c) => c[0].where.cacheKey)
    expect(written.sort()).toEqual(
      [totalsKey('2026-09-16', 'broken'), totalsKey('2026-09-16', 'empty'), totalsKey('2026-09-16', 'ok')].sort(),
    )
  })

  it('stops when the host route’s shared budget is spent', async () => {
    h.teamFindMany.mockResolvedValue([{ claimedByUserId: 'a' }, { claimedByUserId: 'b' }])
    h.cacheFindMany.mockResolvedValue([])
    h.build.mockResolvedValue(withValues([1]))
    const out = await runPortfolioDailyTotals(NOW, { budget: { exhausted: () => true } })
    expect(out.written).toBe(0)
    expect(out.deferred).toBe(2)
    expect(h.build).not.toHaveBeenCalled()
  })

  it('never throws — a failed candidate read is counted', async () => {
    h.teamFindMany.mockRejectedValue(new Error('db down'))
    const out = await runPortfolioDailyTotals(NOW)
    expect(out.failed).toBe(1)
    expect(out.errors[0]).toMatch(/db down/)
  })
})
