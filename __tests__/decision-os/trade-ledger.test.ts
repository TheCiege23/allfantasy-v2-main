import { describe, expect, it } from 'vitest'
import { gradeTradeRows, tradeLedgerRow, type TradeLedgerRow } from '@/lib/decision-os/trade/tradeLedger'

/*
 * The advice ledger's trade half (2026-11-15): a saved evaluateTrade() receipt becomes a gradable row —
 * the letter for the give side, which players went which way — and rows are graded by the net points
 * the GET side out-scored the GIVE side once the weeks are played. Only what the receipt can prove.
 */

const receipt = (over: Record<string, unknown> = {}) => ({
  surface: 'trade-evaluator',
  grade: { graded: true, letter: 'B+', leagueType: { type: 'redraft' } },
  assets: [{ side: 'give', kind: 'player' }, { side: 'get', kind: 'player' }],
  canonical: {
    proposerRosterId: 'me',
    receiverRosterId: 'them',
    moves: [
      { fromRosterId: 'me', toRosterId: 'them', playerId: 'P_GIVE', name: 'Give Guy' },
      { fromRosterId: 'them', toRosterId: 'me', playerId: 'P_GET', name: 'Get Guy' },
    ],
  },
  ...over,
})

describe('tradeLedgerRow', () => {
  it('reads the letter, the format and which player went which way', () => {
    expect(tradeLedgerRow({ receipt: receipt(), surface: 'proposal', isTrade: true, fromWeek: 6 })).toEqual({
      surface: 'proposal',
      letter: 'B',
      format: 'redraft',
      fromWeek: 6,
      getPlayerIds: ['P_GET'],
      givePlayerIds: ['P_GIVE'],
      nonPlayerAssets: false,
      isTrade: true,
    })
  })

  it('flags picks/FAAB (no points) and a dynasty format', () => {
    const row = tradeLedgerRow({
      receipt: receipt({ grade: { graded: true, letter: 'A', leagueType: { type: 'dynasty_sf' } }, assets: [{ kind: 'pick' }] }),
      surface: null,
      isTrade: false,
      fromWeek: 3,
    }) as TradeLedgerRow
    expect(row.format).toBe('dynasty')
    expect(row.nonPlayerAssets).toBe(true)
    expect(row.surface).toBe('trade-evaluator')
  })

  it('🛑 never guesses: no grade, no moves, no player ids, or a finished season are skips', () => {
    expect(tradeLedgerRow({ receipt: receipt({ grade: { graded: false } }), surface: null, isTrade: false, fromWeek: 3 })).toEqual({ skip: 'ungraded' })
    expect(tradeLedgerRow({ receipt: receipt({ canonical: null }), surface: null, isTrade: false, fromWeek: 3 })).toEqual({ skip: 'no_moves' })
    expect(
      tradeLedgerRow({ receipt: receipt({ canonical: { proposerRosterId: 'me', moves: [{ fromRosterId: 'me', toRosterId: 'them', playerId: null }] } }), surface: null, isTrade: false, fromWeek: 3 }),
    ).toEqual({ skip: 'no_players' })
    expect(tradeLedgerRow({ receipt: receipt(), surface: null, isTrade: false, fromWeek: null })).toEqual({ skip: 'season_over' })
  })
})

describe('gradeTradeRows', () => {
  const row = (letter: string, fromWeek: number, get: string[], give: string[]): TradeLedgerRow => ({
    surface: 's', letter, format: 'redraft', fromWeek, getPlayerIds: get, givePlayerIds: give, nonPlayerAssets: false, isTrade: true,
  })
  const ppw: Record<string, number> = { G1: 15, G2: 4, X1: 8, X2: 12 }
  const points = (ids: readonly string[]) => (ids.every((id) => id in ppw) ? ids.reduce((a, id) => a + ppw[id]!, 0) : null)

  it('nets GET minus GIVE per week, by letter, and counts who came out ahead', () => {
    const out = gradeTradeRows([row('A', 3, ['G1'], ['X1']), row('A', 4, ['G2'], ['X1']), row('F', 3, ['G2'], ['X2'])], 9, points)
    expect(out.byLetter.get('A')).toEqual({ n: 2, netPerWeek: 1.5, positive: 1, negative: 1 })
    expect(out.byLetter.get('F')).toEqual({ n: 1, netPerWeek: -8, positive: 0, negative: 1 })
  })

  it('a window not yet played is pending; a player the feed cannot place makes the row unscored, not zero', () => {
    const out = gradeTradeRows([row('B', 10, ['G1'], ['X1']), row('B', 3, ['NOPE'], ['X1'])], 9, points)
    expect(out.pending).toBe(1)
    expect(out.unscored).toBe(1)
    expect(out.byLetter.size).toBe(0)
  })

  it('a one-sided move (only receiving) still grades: the empty side scores 0', () => {
    const out = gradeTradeRows([row('C', 3, ['G1'], [])], 9, points)
    expect(out.byLetter.get('C')).toEqual({ n: 1, netPerWeek: 15, positive: 1, negative: 0 })
  })
})
