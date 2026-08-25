import { describe, expect, it, vi } from 'vitest'

import { detectQbFormat } from '@/lib/core-app/slotEligibility'
import { resolveTradeEnrichment, type TradeEnrichmentPort } from '@/lib/decision-os/trade/enrichmentPort'
import { normalizedPlayerValue } from '@/lib/trade-value/valueEngine'

/**
 * The market seam was built and then never fed.
 *
 * `resolveTradeEnrichment` refuses to price against a default chart when no format is
 * supplied — correctly, since a 1QB redraft roster valued on the superflex dynasty market
 * produces numbers that all look plausible and are all wrong. `canonicalShadow` never supplied
 * one, so `fantasyCalcValue` was null for every Decision OS trade, offence included.
 */

const basePort = (over: Partial<TradeEnrichmentPort> = {}): TradeEnrichmentPort => ({
  loadAdp: async () => [],
  resolveMetadata: async () => ({ byId: new Map() }) as never,
  loadProjections: async () => [],
  loadMarketValue: async () => [],
  loadIdpValue: async () => [],
  ...over,
})

describe('detectQbFormat — read off the slots, never the name', () => {
  it('finds superflex under each spelling the platforms use', () => {
    expect(detectQbFormat(['QB', 'RB', 'SUPER_FLEX'])).toBe('SUPERFLEX')
    expect(detectQbFormat(['QB', 'SUPERFLEX'])).toBe('SUPERFLEX')
    expect(detectQbFormat(['QB', 'SF'])).toBe('SUPERFLEX')
  })

  it('treats a second dedicated QB slot as superflex, because it prices like one', () => {
    expect(detectQbFormat(['QB', 'QB', 'RB', 'WR'])).toBe('SUPERFLEX')
  })

  it('is 1QB for a standard roster, and for anything unreadable', () => {
    expect(detectQbFormat(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'])).toBe('ONE_QB')
    expect(detectQbFormat(null)).toBe('ONE_QB')
    expect(detectQbFormat('not an array')).toBe('ONE_QB')
  })
})

describe('trade enrichment — market value needs a format', () => {
  it('says the format is unknown rather than picking a chart', async () => {
    const loadMarketValue = vi.fn(async () => [])
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['wr1'] },
      basePort({ loadMarketValue }),
    )
    expect(loadMarketValue).not.toHaveBeenCalled()
    expect(res.warnings).toContain('market_value_format_unknown')
    expect(res.enrichment.marketValueByPlayerId).toEqual({})
  })

  it('resolves a price once the league states its own market', async () => {
    const res = await resolveTradeEnrichment(
      {
        sport: 'NFL',
        playerIds: ['wr1'],
        valueFormat: { format: 'REDRAFT', qbFormat: 'ONE_QB' },
      },
      basePort({
        loadMarketValue: async () => [
          {
            sleeperId: 'wr1',
            source: 'FANTASYCALC',
            format: 'REDRAFT',
            qbFormat: 'ONE_QB',
            value: 717,
            overallRank: 80,
            positionRank: 40,
            capturedAt: new Date(),
          },
        ],
      }),
    )
    expect(res.enrichment.marketValueByPlayerId?.wr1).toBe(717)
    expect(res.warnings).not.toContain('market_value_unavailable')
    expect(res.valuationSource).toContain('player_value_snapshot')
  })
})

describe('valueEngine — the fix can only lift an asset off zero', () => {
  it('prices a player the projection feed does not carry', () => {
    /*
     * Measured on production: 2,123 of 21,842 rostered assets carry no usable projection and
     * therefore price at zero. Tyreek Hill was one of them, with a market value of 717 sitting
     * unread in the table.
     */
    const before = normalizedPlayerValue({ projection: null, position: 'WR', marketValue: null })
    const after = normalizedPlayerValue({ projection: null, position: 'WR', marketValue: 717 })
    expect(before).toBe(0)
    expect(after).toBe(717)
  })

  it('never moves an asset the engine could already price', () => {
    /*
     * The additive guarantee. Market value is consulted ONLY when there is no usable
     * projection, so supplying it cannot change a graded player — which is what makes wiring
     * the format safe to ship without re-grading the league.
     */
    for (const projection of [1, 45, 180, 330]) {
      const withoutMarket = normalizedPlayerValue({ projection, adp: 30, position: 'RB' })
      const withMarket = normalizedPlayerValue({ projection, adp: 30, position: 'RB', marketValue: 9999 })
      expect(withMarket).toBe(withoutMarket)
    }
  })

  it('stays at zero when there is no market row either, rather than inventing one', () => {
    // 1,322 of the unprojected assets have no FantasyCalc row. Zero is the honest answer.
    expect(normalizedPlayerValue({ projection: null, position: 'WR', marketValue: null })).toBe(0)
    expect(normalizedPlayerValue({ projection: 0, position: 'WR', marketValue: 0 })).toBe(0)
  })
})
