import { describe, expect, it } from 'vitest'

import { buildTradeFactPayload } from '@/lib/psychological-profiles/SleeperTradeFactIngest'

/**
 * Trade contents, kept instead of counted.
 *
 * `transactionFact` holds 7,341 trade rows and every one of them has `playerId: null`, because
 * the ingest recorded `playersIn: 1, playersOut: 1` and discarded which players those were. A
 * trade with no contents can answer "did they trade" and nothing about what anything was
 * worth — which is why the IDP-to-offence exchange rate could not be derived from behaviour.
 */

/** A real two-for-one: roster 4 sends two players and a pick, roster 8 sends one back. */
const TRADE = {
  transaction_id: '1362854696355655680',
  type: 'trade',
  status: 'complete',
  roster_ids: [4, 8],
  adds: { '4034': 8, '6794': 8, '5045': 4 },
  drops: { '4034': 4, '6794': 4, '5045': 8 },
  draft_picks: [{ season: '2027', round: 1, roster_id: 4, owner_id: 8, previous_owner_id: 4 }],
}

describe('buildTradeFactPayload', () => {
  it('keeps who came in and who went out, from this roster’s side', () => {
    const forEight = buildTradeFactPayload(TRADE, 8, TRADE.transaction_id, TRADE.roster_ids)
    expect(forEight.playersInIds).toEqual(['4034', '6794'])
    expect(forEight.playersOutIds).toEqual(['5045'])

    // The same trade read from the other side is the mirror image.
    const forFour = buildTradeFactPayload(TRADE, 4, TRADE.transaction_id, TRADE.roster_ids)
    expect(forFour.playersInIds).toEqual(['5045'])
    expect(forFour.playersOutIds).toEqual(['4034', '6794'])
  })

  it('leaves the counts byte-identical, because live readers consume them', () => {
    /*
     * `BehaviorSignalAggregator` and the warehouse services already read `playersIn` /
     * `playersOut` / `picks`. Enrichment that changed them would be a rewrite wearing an
     * addition's clothes.
     */
    const p = buildTradeFactPayload(TRADE, 8, TRADE.transaction_id, TRADE.roster_ids)
    expect(p.playersIn).toBe(2)
    expect(p.playersOut).toBe(1)
    expect(p.picks).toBe(1)
    expect(p.sleeperTransactionId).toBe('1362854696355655680')
    expect(p.rosterIds).toEqual([4, 8])
    expect(p.source).toBe('sleeper_transactions')
  })

  it('carries the counts and the ids in agreement', () => {
    for (const rosterId of [4, 8]) {
      const p = buildTradeFactPayload(TRADE, rosterId, TRADE.transaction_id, TRADE.roster_ids)
      expect((p.playersInIds as string[]).length).toBe(p.playersIn)
      expect((p.playersOutIds as string[]).length).toBe(p.playersOut)
    }
  })

  it('stores draft picks verbatim rather than inventing a schema for them', () => {
    const p = buildTradeFactPayload(TRADE, 8, TRADE.transaction_id, TRADE.roster_ids)
    expect(p.pickDetail).toEqual(TRADE.draft_picks)
  })

  it('handles a trade with no players, no picks, or missing maps without throwing', () => {
    const bare = { transaction_id: 't1', roster_ids: [1, 2] }
    const p = buildTradeFactPayload(bare, 1, 't1', [1, 2])
    expect(p.playersInIds).toEqual([])
    expect(p.playersOutIds).toEqual([])
    expect(p.playersIn).toBe(0)
    expect(p.picks).toBe(0)
    expect(p.pickDetail).toEqual([])

    const nulls = { transaction_id: 't2', roster_ids: [1], adds: null, drops: null, draft_picks: null }
    expect(() => buildTradeFactPayload(nulls, 1, 't2', [1])).not.toThrow()
  })

  it('attributes nothing to a roster that was not in the trade', () => {
    const p = buildTradeFactPayload(TRADE, 11, TRADE.transaction_id, TRADE.roster_ids)
    expect(p.playersInIds).toEqual([])
    expect(p.playersOutIds).toEqual([])
  })
})
