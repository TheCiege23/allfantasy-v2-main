import { describe, expect, it, vi } from 'vitest'

import { boardObservationsFor, computeBoardSportMarket, describeBoardSportMarket, type BoardObservation } from '@/lib/trade-market/boardSportLearner'
import { BOARD_SPORT_MARKET_CACHE_KEY, runBoardSportLearning } from '@/lib/trade-market/boardSportLearning'

/*
 * Trade learning for the board-valued sports (owner's call, 2026-11-22): posture and need from the board values saved
 * with each trade — positions from the league's own slots, never an NFL list. Shadow.
 */

const NOW = new Date('2026-11-22T12:00:00Z')
const snapshot = (over: Record<string, unknown> = {}) => ({
  starterSlots: { PG: 1, C: 1, UTIL: 2 },
  boardValues: { sport: 'NBA', unit: 'fantasy points', byPlayer: { c1: 400, g1: 320 } },
  sides: [
    // Roster 1 (7-2): one center and it buys another — no spare at C. Roster 2 (4-5): two guards.
    { rosterId: '1', record: { wins: 7, losses: 2, ties: 0 }, rosterBefore: [{ id: 'g1', position: 'PG' }, { id: 'c0', position: 'C' }] },
    { rosterId: '2', record: { wins: 4, losses: 5, ties: 0 }, rosterBefore: [{ id: 'c1', position: 'C' }, { id: 'c2', position: 'C' }, { id: 'g2', position: 'PG' }] },
  ],
  ...over,
})
// Roster 1's row: gives g1 (320), receives c1 (400).
const row = (over: Record<string, unknown> = {}) => ({ transactionId: 't', week: 9, partnerRosterId: 2, playersGiven: ['g1'], playersReceived: ['c1'], contextSnapshot: snapshot(), ...over })

describe('one trade, both sides', () => {
  it('posture from each side\'s record, need from the league\'s own slots and the roster before', () => {
    const obs = boardObservationsFor(row(), 1) as BoardObservation[]
    expect(obs).toEqual([
      { kind: 'posture', transactionId: 't', group: 'contend', ratio: 0.8, weight: 1 },
      // Roster 1 bought a center holding one center for one C slot: short.
      { kind: 'need', transactionId: 't', position: 'C', group: 'short', ratio: 0.8, weight: 1 },
      { kind: 'posture', transactionId: 't', group: 'middle', ratio: 1.25, weight: 1 },
      // Roster 2 bought a guard holding one guard for one PG slot: short too.
      { kind: 'need', transactionId: 't', position: 'PG', group: 'short', ratio: 1.25, weight: 1 },
    ])
  })

  it('a flex slot is never a position to be short at; depth beyond the slots is "normal"', () => {
    const utilOnly = boardObservationsFor(row({ contextSnapshot: snapshot({ starterSlots: { UTIL: 3 } }) }), 1) as BoardObservation[]
    expect(utilOnly.every((o) => o.kind === 'posture')).toBe(true)
    const deep = snapshot()
    deep.sides[0]!.rosterBefore.push({ id: 'c9', position: 'C' })
    const obs = boardObservationsFor(row({ contextSnapshot: deep }), 1) as BoardObservation[]
    expect(obs.find((o) => o.kind === 'need' && o.position === 'C')).toMatchObject({ group: 'normal' })
  })

  it('never guessed: no board values, an unpriced player, a one-sided dump, no saved context', () => {
    expect(boardObservationsFor(row({ contextSnapshot: snapshot({ boardValues: undefined }) }), 1)).toBe('no_board_values')
    expect(boardObservationsFor(row({ contextSnapshot: snapshot({ boardValues: { byPlayer: { c1: 400, g1: null } } }) }), 1)).toBe('unpriced_player')
    expect(boardObservationsFor(row({ contextSnapshot: snapshot({ boardValues: { byPlayer: { c1: 400, g1: 5 } } }) }), 1)).toBe('one_sided')
    expect(boardObservationsFor(row({ partnerRosterId: null }), 1)).toBe('no_context')
  })
})

describe('the premiums', () => {
  const posture = (group: 'contend' | 'middle', ratio: number, n: number): BoardObservation[] =>
    Array.from({ length: n }, (_, i) => ({ kind: 'posture', transactionId: `${group}${i}`, group, ratio: ratio * (1 + ((i % 5) - 2) / 100), weight: 1 }))
  const need = (group: 'short' | 'normal', ratio: number, n: number): BoardObservation[] =>
    Array.from({ length: n }, (_, i) => ({ kind: 'need', transactionId: `${group}${i}`, position: 'C', group, ratio: ratio * (1 + ((i % 5) - 2) / 100), weight: 1 }))

  it('published only with enough on both sides; held to ±25%', () => {
    const m = computeBoardSportMarket('NBA', [...posture('contend', 1.1, 30), ...posture('middle', 1, 30), ...need('short', 1.6, 30), ...need('normal', 1, 30)], NOW, { tradesRead: 60, skipped: {} })
    expect(m.premiums.find((p) => p.group === 'contend')).toMatchObject({ published: true, premiumPct: 10 })
    expect(m.premiums.find((p) => p.group === 'rebuild')).toMatchObject({ published: false })
    expect(m.premiums.find((p) => p.kind === 'need')).toMatchObject({ group: 'C', published: true, premiumPct: 25 })
    expect(m.premiums.find((p) => p.kind === 'need')!.note).toMatch(/held to ±25%/)
    expect(describeBoardSportMarket(m)).toMatch(/^NBA trade learning \(shadow\): 60 trades with board values.*2 of 3 premiums published/)
  })

  it('too few trades publishes nothing', () => {
    const m = computeBoardSportMarket('NHL', [...posture('contend', 1.1, 5), ...posture('middle', 1, 30)], NOW, { tradesRead: 35, skipped: {} })
    expect(m.premiums.every((p) => !p.published)).toBe(true)
  })
})

describe('the daily read', () => {
  it('one row per trade, grouped by sport, never NFL, stored under one key; off by switch', async () => {
    const findMany = vi.fn(async () => [
      { ...row(), sport: 'nba', tradeDate: NOW },
      { ...row(), sport: 'nba', tradeDate: NOW }, // the same trade's other side row
      { ...row({ transactionId: 'h', contextSnapshot: snapshot({ boardValues: undefined }) }), sport: 'NHL', tradeDate: NOW },
    ])
    const upsert = vi.fn(async () => ({}))
    const r = await runBoardSportLearning({ leagueTrade: { findMany }, sportsDataCache: { upsert } } as never, { now: NOW, env: {} })
    expect(JSON.stringify((findMany.mock.calls[0] as unknown[])[0])).toContain('"in":["nfl","NFL"]')
    expect(r.markets.map((m) => [m.sport, m.tradesRead, m.skipped])).toEqual([['NBA', 1, {}], ['NHL', 0, { no_board_values: 1 }]])
    expect((upsert.mock.calls[0] as unknown as [{ where: { cacheKey: string } }])[0].where.cacheKey).toBe(BOARD_SPORT_MARKET_CACHE_KEY)
    expect(r.written).toBe(true)
    const off = await runBoardSportLearning({ leagueTrade: { findMany }, sportsDataCache: { upsert } } as never, { now: NOW, env: { TRADE_BOARD_LEARNER: 'off' } })
    expect(off).toEqual({ off: true, markets: [], written: false })
  })
})
