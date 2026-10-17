/**
 * Player outlook: FantasyCalc is an NFL value list and news is per sport. Both used to be matched by
 * name alone whatever `sport` said, so NHL Cam Ward wore NFL QB Cam Ward's dynasty value. The real
 * `findPlayerByName` runs here — only its data source is mocked — so the position hint is exercised.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fcValues: vi.fn(),
  newsFindMany: vi.fn(),
  readCache: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsNews: { findMany: mocks.newsFindMany } } }))
vi.mock('@/lib/enrichment-cache', () => ({ readCache: mocks.readCache, writeCache: vi.fn(async () => {}) }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: mocks.fcValues }))
vi.mock('@/lib/player-analytics', () => ({ getPlayerAnalytics: vi.fn(async () => null) }))
vi.mock('@/lib/injuries/currentInjuryDesignations', () => ({ resolveCurrentInjuryDesignations: vi.fn(async () => new Map()) }))

import { getPlayerOutlook } from '@/lib/player-outlook/player-outlook-service'

const fcRow = (name: string, position: string, team: string, value: number) => ({
  player: { id: value, name, position, maybeTeam: team, sleeperId: String(value), mflId: '' },
  value,
  overallRank: 10,
  positionRank: `${position}5`,
  trend30Day: 0,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readCache.mockResolvedValue(null)
  mocks.newsFindMany.mockResolvedValue([])
  mocks.fcValues.mockResolvedValue([
    fcRow('Cam Ward', 'QB', 'TEN', 6100),
    fcRow('Justin Jefferson', 'WR', 'MIN', 9800),
  ])
})

describe('player outlook — FantasyCalc only for NFL', () => {
  // No position hint on purpose: with `position: 'G'` the hint alone refuses the QB row and this test
  // stayed green with the sport gate deleted (mutation control, 2026-10-12). The batch POST sends none.
  it('NHL Cam Ward does not take the NFL QB value', async () => {
    const outlook = await getPlayerOutlook({ playerName: 'Cam Ward', sport: 'NHL' })
    expect(outlook.currentValue).toBe(0)
    expect(outlook.sourcesUsed).not.toContain('FantasyCalc')
    expect(mocks.fcValues).not.toHaveBeenCalled()
  })

  it('NFL Cam Ward still gets his value', async () => {
    const outlook = await getPlayerOutlook({ playerName: 'Cam Ward', sport: 'NFL', position: 'QB', team: 'TEN' })
    expect(outlook.currentValue).toBe(6100)
  })

  it('NFL LB Justin Jefferson is refused the WR value when the caller says LB', async () => {
    const outlook = await getPlayerOutlook({ playerName: 'Justin Jefferson', sport: 'NFL', position: 'LB', team: 'CLE' })
    expect(outlook.currentValue).toBe(0)
  })

  it('the position hint is part of the cache key, so the WR and LB never share an entry', async () => {
    await getPlayerOutlook({ playerName: 'Justin Jefferson', sport: 'NFL', position: 'LB' })
    expect(mocks.readCache.mock.calls[0]![2]).toMatchObject({ sport: 'NFL', position: 'LB' })
  })
})

describe('player outlook — news is scoped to the sport', () => {
  it('the news query filters on sport', async () => {
    await getPlayerOutlook({ playerName: 'Cam Ward', sport: 'NHL' })
    expect(mocks.newsFindMany.mock.calls[0]![0].where.sport).toBe('NHL')
  })
})
