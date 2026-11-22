import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import wildCard from '../../contracts/espn/fixtures/scoreboard.NFL.20260110.json'

const mocks = vi.hoisted(() => ({ findCache: vi.fn(), upsertCache: vi.fn(), findPools: vi.fn(), updatePools: vi.fn(),
  findSeries: vi.fn(), updateSeries: vi.fn(), lock: vi.fn(), transaction: vi.fn(), field: vi.fn(), seeds: vi.fn(),
  alerts: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique: mocks.findCache, upsert: mocks.upsertCache },
  playoffBracketChallenge: { findMany: mocks.findPools, updateMany: mocks.updatePools },
  playoffBracketSeries: { findMany: mocks.findSeries, updateMany: mocks.updateSeries },
  $queryRaw: mocks.lock, $transaction: mocks.transaction } }))
vi.mock('@/lib/playoffs/playoffSeeding', () => ({ resolvePlayoffSeedField: mocks.field,
  applyPlayoffSeedsToChallenges: mocks.seeds }))
vi.mock('@/lib/chimmy/bracketChangeAlerts', () => ({ emitPlayoffDecisionAlerts: mocks.alerts,
  settleBracketAlertBatch: async <T>(items: T[], send: (item: T) => Promise<unknown>) => {
    await Promise.all(items.map(send)); return 0
  } }))

import { parseNflPlayoffScoreboard } from '@/lib/playoffs/nflPlayoffs'
import { syncNflPlayoffs } from '@/lib/playoffs/syncNflPlayoffs'

const FIELD = new Map([
  ['afc', new Map([[1, 'Denver Broncos'], [2, 'New England Patriots'], [3, 'Jacksonville Jaguars'],
    [4, 'Pittsburgh Steelers'], [5, 'Houston Texans'], [6, 'Buffalo Bills'], [7, 'Los Angeles Chargers']])],
  ['nfc', new Map([[1, 'Seattle Seahawks'], [2, 'Chicago Bears'], [3, 'Philadelphia Eagles'],
    [4, 'Carolina Panthers'], [5, 'Los Angeles Rams'], [6, 'San Francisco 49ers'], [7, 'Green Bay Packers']])],
])

beforeEach(() => {
  vi.clearAllMocks()
  mocks.field.mockResolvedValue({ isFinal: true, seeds: FIELD, warnings: [] })
  mocks.seeds.mockResolvedValue({ slotsFilled: 0 })
  mocks.findPools.mockResolvedValue([{ id: 'pool-1' }])
  mocks.lock.mockResolvedValue([{ acquired: true }])
  mocks.findSeries.mockResolvedValue([{ id: 'series-6', challengeId: 'pool-1', seriesNumber: 6,
    winnerTeamName: null, homeTeamName: 'Carolina Panthers', awayTeamName: 'Los Angeles Rams' }])
  mocks.alerts.mockResolvedValue(undefined)
  const games = parseNflPlayoffScoreboard(wildCard, 2025).map((game) => ({
    ...game, status: 'in_progress' as const, winnerTeamName: null,
  }))
  mocks.findCache.mockResolvedValue({ data: { games, checkedDates: {}, cursor: 0, syncedAt: '2026-01-10T00:00:00Z' } })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes('dates=20260110') ? wildCard : { events: [] }), { status: 200 })))
})
afterEach(() => vi.unstubAllGlobals())

describe('NFL committed final alerts', () => {
  it('dispatches a changed winner only after the pool transaction commits', async () => {
    let committed = false
    mocks.transaction.mockImplementation(async (fn: any) => {
      const result = await fn({ sportsDataCache: { findUnique: mocks.findCache, upsert: mocks.upsertCache },
        playoffBracketChallenge: { updateMany: mocks.updatePools },
        playoffBracketSeries: { findMany: mocks.findSeries, updateMany: mocks.updateSeries }, $queryRaw: mocks.lock })
      committed = true
      return result
    })
    mocks.alerts.mockImplementation(() => { expect(committed).toBe(true); return Promise.resolve() })
    const result = await syncNflPlayoffs({ season: 2025, apply: true, now: new Date('2026-01-11T12:00:00Z') })
    expect(result).toMatchObject({ applied: true, fieldFinal: true })
    expect(mocks.alerts).toHaveBeenCalledWith({ challengeId: 'pool-1', decisions: [expect.objectContaining({
      seriesId: 'series-6', beforeWinner: null, winner: 'Los Angeles Rams',
    })] })
  })

  it('does not send a historical final from the first provider snapshot', async () => {
    mocks.findCache.mockResolvedValue(null)
    mocks.transaction.mockImplementation(async (fn: any) => fn({
      sportsDataCache: { findUnique: mocks.findCache, upsert: mocks.upsertCache },
      playoffBracketChallenge: { updateMany: mocks.updatePools },
      playoffBracketSeries: { findMany: mocks.findSeries, updateMany: mocks.updateSeries }, $queryRaw: mocks.lock,
    }))
    await syncNflPlayoffs({ season: 2025, apply: true, now: new Date('2026-01-11T12:00:00Z') })
    expect(mocks.findSeries).not.toHaveBeenCalled()
    expect(mocks.alerts).not.toHaveBeenCalled()
  })
})
