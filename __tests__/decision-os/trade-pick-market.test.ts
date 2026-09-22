import { describe, expect, it, vi } from 'vitest'

import {
  pickMarketArgsFromWorld,
  resolveTradeEnrichment,
  type TradeEnrichmentPort,
} from '@/lib/decision-os/trade/enrichmentPort'
import { toEnrichedAsset, type TradeMovement } from '@/lib/decision-os/trade/canonicalMemo'

/*
 * 🛑 THE PICK PRICES EXISTED AND THE TRADE ENGINE NEVER READ THEM. `marketValueService` has parsed
 * FantasyCalc's dynasty pick rows for the trade console; the canonical trade path priced picks off
 * a curve in a different currency from the dynasty players beside them. These pin the plumbing:
 * loaded only for the dynasty chart, carried to the pick, and a missing price said out loud.
 */

function pickMovement(season: number, round: number, from = 'rA', to = 'rB'): TradeMovement {
  return {
    fromRosterId: from,
    toRosterId: to,
    asset: {
      assetType: 'draft_pick',
      metadata: {
        pick: { season, round, pickNumber: null, originalRosterId: from, label: `${season} Round ${round}` },
        player: null,
        keeper: null,
        devy: null,
        faab: null,
      },
    },
  } as unknown as TradeMovement
}

describe('toEnrichedAsset — a pick takes its dynasty market price', () => {
  it('reads `${season}:${round}` into the market source', () => {
    const { asset, notes } = toEnrichedAsset(pickMovement(2027, 1), { pickMarketValueByKey: { '2027:1': 3900 } })
    expect(asset.kind).toBe('draft_pick')
    expect(asset.sources.fantasyCalcValue).toBe(3900)
    expect(notes.join(' ')).not.toMatch(/No market price/)
  })

  it('says so when the chart has no row for that pick, rather than pricing silently off the curve', () => {
    const { asset, notes } = toEnrichedAsset(pickMovement(2031, 1), { pickMarketValueByKey: { '2027:1': 3900 } })
    expect(asset.sources.fantasyCalcValue).toBeNull()
    expect(notes.join(' ')).toMatch(/No market price for 2031 Round 1 — valued off the pick curve/)
  })

  it('says nothing about a pick market in a league that has none', () => {
    const { notes } = toEnrichedAsset(pickMovement(2027, 1), {})
    expect(notes.join(' ')).not.toMatch(/market price/)
  })
})

describe('pickMarketArgsFromWorld — one derivation for both producers', () => {
  const world = (isDynasty: boolean, scoringPresetId: string | null) => ({
    rosters: new Array(12).fill({}),
    league: { isDynasty, scoringPresetId },
  })

  it('is null outside dynasty — there is no rookie-pick market', () => {
    expect(pickMarketArgsFromWorld(world(false, 'ppr'))).toBeNull()
  })

  it('is null when the reception format is unknown, rather than guessing PPR', () => {
    expect(pickMarketArgsFromWorld(world(true, null))).toBeNull()
  })

  it('carries league size and reception weight for a dynasty league', () => {
    expect(pickMarketArgsFromWorld(world(true, 'ppr'))).toEqual({ numTeams: 12, ppr: 1 })
    expect(pickMarketArgsFromWorld(world(true, 'half_ppr'))).toEqual({ numTeams: 12, ppr: 0.5 })
  })
})

describe('resolveTradeEnrichment — pick prices load only for the dynasty chart', () => {
  const basePort = {
    loadAdp: async () => [],
    resolveMetadata: async () => ({ byId: new Map(), complete: false, unresolvedIds: ['pa'], warnings: [] }),
    loadMarketValue: async () => [],
  }

  it('loads them for a DYNASTY value format and hands them to the memo', async () => {
    const loadPickMarketValues = vi.fn(async () => ({ '2027:1': 3900, '2027:2': 1500 }))
    const res = await resolveTradeEnrichment(
      {
        sport: 'NFL',
        playerIds: ['pa'],
        valueFormat: { format: 'DYNASTY', qbFormat: 'SUPERFLEX' },
        pickMarket: { numTeams: 12, ppr: 1 },
      },
      { ...basePort, loadPickMarketValues } as unknown as TradeEnrichmentPort,
    )
    expect(loadPickMarketValues).toHaveBeenCalledWith({ qbFormat: 'SUPERFLEX', numTeams: 12, ppr: 1 })
    expect(res.enrichment.pickMarketValueByKey).toEqual({ '2027:1': 3900, '2027:2': 1500 })
    expect(res.valuationSource).toMatch(/pick_market_value/)
  })

  it('never loads them for a REDRAFT value format', async () => {
    const loadPickMarketValues = vi.fn(async () => ({ '2027:1': 3900 }))
    const res = await resolveTradeEnrichment(
      {
        sport: 'NFL',
        playerIds: ['pa'],
        valueFormat: { format: 'REDRAFT', qbFormat: 'ONE_QB' },
        pickMarket: { numTeams: 12, ppr: 1 },
      },
      { ...basePort, loadPickMarketValues } as unknown as TradeEnrichmentPort,
    )
    expect(loadPickMarketValues).not.toHaveBeenCalled()
    expect(res.enrichment.pickMarketValueByKey).toBeUndefined()
  })

  it('reports an empty or failed pick chart as a warning, not as prices', async () => {
    const res = await resolveTradeEnrichment(
      {
        sport: 'NFL',
        playerIds: ['pa'],
        valueFormat: { format: 'DYNASTY', qbFormat: 'ONE_QB' },
        pickMarket: { numTeams: 12, ppr: 1 },
      },
      { ...basePort, loadPickMarketValues: async () => { throw new Error('down') } } as unknown as TradeEnrichmentPort,
    )
    expect(res.enrichment.pickMarketValueByKey).toBeUndefined()
    expect(res.warnings).toContain('pick_market_value_unavailable')
  })
})
