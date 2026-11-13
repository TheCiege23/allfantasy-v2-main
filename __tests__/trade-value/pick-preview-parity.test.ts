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
it('🛑 a season the chart carries no row for is UNPRICED with a reason — never the formula curve (2026-09-28)', async () => {
  // The curve priced a 2027 1st at 7,360 against FantasyCalc's ~2,900 in guillotine/survivor/zombie
  // leagues, and graded deals on it (trade price coverage audit). Preview and evaluator still agree.
  const preview = await priceLeagueTradePick({ year: 2029, round: 3 }, pricing)
  const evaluated = await resolveAssets([{ kind: 'pick', year: 2029, round: 3 }], {
    ...pricing, effectiveSport: 'NFL', waiverBudget: 100, dataGaps: [],
  })
  expect(preview.dataSource).toBe('no_pick_market')
  expect(preview.priced).toMatchObject({ unpriced: true, value: 0, source: 'unknown',
    unpricedReason: { code: 'no_pick_market', label: "No market value for a 2029 round 3 pick in this league's format" } })
  expect(preview.priced.assetValue.marketValue).toBe(0)
  expect(evaluated.priced[0]).toEqual(preview.priced)
  expect(evaluated.lines[0]).toMatchObject({ unpriced: true, unpricedReason: { code: 'no_pick_market' } })
})
it('🛑 a redraft-style chart (guillotine, survivor, zombie) prices NO pick at all, in any season or round', async () => {
  // The audit case: the chart these formats use has player rows and no pick rows.
  const redraft = [{ player: { name: 'Some Receiver', position: 'WR', sleeperId: '1' }, value: 3000 }] as FantasyCalcPlayer[]
  const onRedraft = { fcPlayers: redraft, nflCtx: { ...pricing.nflCtx, fantasyCalcPlayers: redraft } }
  for (const [year, round] of [[2027, 1], [2027, 6], [2028, 2]] as const) {
    const { priced, dataSource } = await priceLeagueTradePick({ year, round }, onRedraft)
    expect({ year, round, dataSource, unpriced: priced.unpriced, value: priced.value }).toEqual({ year, round, dataSource: 'no_pick_market', unpriced: true, value: 0 })
  }
})
it('[control] a pick the chart DOES carry is still priced from it', async () => {
  const { priced, dataSource } = await priceLeagueTradePick({ year: 2027, round: 1 }, pricing)
  expect({ dataSource, value: priced.value, unpriced: priced.unpriced }).toEqual({ dataSource: 'fantasycalc_pick', value: 4000, unpriced: undefined })
})

describe('150-team rookie pick pricing', () => {
  const large = { ...pricing, nflCtx: { ...pricing.nflCtx, numTeams: 150, largeLeagueRookiePicks: true } }

  it('prices rookie picks by overall position across the round boundary', async () => {
    const picks = [{ year: 2027, round: 1, overall: 1 }, { year: 2027, round: 1, overall: 150 },
      { year: 2027, round: 2, overall: 151 }]
    const quotes = await Promise.all(picks.map(pick => priceLeagueTradePick(pick, large)))
    expect(quotes.map(quote => quote.dataSource)).toEqual(Array(3).fill('fantasycalc_pick_overall_estimate'))
    const [first, lastInFirst, firstInSecond] = quotes.map(quote => quote.priced.value)
    expect(first).toBeGreaterThan(4000)
    expect(first).toBeGreaterThan(lastInFirst)
    expect(lastInFirst).toBeGreaterThan(firstInSecond)
    expect(firstInSecond).toBeGreaterThan(0)
    const evaluated = await resolveAssets(picks.map(pick => ({ kind: 'pick', ...pick })), {
      ...large, effectiveSport: 'NFL', waiverBudget: 100, dataGaps: [],
    })
    expect(evaluated.priced).toEqual(quotes.map(quote => quote.priced))
  })

  it('uses the middle of the round when the draft position is unknown', async () => {
    const unknown = await priceLeagueTradePick({ year: 2027, round: 1 }, large)
    const early = await priceLeagueTradePick({ year: 2027, round: 1, tier: 'early' }, large)
    const late = await priceLeagueTradePick({ year: 2027, round: 1, tier: 'late' }, large)
    expect(early.priced.value).toBeGreaterThan(unknown.priced.value)
    expect(unknown.priced.value).toBeGreaterThan(late.priced.value)
  })

  it.each([{ year: 2028, round: 1, overall: 150 }, { year: 2029, round: 1, overall: 1 },
    { year: 2027, round: 2, overall: 150 }])('withholds a pick without usable evidence (%j)', async (pick) => {
    const result = await priceLeagueTradePick(pick, large)
    expect(result.dataSource).toBe('no_pick_market')
    expect(result.priced.unpriced).toBe(true)
  })
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
