import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import type { FantasyCalcPlayer } from '@/lib/fantasycalc'
import { priceLeagueTradePick, resolveAssets } from '@/lib/trade-value-console/leagueTradePricing'
import { readPickPreviewValue } from '@/lib/trade-value-console/pickPreview'

const chart = [
  { player: { name: '2027 Round 1', position: 'PICK' }, value: 4000 },
  { player: { name: '2027 Round 2', position: 'PICK' }, value: 1585 },
  { player: { name: '2028 Round 2', position: 'PICK' }, value: 1200 },
] as FantasyCalcPlayer[]
const pricing = { fcPlayers: chart, nflCtx: { asOfDate: '2026-09-27',
  isSuperFlex: true, numTeams: 12, fantasyCalcPlayers: chart } }

it('quotes the observed 2027 second at 1,585 and uses that exact price in the evaluator', async () => {
  const preview = await priceLeagueTradePick({ year: 2027, round: 2 }, pricing)
  const evaluated = await resolveAssets([{ kind: 'pick', year: 2027, round: 2 }], {
    ...pricing, effectiveSport: 'NFL', waiverBudget: 100, dataGaps: [],
  })
  expect(preview.priced.assetValue.marketValue).toBe(1585)
  expect(preview.dataSource).toBe('fantasycalc_pick')
  expect(evaluated.lines[0].marketValue).toBe(1585)
  expect(evaluated.priced[0]).toEqual(preview.priced)
})
it('prices the season being traded, rather than giving every future second the same value', async () => {
  expect((await priceLeagueTradePick({ year: 2028, round: 2 }, pricing)).priced.value).toBe(1200)
})
it('retains evaluator fallback parity when a successfully loaded chart has no row for that season', async () => {
  const preview = await priceLeagueTradePick({ year: 2029, round: 3 }, pricing)
  const evaluated = await resolveAssets([{ kind: 'pick', year: 2029, round: 3 }], {
    ...pricing, effectiveSport: 'NFL', waiverBudget: 100, dataGaps: [],
  })
  expect(preview.dataSource).toBe('historical_pick_curve')
  expect(evaluated.priced[0]).toEqual(preview.priced)
})

describe('league quote isolation', () => {
  const book = { leagueId: 'L1', values: { '2027:2': 1585, '2028:2': 1200 } }
  it('reads the quote by season and round', () => {
    expect(readPickPreviewValue({ leagueId: 'L1', book, year: 2027, round: 2 })).toBe(1585)
    expect(readPickPreviewValue({ leagueId: 'L1', book, year: 2028, round: 2 })).toBe(1200)
  })
  it('does not reuse another league quote during a league switch', () => {
    expect(readPickPreviewValue({ leagueId: 'L2', book, year: 2027, round: 2 })).toBeNull()
  })
  it('does not invent a price while quotes are unavailable', () => {
    expect(readPickPreviewValue({ leagueId: 'L1', book: null, year: 2027, round: 2 })).toBeNull()
    expect(readPickPreviewValue({ leagueId: 'L1', book, year: 2035, round: 2 })).toBeNull()
  })
  it.each([NaN, Infinity, -1, 1.5])('rejects invalid round %s', round => {
    expect(readPickPreviewValue({ leagueId: 'L1', book, year: 2027, round })).toBeNull()
  })
})
