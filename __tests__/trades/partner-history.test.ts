import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { summarizeTradeHistory, type TradeFactRow } from '@/lib/trade-intel/partnerHistory'
import { buildRosterIdMap } from '@/lib/core-app/rosterIdMatch'

/*
 * Provider roster ids → Roster.id. MFL pads ("0003"); a fact may carry "3". The map is built the
 * padding-safe way the rest of the repo uses.
 */
const MAP = buildRosterIdMap(
  [
    { externalId: '1', rosterId: 'R1' },
    { externalId: '2', rosterId: 'R2' },
    { externalId: '0003', rosterId: 'R3' },
  ],
  (t) => t.externalId,
  (t) => t.rosterId,
)

const fact = (over: Partial<TradeFactRow>): TradeFactRow => ({
  factId: `f${Math.random()}`,
  rosterId: null,
  tradeKey: null,
  rosterIds: null,
  status: 'complete',
  ...over,
})

describe('summarizeTradeHistory', () => {
  it('🛑 counts a TRADE once per party, not once per fact row', () => {
    // Sleeper: one row per side, both carrying the full party list.
    const facts = [
      fact({ tradeKey: 't1', rosterId: '1', rosterIds: ['1', '2'] }),
      fact({ tradeKey: 't1', rosterId: '2', rosterIds: ['1', '2'] }),
      // ESPN-style: one row per moved asset, no party list — grouped by the transaction id.
      fact({ tradeKey: 't2', rosterId: '2' }),
      fact({ tradeKey: 't2', rosterId: '2' }),
      fact({ tradeKey: 't2', rosterId: '0003' }),
    ]
    const h = summarizeTradeHistory({ facts, nativeTrades: [], rosterIdByProviderId: MAP, viewerRosterId: 'R1' })
    expect(Object.fromEntries(h.tradesByRoster)).toEqual({ R1: 1, R2: 2, R3: 1 })
    expect(Object.fromEntries(h.tradesWithViewer)).toEqual({ R2: 1 })
  })

  it('matches a de-padded provider id to a padded external id', () => {
    const h = summarizeTradeHistory({
      facts: [fact({ tradeKey: 't9', rosterId: '3', rosterIds: ['1', '3'] })],
      nativeTrades: [],
      rosterIdByProviderId: MAP,
      viewerRosterId: 'R1',
    })
    expect(h.tradesWithViewer.get('R3')).toBe(1)
  })

  it('ignores trades that did not complete', () => {
    const h = summarizeTradeHistory({
      facts: [
        fact({ tradeKey: 'a', rosterIds: ['1', '2'], status: 'failed' }),
        fact({ tradeKey: 'b', rosterIds: ['1', '2'], status: 'Pending' }),
        fact({ tradeKey: 'c', rosterIds: ['1', '2'], status: 'vetoed' }),
        fact({ tradeKey: 'd', rosterIds: ['1', '2'], status: null }),
        fact({ tradeKey: 'e', rosterIds: ['1', '2'], status: 'successful' }),
      ],
      nativeTrades: [],
      rosterIdByProviderId: MAP,
      viewerRosterId: 'R1',
    })
    // d (no status: pre-field rows, and the Sleeper sweep only writes completes) and e.
    expect(h.tradesByRoster.get('R1')).toBe(2)
  })

  it('counts a keyless row once for its own roster, and pairs it with nobody', () => {
    const h = summarizeTradeHistory({
      facts: [fact({ factId: 'x1', rosterId: '1' }), fact({ factId: 'x2', rosterId: '2' })],
      nativeTrades: [],
      rosterIdByProviderId: MAP,
      viewerRosterId: 'R1',
    })
    expect(Object.fromEntries(h.tradesByRoster)).toEqual({ R1: 1, R2: 1 })
    expect(h.tradesWithViewer.size).toBe(0)
  })

  it('adds native trades, which are already in Roster.id space', () => {
    const h = summarizeTradeHistory({
      facts: [],
      nativeTrades: [
        { id: 'n1', proposerRosterId: 'R1', receiverRosterId: 'R3' },
        { id: 'n2', proposerRosterId: 'R2', receiverRosterId: 'R3' },
      ],
      rosterIdByProviderId: MAP,
      viewerRosterId: 'R1',
    })
    expect(Object.fromEntries(h.tradesByRoster)).toEqual({ R1: 1, R3: 2, R2: 1 })
    expect(Object.fromEntries(h.tradesWithViewer)).toEqual({ R3: 1 })
  })

  it('drops parties it cannot place on a roster rather than inventing one', () => {
    const h = summarizeTradeHistory({
      facts: [fact({ tradeKey: 'q', rosterIds: ['1', '99'] })],
      nativeTrades: [],
      rosterIdByProviderId: MAP,
      viewerRosterId: 'R1',
    })
    expect(Object.fromEntries(h.tradesByRoster)).toEqual({ R1: 1 })
    expect(h.tradesWithViewer.size).toBe(0)
  })
})
