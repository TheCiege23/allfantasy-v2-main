import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * The historical backfill and the live sync upsert the SAME `LeagueTrade` row, and both write
 * `tradeDate`. The backfill used Sleeper's `created` (proposal time) while the live path used the
 * completion time, so each backfill pass dated a trade accepted today back to the day it was
 * offered — which is how a fresh trade read "3d ago" on Core.
 */
const getLeagueTransactions = vi.hoisted(() => vi.fn())

vi.mock('@/lib/sleeper-client', () => ({
  getLeagueHistory: vi.fn(),
  getLeagueRosters: vi.fn(),
  getLeagueUsers: vi.fn(),
  getLeagueTransactions,
  getPlayoffBracket: vi.fn(),
}))

import { fetchSleeperTradesForSeason, sleeperTradeCompletedAt } from '@/lib/dynasty-import/sleeper-historical'
import { SleeperHistoryMapper } from '@/lib/league-import/adapters/sleeper/SleeperHistoryMapper'

const PROPOSED = Date.parse('2026-09-24T18:00:00Z')
const ACCEPTED = Date.parse('2026-09-27T17:30:00Z')

function tx(overrides: Record<string, unknown> = {}) {
  return {
    transaction_id: 'tx-1',
    type: 'trade',
    status: 'complete',
    created: PROPOSED,
    status_updated: ACCEPTED,
    roster_ids: [1, 2],
    adds: { '4034': 2 },
    drops: { '4034': 1 },
    draft_picks: [],
    creator: 'u1',
    ...overrides,
  }
}

beforeEach(() => {
  getLeagueTransactions.mockReset()
})

describe('sleeperTradeCompletedAt', () => {
  it('uses the completion time for a completed trade', () => {
    expect(sleeperTradeCompletedAt(tx())).toBe(ACCEPTED)
  })

  it('falls back to created when the trade is not complete or has no status_updated', () => {
    expect(sleeperTradeCompletedAt(tx({ status: 'failed' }))).toBe(PROPOSED)
    expect(sleeperTradeCompletedAt(tx({ status_updated: undefined }))).toBe(PROPOSED)
    expect(sleeperTradeCompletedAt(tx({ status_updated: 0 }))).toBe(PROPOSED)
    expect(sleeperTradeCompletedAt({})).toBe(0)
  })

  it('agrees with the live mapper, so the two writers of tradeDate cannot disagree', () => {
    for (const t of [tx(), tx({ status: 'failed' }), tx({ status_updated: undefined })]) {
      const [mapped] = SleeperHistoryMapper.map({ transactions: [t] } as never).transactions
      const live = Date.parse(mapped.completed_at ?? mapped.created_at)
      expect(sleeperTradeCompletedAt(t)).toBe(live)
    }
  })
})

describe('fetchSleeperTradesForSeason', () => {
  it('dates a trade by when it was accepted, not when it was proposed', async () => {
    getLeagueTransactions.mockImplementation(async (_id: string, week: number) => (week === 3 ? [tx()] : []))
    const facts = await fetchSleeperTradesForSeason('lg', 2026, 4)
    expect(facts).toHaveLength(1)
    expect(facts[0].created).toBe(ACCEPTED)
    expect(facts[0].week).toBe(3)
  })

  it('drops a trade Sleeper reports as not completed, and keeps one with no status at all', async () => {
    getLeagueTransactions.mockImplementation(async (_id: string, week: number) =>
      week === 1
        ? [
            tx({ transaction_id: 'failed', status: 'failed' }),
            tx({ transaction_id: 'unlabelled', status: undefined }),
            tx({ transaction_id: 'done' }),
            { ...tx({ transaction_id: 'waiver' }), type: 'waiver' },
          ]
        : [],
    )
    const facts = await fetchSleeperTradesForSeason('lg', 2026, 1)
    expect(facts.map((f) => f.transactionId).sort()).toEqual(['done', 'unlabelled'])
  })
})
