import { beforeEach, expect, it, vi } from 'vitest'
import { loadAfNflMarketQuote } from '@/lib/trade-value-console/afLeaguePlayerPrice'

const { identities, market } = vi.hoisted(() => ({ identities: vi.fn(), market: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerIdentityMap: { findMany: identities } } }))
vi.mock('@/lib/trade-market/afTradeMarketReads', () => ({ loadAfTradeMarketRows: market }))

const book = { format: 'REDRAFT', qbFormat: 'ONE_QB' } as const
const request = { book, name: 'Example Player', position: 'WR', allowNameLookup: true }
const quote = { position: 'WR', marketValue: 256, generatedAt: new Date('2026-11-01') }
beforeEach(() => {
  vi.resetAllMocks()
  market.mockResolvedValue(new Map([['11', quote]]))
})

it('prices a name and position only when they resolve to one stored identity', async () => {
  identities.mockResolvedValue([{ sleeperId: '11', position: 'WR' }, { sleeperId: '22', position: 'LB' }])
  expect(await loadAfNflMarketQuote(request)).toEqual(quote)
  expect(market).toHaveBeenCalledWith(expect.anything(), ['11'], book, expect.any(Date), true)
})

it('withholds a quote for two matching names in the same position', async () => {
  identities.mockResolvedValue([{ sleeperId: '11', position: 'WR' }, { sleeperId: '22', position: 'WR' }])
  expect(await loadAfNflMarketQuote(request)).toBeNull()
  expect(market).not.toHaveBeenCalled()
})

it('checks the quote position and keeps unresolved provider IDs from falling back to a name', async () => {
  expect(await loadAfNflMarketQuote({ ...request, sleeperId: '11', position: 'TE' })).toBeNull()
  expect(await loadAfNflMarketQuote({ ...request, allowNameLookup: false })).toBeNull()
  expect(identities).not.toHaveBeenCalled()
})
