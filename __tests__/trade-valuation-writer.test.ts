import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The property under test is restraint, not arithmetic.
 *
 * `computeManagerTendencies` filters `t.analyzed || t.valueGiven != null`. So marking a
 * trade analyzed is a claim that it was genuinely valued — and a trade written with zeros
 * because nothing could be priced enters manager tendencies as a real observation of an
 * even trade, indistinguishable from one. These assert the writer declines rather than
 * guesses.
 */
const update = vi.fn()
const findManyTrade = vi.fn()
const findManyHistory = vi.fn()
const findManyPlayer = vi.fn()
const computeDual = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTrade: {
      findMany: (...a: unknown[]) => findManyTrade(...a),
      update: (...a: unknown[]) => update(...a),
    },
    leagueTradeHistory: { findMany: (...a: unknown[]) => findManyHistory(...a) },
    sportsPlayer: { findMany: (...a: unknown[]) => findManyPlayer(...a) },
  },
}))
vi.mock('@/lib/hybrid-valuation', () => ({
  computeDualModeTradeDelta: (...a: unknown[]) => computeDual(...a),
}))

import { valueStoredTrades } from '@/lib/trade-valuation/valueStoredTrades'

const TRADE = {
  id: 't1',
  historyId: 'h1',
  transactionId: 'tx1',
  week: 3,
  tradeDate: new Date('2023-08-30T00:00:00Z'),
  isSuperFlex: true,
  playersGiven: ['6813'],
  playersReceived: ['8148'],
  picksGiven: [],
  picksReceived: [],
  partnerRosterId: 8,
}

beforeEach(() => {
  update.mockReset(); findManyTrade.mockReset(); findManyHistory.mockReset()
  findManyPlayer.mockReset(); computeDual.mockReset()
  findManyHistory.mockResolvedValue([{ id: 'h1', sleeperUsername: '591462610482806784' }])
  findManyPlayer.mockResolvedValue([
    { sleeperId: '6813', name: 'Given Guy', position: 'RB' },
    { sleeperId: '8148', name: 'Got Guy', position: 'WR' },
  ])
})

describe('trade valuation writer: never claims a value it does not have', () => {
  it('writes the valuation and marks analyzed when the engine prices it', async () => {
    findManyTrade.mockResolvedValue([TRADE])
    computeDual.mockResolvedValue({
      atTheTime: { userGaveValue: 1200, userReceivedValue: 1500, deltaValue: 300, percentDiff: 25, verdict: 'win' },
      withHindsight: null, comparison: '',
    })
    const r = await valueStoredTrades()
    expect(r.valued).toBe(1)
    expect(update).toHaveBeenCalledTimes(1)
    const data = update.mock.calls[0][0].data
    expect(data).toMatchObject({ valueGiven: 1200, valueReceived: 1500, valueDifferential: 300, analyzed: true })
  })

  it('leaves the row untouched when the date has no value coverage', async () => {
    findManyTrade.mockResolvedValue([TRADE])
    computeDual.mockResolvedValue({ atTheTime: null, withHindsight: null, comparison: '' })
    const r = await valueStoredTrades()
    expect(r.unpriceable).toBe(1)
    expect(r.valued).toBe(0)
    expect(update).not.toHaveBeenCalled()
    expect(Object.keys(r.reasons)).toContain('no value for that date')
  })

  it('skips rather than half-values a trade with an unresolvable player', async () => {
    findManyTrade.mockResolvedValue([TRADE])
    findManyPlayer.mockResolvedValue([{ sleeperId: '8148', name: 'Got Guy', position: 'WR' }]) // 6813 missing
    const r = await valueStoredTrades()
    expect(r.skipped).toBe(1)
    expect(computeDual).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('skips a trade with no date — there is no "at the time" without one', async () => {
    findManyTrade.mockResolvedValue([{ ...TRADE, tradeDate: null }])
    const r = await valueStoredTrades()
    expect(r.skipped).toBe(1)
    expect(computeDual).not.toHaveBeenCalled()
  })

  it('skips a trade carrying no assets on either side', async () => {
    findManyTrade.mockResolvedValue([{ ...TRADE, playersGiven: [], playersReceived: [], picksGiven: [], picksReceived: [] }])
    const r = await valueStoredTrades()
    expect(r.skipped).toBe(1)
    expect(computeDual).not.toHaveBeenCalled()
  })

  it('mirrors the two sides — what the owner gave is what the partner received', async () => {
    findManyTrade.mockResolvedValue([TRADE])
    computeDual.mockResolvedValue({
      atTheTime: { userGaveValue: 1, userReceivedValue: 1, deltaValue: 0, percentDiff: 0, verdict: 'even' },
      withHindsight: null, comparison: '',
    })
    await valueStoredTrades()
    const [userTrade, viewerId, isSF] = computeDual.mock.calls[0]
    expect(viewerId).toBe('591462610482806784')
    expect(isSF).toBe(true)
    expect(userTrade.parties[0].playersReceived).toEqual([{ name: 'Got Guy', position: 'WR' }])
    expect(userTrade.parties[1].playersReceived).toEqual([{ name: 'Given Guy', position: 'RB' }])
  })

  it('a thrown valuation is counted, not fatal to the batch', async () => {
    findManyTrade.mockResolvedValue([TRADE, { ...TRADE, id: 't2' }])
    computeDual
      .mockRejectedValueOnce(new Error('provider exploded'))
      .mockResolvedValueOnce({
        atTheTime: { userGaveValue: 5, userReceivedValue: 9, deltaValue: 4, percentDiff: 10, verdict: 'win' },
        withHindsight: null, comparison: '',
      })
    const r = await valueStoredTrades()
    expect(r.failed).toBe(1)
    expect(r.valued).toBe(1)
  })

  it('does nothing at all when there is nothing unvalued', async () => {
    findManyTrade.mockResolvedValue([])
    const r = await valueStoredTrades()
    expect(r).toMatchObject({ considered: 0, valued: 0, unpriceable: 0, skipped: 0, failed: 0 })
    expect(findManyPlayer).not.toHaveBeenCalled()
  })
})
