import { describe, expect, it, vi } from 'vitest'

import { resolveTradeEnrichment, type TradeEnrichmentPort } from '@/lib/decision-os/trade/enrichmentPort'
import { normalizedPlayerValue } from '@/lib/trade-value/valueEngine'

/**
 * Phase 3 — an individual defender reaching the trade engine with a price.
 *
 * The failure being closed: a defender arrives with a projection of roughly 0.3 (the generic
 * PPR line, which contains no defensive scoring at all) and a market value of null, because
 * FantasyCalc prices no defenders. The engine reads 0.3 as a real projection, so the market
 * fallback never fires and he grades as worthless in a trade that is entirely about him.
 */

const basePort = (over: Partial<TradeEnrichmentPort> = {}): TradeEnrichmentPort => ({
  loadAdp: async () => [],
  resolveMetadata: async () => ({ byId: new Map() }) as never,
  loadProjections: async () => [],
  loadMarketValue: async () => [],
  loadIdpValue: async () => [],
  ...over,
})

const IDP_LEAGUE = { leagueId: 'lg1', starterSlots: ['LB', 'LB', 'DL', 'DB'], numTeams: 12, isDynasty: true }

describe('trade enrichment — the IDP value seam', () => {
  it('does no IDP work at all when the league context is absent', async () => {
    const loadIdpValue = vi.fn(async () => [])
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['lb1'] },
      basePort({ loadIdpValue }),
    )
    expect(loadIdpValue).not.toHaveBeenCalled()
    expect(res.idpValueResolved).toBe(0)
    expect(res.enrichment.idpValueByPlayerId).toEqual({})
  })

  it('resolves a league-specific value and names its source', async () => {
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['lb1', 'wr1'], idpLeague: IDP_LEAGUE },
      basePort({
        loadIdpValue: async () => [{ sleeperId: 'lb1', value: 4180, positionRank: 3, vorp: 6.2 }],
      }),
    )
    expect(res.idpValueResolved).toBe(1)
    expect(res.enrichment.idpValueByPlayerId?.lb1).toBe(4180)
    // The offensive player is untouched — this seam is not a general value source.
    expect(res.enrichment.idpValueByPlayerId?.wr1).toBeUndefined()
    expect(res.valuationSource).toContain('idp_league_valuation')
  })

  it('degrades to honest-absent when the computation fails', async () => {
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['lb1'], idpLeague: IDP_LEAGUE },
      basePort({
        loadIdpValue: async () => {
          throw new Error('prisma unavailable')
        },
      }),
    )
    expect(res.idpValueResolved).toBe(0)
    expect(res.warnings).toContain('idp_value_source_unavailable')
    // Never fabricated, never thrown.
    expect(res.enrichment.idpValueByPlayerId).toEqual({})
  })
})

describe('valueEngine — the defender stops grading as worthless', () => {
  it('prices a linebacker off his league value, not off the generic PPR line', () => {
    /*
     * The exact production shape: a projection that is the absence of an estimate, and no
     * market quote to fall back to.
     */
    const withoutIdp = normalizedPlayerValue({ projection: 0.3, position: 'LB', marketValue: null })
    const withIdp = normalizedPlayerValue({
      projection: 0.3,
      position: 'LB',
      marketValue: null,
      idpValue: 4180,
    })
    expect(withoutIdp).toBeLessThan(20)
    expect(withIdp).toBe(4180)
  })

  it('outranks the projection, unlike market value which is only a fallback', () => {
    /*
     * The asymmetry is deliberate. For an offensive player a projection is the better signal,
     * so `marketValue` yields to it. For a defender the projection IS the broken input, so the
     * IDP value has to win — otherwise the fix never fires on the players it exists for.
     */
    const marketLoses = normalizedPlayerValue({ projection: 200, position: 'WR', marketValue: 9999 })
    expect(marketLoses).not.toBe(9999)

    const idpWins = normalizedPlayerValue({ projection: 200, position: 'LB', idpValue: 3000 })
    expect(idpWins).toBe(3000)
  })

  it('does not multiply an already-scarcity-adjusted value by scarcity again', () => {
    /*
     * The IDP value is the output of a replacement-level model against this league's own
     * starting slots. `POSITION_SCARCITY` has no IDP entry anyway — LB, DL and DB all take its
     * 1.0 default — so applying it would be both wrong and a no-op pretending to be a factor.
     */
    for (const position of ['LB', 'DL', 'DB', 'CB', 'S']) {
      expect(normalizedPlayerValue({ projection: 0.4, position, idpValue: 2500 })).toBe(2500)
    }
  })

  it('leaves every non-IDP asset byte-identical', () => {
    const before = normalizedPlayerValue({ projection: 180, adp: 24, position: 'RB' })
    const after = normalizedPlayerValue({ projection: 180, adp: 24, position: 'RB', idpValue: null })
    expect(after).toBe(before)
  })

  it('ignores a zero or negative IDP value rather than pricing a player at nothing', () => {
    // Zero would be a claim that the league values him at nothing; absent is the honest read.
    const zero = normalizedPlayerValue({ projection: 0.3, position: 'LB', idpValue: 0 })
    const negative = normalizedPlayerValue({ projection: 0.3, position: 'LB', idpValue: -5 })
    const none = normalizedPlayerValue({ projection: 0.3, position: 'LB' })
    expect(zero).toBe(none)
    expect(negative).toBe(none)
  })
})
