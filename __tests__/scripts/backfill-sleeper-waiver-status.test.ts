// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { statusUpdatesFor } from '../../scripts/backfill-sleeper-waiver-status'

describe('backfill-sleeper-waiver-status: which rows a week stamps', () => {
  const base = {
    transaction_id: 't1', type: 'waiver', status: 'complete', leg: 3,
    created: Date.parse('2026-09-21T18:00:00Z'), status_updated: Date.parse('2026-09-23T10:00:04Z'),
    roster_ids: [3], adds: { p1: 3 }, drops: { p2: 3 }, settings: { waiver_bid: 7 }, draft_picks: [], waiver_budget: [],
  }

  it('stamps every fact row the sync keyed for a completed claim, with its resolution instant', () => {
    expect(statusUpdatesFor([base] as never, 'A', 2026)).toEqual([{ transactionId: 't1:3', statusUpdatedAt: '2026-09-23T10:00:04.000Z' }])
  })

  it('skips failed claims, non-waiver moves and claims with no resolution stamp', () => {
    const txs = [
      { ...base, transaction_id: 'f', status: 'failed' },
      { ...base, transaction_id: 'fa', type: 'free_agent' },
      { ...base, transaction_id: 'tr', type: 'trade' },
      { ...base, transaction_id: 'z', status_updated: 0 },
    ]
    expect(statusUpdatesFor(txs as never, 'A', 2026)).toEqual([])
  })
})
