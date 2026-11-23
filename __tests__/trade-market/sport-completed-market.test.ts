import { describe, expect, it, vi } from 'vitest'
import { sportMarketAdjustments } from '@/lib/trade-market/sportCompletedMarket'
vi.mock('server-only', () => ({}))

describe('completed league trades on a sport-specific AF chart', () => {
  const chart = new Map([['a', 20], ['b', 20]])
  const deals = Array.from({ length: 5 }, (_, i) => ({ key: String(i), given: ['a'], received: ['b'] }))

  it('counts both sides of five distinct settled transactions once', () => {
    const mirrored = deals.map(d => ({ ...d, given: d.received, received: d.given }))
    const prices = sportMarketAdjustments([...deals, ...mirrored], chart)
    expect(prices.get('a')).toEqual({ percent: 0, trades: 5 })
    expect(prices.get('b')).toEqual({ percent: 0, trades: 5 })
  })

  it('withholds a four-trade sample, unknown counterparties and duplicated assets', () => {
    expect(sportMarketAdjustments([
      ...deals.slice(1), { ...deals[0], given: ['unknown'] }, { ...deals[0], given: ['a', 'a'] },
    ], chart).size).toBe(0)
  })
})
