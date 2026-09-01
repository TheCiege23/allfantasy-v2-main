/**
 * The fourth sibling's mapping: Sleeper transactions -> TransactionFact rows.
 *
 * ── 🛑 THE ONE ASSERTION THAT MATTERS MOST IS THE ID ──────────────────────────────────────────
 * `TransactionFact.transactionId` is the model's `@id`, and `SleeperTradeFactIngest` already
 * writes trades into this table keyed `${sleeperTransactionId}:${rosterId}`. If this service
 * invents any other key, the two writers stop converging and start DUPLICATING — silently, into
 * a warehouse table `MetaAnalysisService` counts. Nothing would throw; the numbers would just be
 * wrong. That is why the key format is pinned here as a literal rather than recomputed.
 */
import { describe, expect, it } from 'vitest'

import { buildTransactionFacts } from '@/lib/league-import/sleeper/SleeperHistoricalTransactionSyncService'
import type { SleeperTransaction } from '@/lib/sleeper-client'

const BASE = {
  status: 'complete',
  draft_picks: [],
  waiver_budget: [],
  leg: 3,
  created: 1_756_700_000_000,
  creator: 'u1',
  consenter_ids: [],
  status_updated: 1_756_700_000_000,
} as const

function tx(overrides: Partial<SleeperTransaction>): SleeperTransaction {
  return {
    ...BASE,
    type: 'free_agent',
    transaction_id: 't1',
    roster_ids: [],
    adds: null,
    drops: null,
    ...overrides,
  } as SleeperTransaction
}

const CTX = { internalLeagueId: 'lg1', sport: 'NFL', season: 2025 }

describe('buildTransactionFacts', () => {
  it('🛑 keys exactly as SleeperTradeFactIngest does, so both writers hit the same row', () => {
    const rows = buildTransactionFacts({
      tx: tx({ type: 'trade', transaction_id: 'abc123', roster_ids: [4, 7] }),
      ...CTX,
    })
    const ids = rows.map((r) => r.transactionId).sort()
    // The literal format, not a recomputation of the same expression under test.
    expect(ids).toEqual(['abc123:4', 'abc123:7'])
  })

  it('writes one row per roster involved in a trade', () => {
    const rows = buildTransactionFacts({
      tx: tx({
        type: 'trade',
        transaction_id: 'tr9',
        roster_ids: [1, 2],
        adds: { '4034': 1, '6801': 2 },
        drops: { '6801': 1, '4034': 2 },
      }),
      ...CTX,
    })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.type === 'trade')).toBe(true)
    expect(rows.map((r) => r.rosterId).sort()).toEqual(['1', '2'])

    const rosterOne = rows.find((r) => r.rosterId === '1')!
    expect(rosterOne.payload.adds).toEqual(['4034'])
    expect(rosterOne.payload.drops).toEqual(['6801'])
  })

  it('records FAAB moved BETWEEN rosters, signed per side', () => {
    // `waiver_budget` is a transfer between managers — which happens in a TRADE, not in a claim.
    const rows = buildTransactionFacts({
      tx: tx({
        type: 'trade',
        transaction_id: 'tr5',
        roster_ids: [3, 8],
        waiver_budget: [{ sender: 3, receiver: 8, amount: 17 }],
      }),
      ...CTX,
    })
    expect(rows.find((r) => r.rosterId === '3')!.payload.faabNet).toBe(-17) // gave 17
    expect(rows.find((r) => r.rosterId === '8')!.payload.faabNet).toBe(17) // got 17
  })

  it('⚠ a roster that ONLY moved FAAB still gets a row', () => {
    // Regression: the first version scanned roster_ids/adds/drops only, so the receiver of a
    // FAAB-only transfer silently vanished. A missing row is not something a consumer notices.
    const rows = buildTransactionFacts({
      tx: tx({ type: 'trade', roster_ids: [3], waiver_budget: [{ sender: 3, receiver: 8, amount: 5 }] }),
      ...CTX,
    })
    expect(rows.map((r) => r.rosterId).sort()).toEqual(['3', '8'])
  })

  it('🛑 captures the waiver BID, which is a different fact from a FAAB transfer', () => {
    // The bid is what a manager paid the LEAGUE to win a claim, and it is the whole point of
    // FAAB history. It lives in `settings.waiver_bid`, not in `waiver_budget`.
    const rows = buildTransactionFacts({
      tx: tx({
        type: 'waiver',
        roster_ids: [2],
        adds: { '4034': 2 },
        settings: { waiver_bid: 41 },
      }),
      ...CTX,
    })
    expect(rows[0].payload.waiverBid).toBe(41)
    // ...and it must NOT be conflated with a transfer, which did not happen here.
    expect(rows[0].payload.faabNet).toBeNull()
  })

  it('leaves both null in a league that runs no budget', () => {
    const rows = buildTransactionFacts({
      tx: tx({ type: 'waiver', roster_ids: [2], adds: { '1': 2 } }),
      ...CTX,
    })
    // null, not 0 — "this league has no FAAB" and "they bid nothing" are different facts.
    expect(rows[0].payload.faabNet).toBeNull()
    expect(rows[0].payload.waiverBid).toBeNull()
  })

  it('reads a bid Sleeper sent as a string', () => {
    const rows = buildTransactionFacts({
      tx: tx({ type: 'waiver', roster_ids: [2], settings: { waiver_bid: '13' } }),
      ...CTX,
    })
    expect(rows[0].payload.waiverBid).toBe(13)
  })

  it('⚠ falls back to adds/drops when roster_ids is empty', () => {
    // A commissioner move can name a roster only in `adds`. A row with no manager is a fact
    // nobody can be asked about, so it must not be dropped on the floor.
    const rows = buildTransactionFacts({
      tx: tx({ type: 'commissioner', roster_ids: [], adds: { '77': 5 } }),
      ...CTX,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].rosterId).toBe('5')
  })

  it('sets playerId only when the move concerned exactly one player', () => {
    const single = buildTransactionFacts({
      tx: tx({ type: 'free_agent', roster_ids: [1], adds: { '4034': 1 } }),
      ...CTX,
    })
    expect(single[0].playerId).toBe('4034')

    // 🛑 A multi-player trade has no single representative. Picking one would make an INDEXED
    // column assert something false; the full list is in the payload either way.
    const multi = buildTransactionFacts({
      tx: tx({
        type: 'trade',
        roster_ids: [1],
        adds: { '4034': 1, '6801': 1 },
      }),
      ...CTX,
    })
    expect(multi[0].playerId).toBeNull()
    expect(multi[0].payload.adds).toEqual(['4034', '6801'])
  })

  it('preserves the season and the leg it came from', () => {
    const rows = buildTransactionFacts({
      tx: tx({ type: 'waiver', roster_ids: [1], leg: 11 }),
      ...CTX,
    })
    expect(rows[0].season).toBe(2025)
    expect(rows[0].weekOrPeriod).toBe(11)
    expect(rows[0].leagueId).toBe('lg1')
    expect(rows[0].sport).toBe('NFL')
  })

  it('keeps Sleeper’s own type rather than inventing one', () => {
    // The scope doc lists a `drop` type. Sleeper does not emit one — a drop is a free_agent or
    // waiver transaction carrying only `drops`. Manufacturing a type the provider never sent
    // would be fabrication in a fact table.
    for (const t of ['trade', 'waiver', 'free_agent', 'commissioner'] as const) {
      const rows = buildTransactionFacts({ tx: tx({ type: t, roster_ids: [1] }), ...CTX })
      expect(rows[0].type).toBe(t)
    }
  })

  it('returns nothing when no roster can be identified', () => {
    expect(buildTransactionFacts({ tx: tx({ roster_ids: [] }), ...CTX })).toEqual([])
  })
})

describe('the control: these assertions can fail', () => {
  it('a wrong key format is rejected', () => {
    const rows = buildTransactionFacts({
      tx: tx({ type: 'trade', transaction_id: 'abc123', roster_ids: [4] }),
      ...CTX,
    })
    // If the key ever became bare `transaction_id` — the most likely wrong choice, and the one
    // that would collapse every roster of a trade into a single row — this fails.
    expect(rows[0].transactionId).not.toBe('abc123')
    expect(() => expect(rows[0].transactionId).toBe('abc123')).toThrow()
  })
})
