import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  devyIdOf,
  loadDevyCandidates,
  mergeDevyPlaceholders,
  priceOpenMarketDevySide,
  searchOpenMarketDevy,
  splitDevyInputs,
} from '@/lib/devy/openMarketDevy'
import { heldDevyOptionValue, type HeldDevyPlayer } from '@/lib/decision-os/trade/leagueAssetRules'
import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { TradeAssetInput, TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

const PROSPECT: HeldDevyPlayer = {
  devyPlayerId: 'dp1',
  name: 'Future Star',
  position: 'WR',
  ppaSeasonTotal: 60,
  recruitingComposite: 0.99,
  recruitingStars: 5,
  draftEligibleYear: 2027,
}
const SEASON = 2026

const unpricedLine = (name: string): TradeConsolePlayerLine =>
  ({ name, playerId: null, sport: 'NFL', position: '—', team: '—', headshotUrl: null, logoUrl: null, injuryStatus: null, dataSource: 'deterministic', composite: 0, marketValue: 0, pricedSource: 'unknown', unpriced: true, unpricedReason: { code: 'no_value_on_file', label: 'x' } }) as TradeConsolePlayerLine
const unpriced = (name: string): PricedAsset =>
  ({ name, type: 'player', value: 0, source: 'unknown', unpriced: true, assetValue: { marketValue: 0, impactValue: 0, vorpValue: 0, volatility: 0 } }) as unknown as PricedAsset
const proLine = (name: string, v: number): TradeConsolePlayerLine =>
  ({ ...unpricedLine(name), unpriced: undefined, unpricedReason: undefined, marketValue: v, pricedSource: 'fantasycalc' }) as TradeConsolePlayerLine
const pro = (name: string, v: number): PricedAsset =>
  ({ name, type: 'player', value: v, source: 'fantasycalc', assetValue: { marketValue: v, impactValue: 0, vorpValue: 0, volatility: 0 } }) as unknown as PricedAsset

const expected = heldDevyOptionValue(PROSPECT, SEASON).value

describe('the fixture is measurable (otherwise every pricing test below would pass vacuously)', () => {
  it('has an option value', () => {
    expect(expected).not.toBeNull()
    expect(expected!).toBeGreaterThan(0)
  })
})

describe('tagging and setting aside searched prospects', () => {
  const inputs: TradeAssetInput[] = [
    { kind: 'player', name: 'A Pro', playerId: '4034', sportHint: 'NFL' },
    { kind: 'player', name: 'Future Star', playerId: 'devy:dp1', sportHint: 'NFL' },
    { kind: 'pick', year: 2027, round: 1 },
  ]
  it('reads the devy id only from a tagged player', () => {
    expect(inputs.map(devyIdOf)).toEqual([null, 'dp1', null])
    expect(devyIdOf({ kind: 'player', name: 'x', playerId: 'devy:' })).toBeNull()
  })
  it('sets the prospect aside and puts a placeholder back in its exact place', () => {
    const split = splitDevyInputs(inputs)
    expect(split.rest.map((a) => (a.kind === 'player' ? a.name : 'pick'))).toEqual(['A Pro', 'pick'])
    const merged = mergeDevyPlaceholders(inputs, split, { lines: [proLine('A Pro', 5000), unpricedLine('2027 1st')], priced: [pro('A Pro', 5000), unpriced('2027 1st')] }, (input) => ({
      line: unpricedLine(input.kind === 'player' ? String(input.name) : '?'),
      priced: unpriced('placeholder'),
    }))
    expect(merged.lines.map((l) => l.name)).toEqual(['A Pro', 'Future Star', '2027 1st'])
    expect(merged.inputs).toEqual(inputs)
  })
  it('appends the placeholders when the pricer dropped a line, rather than misaligning', () => {
    const split = splitDevyInputs(inputs)
    const merged = mergeDevyPlaceholders(inputs, split, { lines: [proLine('A Pro', 5000)], priced: [pro('A Pro', 5000)] }, () => ({ line: unpricedLine('Future Star'), priced: unpriced('Future Star') }))
    expect(merged.lines.map((l) => l.name)).toEqual(['A Pro', 'Future Star'])
    expect(merged.inputs.map((a) => (a.kind === 'player' ? a.name : 'pick'))).toEqual(['A Pro', 'pick', 'Future Star'])
  })
})

describe('pricing a prospect on this chart', () => {
  const side = () => ({
    inputs: [{ kind: 'player', name: 'Future Star', playerId: 'devy:dp1' } as TradeAssetInput],
    lines: [unpricedLine('Future Star')],
    priced: [unpriced('Future Star')],
  })

  it('prices him on the devy board scale when the chart IS that board (factor 1)', () => {
    const r = priceOpenMarketDevySide(side(), [PROSPECT], SEASON, 1)
    expect(r.devyPriced).toBe(1)
    expect(r.priced[0]!.assetValue.marketValue).toBe(Math.round(expected!))
    expect(r.lines[0]!.unpriced).toBeUndefined()
    expect(r.lines[0]!.dataSource).toBe('devy-option')
  })

  it('rescales to another dynasty chart by the measured factor, on the line AND the graded asset', () => {
    const r = priceOpenMarketDevySide(side(), [PROSPECT], SEASON, 0.5)
    expect(r.priced[0]!.assetValue.marketValue).toBe(Math.round(Math.round(expected!) * 0.5))
    expect(r.lines[0]!.marketValue).toBe(r.priced[0]!.assetValue.marketValue)
  })

  it('prices nothing on a redraft chart, and names the prospect so the grade can say why', () => {
    const r = priceOpenMarketDevySide(side(), [PROSPECT], SEASON, null)
    expect(r.devyPriced).toBe(0)
    expect(r.lines[0]!.unpriced).toBe(true)
    expect(r.redraftRefused).toEqual(['Future Star'])
  })

  it('matches a TYPED name with no id, but not when two prospects share it', () => {
    const typed = { inputs: [{ kind: 'player', name: 'Future Star' } as TradeAssetInput], lines: [unpricedLine('Future Star')], priced: [unpriced('Future Star')] }
    expect(priceOpenMarketDevySide(typed, [PROSPECT], SEASON, 1).devyPriced).toBe(1)
    const twin = { ...PROSPECT, devyPlayerId: 'dp2' }
    expect(priceOpenMarketDevySide(typed, [PROSPECT, twin], SEASON, 1).devyPriced).toBe(0)
  })

  it('leaves a priced pro and an unmatched name exactly as they were', () => {
    const mixed = { inputs: [{ kind: 'player', name: 'A Pro' } as TradeAssetInput, { kind: 'player', name: 'Nobody' } as TradeAssetInput], lines: [proLine('A Pro', 5000), unpricedLine('Nobody')], priced: [pro('A Pro', 5000), unpriced('Nobody')] }
    const r = priceOpenMarketDevySide(mixed, [PROSPECT], SEASON, 1)
    expect(r.devyPriced).toBe(0)
    expect(r.lines).toEqual(mixed.lines)
  })
})

describe('reading prospects', () => {
  it('asks for tagged ids and normalised unpriced names, undrafted only', async () => {
    const findMany = vi.fn(async () => [{ id: 'dp1', name: 'Future Star', position: 'WR', school: 'State', ppaSeasonTotal: 60, recruitingComposite: 0.99, recruitingStars: 5, draftEligibleYear: 2027 }])
    const out = await loadDevyCandidates({ devyPlayer: { findMany } }, { ids: ['dp1'], names: ['Future Star Jr.'] })
    const where = (findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({ graduatedToNFL: false, OR: [{ id: { in: ['dp1'] } }, { normalizedName: { in: ['future star'] } }] })
    expect(out[0]).toMatchObject({ devyPlayerId: 'dp1', name: 'Future Star' })
  })
  it('is empty on a read failure, so lines stay unpriced as before', async () => {
    const findMany = vi.fn(async () => { throw new Error('down') })
    await expect(loadDevyCandidates({ devyPlayer: { findMany } }, { ids: ['x'], names: [] })).resolves.toEqual([])
  })
  it('search returns tagged college rows with the same option value the grade starts from', async () => {
    const findMany = vi.fn(async () => [{ id: 'dp1', name: 'Future Star', position: 'WR', school: 'State', ppaSeasonTotal: 60, recruitingComposite: 0.99, recruitingStars: 5, draftEligibleYear: 2027 }])
    const rows = await searchOpenMarketDevy({ devyPlayer: { findMany } }, 'future', { now: new Date('2026-11-11T00:00:00Z') })
    expect(rows).toEqual([{ playerId: 'devy:dp1', name: 'Future Star', position: 'WR', team: 'College · State', value: Math.round(expected!), college: true }])
  })
})
