import { describe, expect, it } from 'vitest'
import { lineFromPriced } from '@/lib/trade-value-console/runTradeConsoleAnalysis'
import type { PricedAsset } from '@/lib/hybrid-valuation'

/**
 * 🛑 THE ANALYSIS PRINTED "0" FOR A PLAYER IT COULD NOT PRICE.
 *
 * `pricePlayer` returns `marketValue: 0` with `unpriced: true` when it finds nothing anywhere, and
 * its own comment says every surface must check the flag first. The console's line type dropped
 * it, so the Trade Center took the 0 as a price: a team defense read "0" after Analyze and was not
 * counted as unpriced.
 */

const unpricedDefense = {
  name: 'Philadelphia Eagles',
  type: 'player',
  value: 0,
  assetValue: { marketValue: 0, impactValue: 0, vorpValue: 0, volatility: 0.5 },
  source: 'unknown',
  unpriced: true,
  // What the pricer reports for a name it could not match.
  position: 'UNKNOWN',
} as unknown as PricedAsset

const priced = {
  name: 'DK Metcalf',
  type: 'player',
  value: 1976,
  assetValue: { marketValue: 1976, impactValue: 1200, vorpValue: 400, volatility: 0.2 },
  source: 'fantasycalc',
  position: 'WR',
} as unknown as PricedAsset

describe('lineFromPriced carries the pricer\'s "found nothing" flag', () => {
  it('flags the line and gives the reason from the player row\'s position', () => {
    const line = lineFromPriced(unpricedDefense, { sport: 'NFL' }, { reasonPosition: 'DEF' })
    expect(line.unpriced).toBe(true)
    expect(line.unpricedReason?.code).toBe('team_defense')
  })

  it('⚠ leaves the engine\'s own number alone — the flag is what a surface reads', () => {
    // The verdict maths is not part of item #5; changing the 0 here would move grades.
    expect(lineFromPriced(unpricedDefense, {}, { reasonPosition: 'DEF' }).marketValue).toBe(0)
  })

  it('without a row position, says the engine found nothing rather than naming a position', () => {
    expect(lineFromPriced(unpricedDefense, {}).unpricedReason?.code).toBe('no_value_on_file')
  })

  it('[control] a priced player carries neither key', () => {
    const line = lineFromPriced(priced, { sport: 'NFL' }, { reasonPosition: 'WR' })
    expect(line.marketValue).toBe(1976)
    expect('unpriced' in line).toBe(false)
    expect('unpricedReason' in line).toBe(false)
  })
})
