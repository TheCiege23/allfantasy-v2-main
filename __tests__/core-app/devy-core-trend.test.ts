// @vitest-environment node
/**
 * The cross-league Devy hub must not read a LEVEL as a trend.
 *
 * `DevyPlayer.stockTrendDelta` is written by `lib/workers/devy-data-worker.ts` as
 * `score/100*10 + c2cPoints/10` — non-negative for every scored prospect. The hub used to map its
 * sign to an arrow, so every prospect on the hub read "Trending up". The per-league tab already
 * said "no trend measured" (PR #1633); these pin that the hub now says the same, through the same
 * helper.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  pool: [] as Array<Record<string, unknown>>,
  findManyArgs: [] as any[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    devyPlayer: {
      findMany: vi.fn(async (args: any) => {
        db.findManyArgs.push(args)
        return db.pool
      }),
      groupBy: vi.fn(async () => []),
    },
    sportsNews: { findMany: vi.fn(async () => []) },
  },
}))

vi.mock('@/lib/core-app/dash3aPanels', () => ({
  getCrossLeagueExposure: vi.fn(async () => null),
}))

import { getDevyCoreData } from '@/lib/core-app/devy'
import { devyTrendOf, devyTrendPresentation, DEVY_NO_TREND_LABEL } from '@/lib/devy/devyTrend'

function row(id: string, stockTrendDelta: number | null, score: number) {
  return {
    id,
    name: `Prospect ${id}`,
    position: 'WR',
    school: 'Ohio State',
    classYearLabel: 'SO',
    draftProjectionScore: score,
    stockTrendDelta,
    headshotUrl: null,
    passAttempts: null,
    passCompletions: null,
    adot: null,
    airYardsAttempts: null,
  }
}

beforeEach(() => {
  db.pool = []
  db.findManyArgs = []
})

describe('getDevyCoreData — trend', () => {
  it('🛑 draws no arrow from stockTrendDelta: a positive LEVEL is not "trending up"', async () => {
    // The shape the worker actually writes: every scored prospect carries a positive number.
    db.pool = [row('a', 9.4, 94), row('b', 7.1, 71), row('c', 3.25, 32.5), row('d', -1.5, 10), row('e', null, 5)]

    const data = await getDevyCoreData('u1', [])

    expect(data.prospects).toHaveLength(5)
    for (const p of data.prospects) expect(p.trend).toBeNull()
  })

  it('asks the one shared helper, so the hub and the per-league tab give the same answer', async () => {
    db.pool = [row('a', 9.4, 94)]
    const data = await getDevyCoreData('u1', [])
    expect(data.prospects[0]!.trend).toBe(devyTrendOf({ id: 'a' }))
  })

  it('no longer selects stockTrendDelta at all, so nothing downstream can re-read it as a trend', async () => {
    await getDevyCoreData('u1', [])
    const select = db.findManyArgs[0]?.select ?? {}
    expect(Object.keys(select)).not.toContain('stockTrendDelta')
  })
})

describe('devyTrend helper', () => {
  it('reports no measured trend, whatever the row carries', () => {
    expect(devyTrendOf({ id: 'x', stockTrendDelta: 12 } as { id: string })).toBeNull()
  })

  it('presents an unmeasured trend as a neutral mark, never as Flat or an arrow', () => {
    expect(devyTrendPresentation(null)).toEqual({ glyph: '·', label: DEVY_NO_TREND_LABEL })
    expect(devyTrendPresentation('up').label).toBe('Trending up')
    expect(devyTrendPresentation('down').label).toBe('Trending down')
    expect(devyTrendPresentation('flat').label).toBe('Flat')
  })
})
