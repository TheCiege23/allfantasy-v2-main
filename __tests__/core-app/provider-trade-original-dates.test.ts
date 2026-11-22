/**
 * A provider trade's original is priced at the time of the trade (Trade OS, 2026-11-16). ESPN/Yahoo/MFL/Fleaflicker
 * ids are not Sleeper snowflakes, so the frozen path could not read a time from them and every new original was
 * priced on the day someone first looked. The trade's own date is now passed — and a Sleeper trade is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const h = vi.hoisted(() => ({ withInputs: vi.fn(), archived: vi.fn() }))
vi.mock('@/lib/decision-os/trade/completedTradeGrade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/decision-os/trade/completedTradeGrade')>()),
  completedTradeGraderFor: vi.fn(async () => ({ grader: true })),
  gradeArchivedTradeWithInputs: h.withInputs,
  gradeArchivedTrade: h.archived,
}))
vi.mock('@/lib/decision-os/trade/frozenCompletedGrade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/decision-os/trade/frozenCompletedGrade')>()),
  loadFrozenCompletedGrades: vi.fn(async () => new Map()),
  saveFrozenCompletedGrades: vi.fn(async () => true),
}))

import { gradeArchivedTradeRows } from '@/lib/core-app/archivedTradeGrade'
import { gradeProviderRecentTrade, type RecentTrade } from '@/lib/core-app/recentTrades'

const ungraded = { graded: false, reason: 'x', basis: null }

beforeEach(() => {
  h.withInputs.mockReset()
  h.withInputs.mockResolvedValue({ grade: ungraded, give: { assets: [], unpriceable: [] }, get: { assets: [], unpriceable: [] } })
  h.archived.mockReset()
  h.archived.mockResolvedValue(ungraded)
})

const row = { transactionId: 'mfl-77', playersGiven: ['13604'], playersReceived: ['9999'], picksGiven: [], picksReceived: [], tradeDate: new Date('2026-10-01T00:00:00Z') }

describe('/core Trades rows', () => {
  it('a provider league’s row passes its trade date, and its ids through sleeperIdOf', async () => {
    await gradeArchivedTradeRows({ afLeagueId: 'L', platformLeagueId: 'p', rows: [row], nameOf: () => 'Someone', sleeperIdOf: (id) => (id === '13604' ? 'p1' : null) })
    const args = h.withInputs.mock.calls[0]![1]
    expect(args.original.tradeAt).toEqual(new Date('2026-10-01T00:00:00Z'))
    expect(args.gave).toEqual([{ name: 'Someone', sleeperId: 'p1' }])
    expect(args.received).toEqual([{ name: 'Someone', sleeperId: null }])
  })

  it('a Sleeper league’s row is unchanged: ids are Sleeper ids and the time comes from the id', async () => {
    await gradeArchivedTradeRows({ afLeagueId: 'L', platformLeagueId: 'p', rows: [row], nameOf: () => 'Someone' })
    const args = h.withInputs.mock.calls[0]![1]
    expect(args.original).not.toHaveProperty('tradeAt')
    expect(args.gave).toEqual([{ name: 'Someone', sleeperId: '13604' }])
  })
})

describe('/core recent band', () => {
  const trade = (id: string): RecentTrade => ({
    id,
    leagueId: 'L',
    leagueName: 'x',
    leagueAvatarUrl: null,
    platformLeagueId: 'p',
    acceptedAt: '2026-10-01T00:00:00.000Z',
    partial: false,
    verdict: null,
    sides: [
      { rosterId: 1, received: [{ name: 'A', kind: 'player', gradeAs: { kind: 'player', name: 'A' } }] },
      { rosterId: 2, received: [{ name: 'B', kind: 'player', gradeAs: { kind: 'player', name: 'B' } }] },
    ] as never,
  })

  it('a provider trade is priced on the day it was accepted', async () => {
    await gradeProviderRecentTrade(trade('espn:lg:abc-123'))
    expect(h.archived.mock.calls[0]![1].original.tradeAt).toBe('2026-10-01T00:00:00.000Z')
  })

  it('a Sleeper trade keeps reading its time from its snowflake id', async () => {
    await gradeProviderRecentTrade(trade('1338541390891606016:1094827364812345678'))
    expect(h.archived.mock.calls[0]![1].original).not.toHaveProperty('tradeAt')
  })
})
