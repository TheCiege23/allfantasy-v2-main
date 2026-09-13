import { describe, expect, it } from 'vitest'
import { normalizeFleaflickerTransactions } from '@/lib/league-import/fleaflicker/fleaflickerTransactions'

describe('normalizeFleaflickerTransactions', () => {
  it('groups explicit trade assets and keeps the terminal provider status', () => {
    const result = normalizeFleaflickerTransactions({
      items: [
        { timeEpochMilli: '1770000000000', trade: { tradeId: 42, type: 'TRADE_PROPOSED', team: { id: 1, name: 'A' } } },
        { timeEpochMilli: '1770000001000', transaction: { type: 'TRANSACTION_TRADE', tradeId: 42, team: { id: 2, name: 'B' }, player: { proPlayer: { id: 99, nameFull: 'Player' } } } },
        { timeEpochMilli: '1770000002000', transaction: { type: 'TRANSACTION_TRADE', tradeId: 42, team: { id: 1, name: 'A' }, draftPick: { season: 2028, round: 2 } } },
        { timeEpochMilli: '1770000003000', trade: { tradeId: 42, type: 'TRADE_ACCEPTED_FINAL', team: { id: 2, name: 'B' } } },
      ],
    }, '2026-09-13T00:00:00.000Z')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      source_transaction_id: '42',
      type: 'trade',
      status: 'TRADE_ACCEPTED_FINAL',
      adds: { '99': '2' },
      roster_ids: ['1', '2'],
      draft_picks: [{ season: 2028, round: 2, toRosterId: '1' }],
      lifecycle_events: expect.arrayContaining([
        expect.objectContaining({ stage: 'TRADE_PROPOSED', team_id: '1' }),
        expect.objectContaining({ stage: 'TRADE_ACCEPTED_FINAL', team_id: '2' }),
      ]),
    })
  })

  it('does not invent a trade from an unrelated add/drop event', () => {
    expect(normalizeFleaflickerTransactions({
      items: [{ transaction: { type: 'TRANSACTION_ADD', team: { id: 1, name: 'A' }, player: { proPlayer: { id: 9 } } } }],
    }, '2026-09-13T00:00:00.000Z')).toEqual([])
  })
})
