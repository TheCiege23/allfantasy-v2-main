import { describe, expect, it } from 'vitest'

import {
  normalizedPickValue,
  normalizedPlayerValue,
  valueBasisFor,
} from '@/lib/trade-value/valueEngine'
import { buildTradeValueSnapshot, type EnrichedTradeAsset } from '@/lib/trade-value/snapshot'
import type { TradeValueContext } from '@/lib/trade-value/types'

/*
 * 🛑 THE DYNASTY BUG THIS PINS: a 22-year-old and a 31-year-old with EQUAL rest-of-season
 * projections priced as the same asset, because the projection outranked the dynasty market price
 * the enrichment had already loaded. The market price is the one input that sees age.
 */

const CONTEXT: TradeValueContext = {
  sport: 'NFL',
  leagueType: 'dynasty',
  scoring: 'ppr',
  rosterFormat: 'unknown',
  capturedAt: '2026-09-22T00:00:00.000Z',
}

function player(id: string, from: string, to: string, projection: number, market: number): EnrichedTradeAsset {
  return {
    kind: 'player',
    fromRosterId: from,
    toRosterId: to,
    playerId: id,
    playerName: id,
    position: 'WR',
    sources: { projectionValue: projection, rankingValue: null, adpValue: null, fantasyCalcValue: market, idpValue: null },
  }
}

function pick(from: string, to: string, season: number, round: number, market: number | null): EnrichedTradeAsset {
  return {
    kind: 'draft_pick',
    fromRosterId: from,
    toRosterId: to,
    pickSeason: season,
    pickRound: round,
    pickLabel: `${season} round ${round}`,
    sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: market, idpValue: null },
  }
}

describe('valueBasisFor / normalizedPlayerValue', () => {
  it('redraft order is unchanged: the projection decides when there is one', () => {
    expect(valueBasisFor({ projection: 150, marketValue: 8000 })).toBe('projection')
    expect(normalizedPlayerValue({ projection: 150, marketValue: 8000, position: 'WR' })).toBe(
      normalizedPlayerValue({ projection: 150, position: 'WR' }),
    )
  })

  it('dynasty: the market price decides ahead of the projection', () => {
    expect(valueBasisFor({ projection: 150, marketValue: 8000, preferMarket: true })).toBe('market')
    expect(normalizedPlayerValue({ projection: 150, marketValue: 8000, position: 'WR', preferMarket: true })).toBe(8000)
  })

  it('dynasty: the projection is still the fallback for a player the market does not price', () => {
    expect(valueBasisFor({ projection: 150, marketValue: null, preferMarket: true })).toBe('projection')
  })

  it('IDP still outranks everything', () => {
    expect(valueBasisFor({ projection: 150, marketValue: 8000, idpValue: 3000, preferMarket: true })).toBe('idp')
  })
})

describe('normalizedPickValue', () => {
  it('uses the market price as-is when given one — no second future discount', () => {
    expect(normalizedPickValue({ round: 1, pickSeason: 2028, currentSeason: 2026, marketValue: 4200 })).toBe(4200)
  })

  it('falls back to the curve without one, byte-identical to before', () => {
    const curve = normalizedPickValue({ round: 1, pickSeason: 2027, currentSeason: 2026 })
    expect(normalizedPickValue({ round: 1, pickSeason: 2027, currentSeason: 2026, marketValue: null })).toBe(curve)
  })
})

describe('buildTradeValueSnapshot with the dynasty market chart', () => {
  /* Same projection, very different dynasty prices: the young player and the old one. */
  const young = player('young', 'A', 'B', 150, 7800)
  const old = player('old', 'B', 'A', 150, 2100)

  it('prices dynasty players off the market, so equal projections no longer mean equal value', () => {
    const snap = buildTradeValueSnapshot({
      proposerRosterId: 'A',
      receiverRosterId: 'B',
      assets: [young, old],
      context: CONTEXT,
      currentSeason: 2026,
      dynastyMarketChart: true,
    })
    expect(snap.sides[0].total).toBe(7800)
    expect(snap.sides[1].total).toBe(2100)
    expect(snap.sides[0].assets[0].valuationBasis).toBe('market')
  })

  it('without the flag, the same trade is priced exactly as before (redraft order)', () => {
    const snap = buildTradeValueSnapshot({
      proposerRosterId: 'A',
      receiverRosterId: 'B',
      assets: [young, old],
      context: CONTEXT,
      currentSeason: 2026,
    })
    expect(snap.sides[0].total).toBe(snap.sides[1].total)
    expect(snap.sides[0].assets[0].valuationBasis).toBe('projection')
  })

  /*
   * 🛑 THE FLAG IS ABOUT THE CHART, NOT THE LEAGUE. `captureSnapshot` sets `context.isDynasty` from
   * the league row while loading the REDRAFT chart; inferring market-first from the context would
   * have priced a dynasty league off redraft market values.
   */
  it('does not infer market-first from context.isDynasty', () => {
    const snap = buildTradeValueSnapshot({
      proposerRosterId: 'A',
      receiverRosterId: 'B',
      assets: [young, old],
      context: { ...CONTEXT, isDynasty: true },
      currentSeason: 2026,
    })
    expect(snap.sides[0].total).toBe(snap.sides[1].total)
  })

  it('prices a dynasty pick off its market row, labelled as market', () => {
    const snap = buildTradeValueSnapshot({
      proposerRosterId: 'A',
      receiverRosterId: 'B',
      assets: [young, pick('B', 'A', 2027, 1, 3900)],
      context: CONTEXT,
      currentSeason: 2026,
      dynastyMarketChart: true,
    })
    const p = snap.sides[1].assets[0]
    expect(p.internalValue).toBe(3900)
    expect(p.valuationBasis).toBe('market')
  })

  it('never reads a pick market price outside the dynasty chart', () => {
    const snap = buildTradeValueSnapshot({
      proposerRosterId: 'A',
      receiverRosterId: 'B',
      assets: [young, pick('B', 'A', 2027, 1, 3900)],
      context: { ...CONTEXT, leagueType: 'redraft' },
      currentSeason: 2026,
    })
    const p = snap.sides[1].assets[0]
    expect(p.internalValue).toBe(normalizedPickValue({ round: 1, pickSeason: 2027, currentSeason: 2026 }))
    expect(p.valuationBasis).toBeNull()
  })
})
