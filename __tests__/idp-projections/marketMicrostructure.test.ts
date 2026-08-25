import { describe, expect, it, vi } from 'vitest'

import { resolveTradeEnrichment, type TradeEnrichmentPort } from '@/lib/decision-os/trade/enrichmentPort'

/**
 * Market microstructure — ingested daily since the value cron landed, read by nothing.
 *
 * The ledger's point is that a price the market rarely tests is a different kind of number
 * from the same price arrived at by constant trading. These pin that the signal is REPORTED
 * and never applied: a thin market means the value is less tested, not lower, and discounting
 * for it would manufacture a penalty out of an absence of evidence.
 */

function valueRow(sleeperId: string, over: Record<string, unknown> = {}) {
  return {
    sleeperId,
    source: 'FANTASYCALC',
    format: 'DYNASTY',
    qbFormat: 'ONE_QB',
    value: 5000,
    overallRank: 10,
    positionRank: 4,
    tradeFrequency: 0.0053,
    trend30d: 0,
    capturedAt: new Date(),
    ...over,
  }
}

const port = (rows: unknown[]): TradeEnrichmentPort => ({
  loadAdp: async () => [],
  resolveMetadata: async () => ({ byId: new Map() }) as never,
  loadProjections: async () => [],
  loadMarketValue: async () => rows as never,
  loadIdpValue: async () => [],
})

const DYNASTY = { format: 'DYNASTY', qbFormat: 'ONE_QB' } as const
const REDRAFT = { format: 'REDRAFT', qbFormat: 'ONE_QB' } as const

describe('market microstructure — liquidity is reported, not applied', () => {
  it('carries liquidity and trend without touching the value', async () => {
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], valueFormat: DYNASTY },
      port([valueRow('p1', { value: 5000, tradeFrequency: 0.0053, trend30d: 300 })]),
    )
    expect(res.enrichment.marketValueByPlayerId?.p1).toBe(5000)
    expect(res.enrichment.liquidityByPlayerId?.p1).toBe(0.0053)
    expect(res.enrichment.trend30dByPlayerId?.p1).toBe(300)
    // A normal-liquidity asset is not flagged.
    expect(res.thinlyPricedIds).toEqual([])
  })

  it('flags a thinly traded price and says so in the warnings', async () => {
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['thin'], valueFormat: DYNASTY },
      port([valueRow('thin', { tradeFrequency: 0.0001 })]),
    )
    expect(res.thinlyPricedIds).toEqual(['thin'])
    expect(res.warnings).toContain('market_price_thin')
    // The value itself is untouched — thin means less tested, not less valuable.
    expect(res.enrichment.marketValueByPlayerId?.thin).toBe(5000)
  })

  it('applies the threshold per FORMAT, because the boards are not on one scale', async () => {
    /*
     * Measured on 2026-08-25: the tenth percentile of trade frequency is 0.0003 in dynasty and
     * 0.0027 in redraft — redraft assets change hands roughly nine times as often. The same
     * raw frequency is therefore unremarkable in dynasty and bottom-decile in redraft, and one
     * absolute threshold would have called nearly every dynasty asset thin.
     */
    const frequency = 0.0009

    const dyn = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], valueFormat: DYNASTY },
      port([valueRow('p1', { tradeFrequency: frequency })]),
    )
    const red = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], valueFormat: REDRAFT },
      port([valueRow('p1', { format: 'REDRAFT', tradeFrequency: frequency })]),
    )

    expect(dyn.thinlyPricedIds).toEqual([])
    expect(red.thinlyPricedIds).toEqual(['p1'])
  })

  it('stays silent when the vendor sends no liquidity for a player', async () => {
    // 43% of the board carries no value for the sibling column; absence is not thinness.
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], valueFormat: DYNASTY },
      port([valueRow('p1', { tradeFrequency: null, trend30d: null })]),
    )
    expect(res.thinlyPricedIds).toEqual([])
    expect(res.warnings).not.toContain('market_price_thin')
    expect(res.enrichment.liquidityByPlayerId?.p1).toBeUndefined()
  })

  it('does no microstructure work when the league format is unknown', async () => {
    /*
     * Without a format there is no board to compare against, and the enrichment already
     * refuses to price against a default chart for the same reason.
     */
    const res = await resolveTradeEnrichment({ sport: 'NFL', playerIds: ['p1'] }, port([valueRow('p1')]))
    expect(res.thinlyPricedIds).toEqual([])
    expect(res.enrichment.liquidityByPlayerId).toEqual({})
  })
})
