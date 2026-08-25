import { describe, expect, it, vi } from 'vitest'

import {
  resolveTradeEnrichment,
  type TradeEnrichmentPort,
} from '@/lib/decision-os/trade/enrichmentPort'

/**
 * FantasyCalc reaching Decision OS.
 *
 * `EnrichedTradeAsset.sources.fantasyCalcValue` has been on the contract since
 * the beginning and was fed `null` at every write site. Every deferral gave the
 * same reason — "live external API: latency, availability, non-determinism" —
 * and every one was right while the only access was a live fetch.
 * `PlayerValueSnapshot` is a local table with a daily cron and a dated series,
 * so the objection stopped applying and nobody had connected the two.
 */

function port(over: Partial<TradeEnrichmentPort> = {}): TradeEnrichmentPort {
  return {
    loadAdp: async () => [],
    resolveMetadata: async () => ({ byId: new Map() }) as never,
    loadProjections: async () => [],
    loadMarketValue: async () => [],
    ...over,
  }
}

function valueRow(sleeperId: string, value: number, capturedAt: string) {
  return {
    sleeperId,
    source: 'FANTASYCALC',
    format: 'DYNASTY',
    qbFormat: 'SUPERFLEX',
    value,
    overallRank: null,
    positionRank: null,
    capturedAt: new Date(capturedAt),
  }
}

describe('trade enrichment — FantasyCalc market value', () => {
  it('resolves persisted values into the enrichment the memo consumes', async () => {
    const out = await resolveTradeEnrichment(
      {
        sport: 'NFL',
        playerIds: ['p1', 'p2'],
        valueFormat: { format: 'DYNASTY', qbFormat: 'SUPERFLEX' },
      },
      port({
        loadMarketValue: async () => [
          valueRow('p1', 6400, '2026-08-24T00:00:00Z'),
          valueRow('p2', 1200, '2026-08-24T00:00:00Z'),
        ],
      }),
    )

    expect(out.enrichment.marketValueByPlayerId).toEqual({ p1: 6400, p2: 1200 })
    expect(out.valuationSource).toContain('player_value_snapshot')
  })

  it('⚠ REFUSES to price a league whose format it does not know', async () => {
    /*
     * A 1QB redraft roster valued on the superflex dynasty chart produces
     * numbers that all look plausible and are all wrong — silently. No format,
     * no market value, and the reason is stated rather than defaulted away.
     */
    const load = vi.fn(async () => [valueRow('p1', 6400, '2026-08-24T00:00:00Z')])
    const out = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'] },
      port({ loadMarketValue: load }),
    )

    expect(load).not.toHaveBeenCalled()
    expect(out.enrichment.marketValueByPlayerId).toEqual({})
    expect(out.warnings).toContain('market_value_format_unknown')
  })

  it('passes the league format straight through to the loader', async () => {
    const load = vi.fn(async () => [])
    await resolveTradeEnrichment(
      {
        sport: 'NFL',
        playerIds: ['p1'],
        valueFormat: { format: 'REDRAFT', qbFormat: 'ONE_QB' },
      },
      port({ loadMarketValue: load }),
    )
    expect(load).toHaveBeenCalledWith(['p1'], 'REDRAFT', 'ONE_QB')
  })

  it('keeps the freshest row per player, matching the ADP dedup convention', async () => {
    const out = await resolveTradeEnrichment(
      {
        sport: 'NFL',
        playerIds: ['p1'],
        valueFormat: { format: 'DYNASTY', qbFormat: 'SUPERFLEX' },
      },
      port({
        // The loader orders capturedAt desc, so the first row is the newest.
        loadMarketValue: async () => [
          valueRow('p1', 6400, '2026-08-24T00:00:00Z'),
          valueRow('p1', 5900, '2026-08-01T00:00:00Z'),
        ],
      }),
    )
    expect(out.enrichment.marketValueByPlayerId).toEqual({ p1: 6400 })
  })

  it('says market value is unavailable rather than reporting a silent zero', async () => {
    const out = await resolveTradeEnrichment(
      {
        sport: 'NFL',
        playerIds: ['p1'],
        valueFormat: { format: 'DYNASTY', qbFormat: 'SUPERFLEX' },
      },
      port(),
    )
    expect(out.warnings).toContain('market_value_unavailable')
    expect(out.enrichment.marketValueByPlayerId).toEqual({})
  })

  it('⚠ degrades to honest-empty when the store is unreachable, never throwing', async () => {
    // Every source here is independently guarded so one failing does not take
    // the others down — a trade memo that throws is worse than one missing a
    // value it can say it is missing.
    const out = await resolveTradeEnrichment(
      {
        sport: 'NFL',
        playerIds: ['p1'],
        valueFormat: { format: 'DYNASTY', qbFormat: 'SUPERFLEX' },
      },
      port({
        loadMarketValue: async () => {
          throw new Error('prisma unavailable')
        },
      }),
    )
    expect(out.warnings).toContain('market_value_source_unavailable')
    expect(out.enrichment.marketValueByPlayerId).toEqual({})
  })

  it('does not disturb the other enrichment sources', async () => {
    // Strictly additive: adding market value must not change ADP or position.
    const out = await resolveTradeEnrichment(
      {
        sport: 'NFL',
        playerIds: ['p1'],
        valueFormat: { format: 'DYNASTY', qbFormat: 'SUPERFLEX' },
      },
      port({
        loadAdp: async () => [{ playerId: 'p1', adp: 12.5, position: 'RB' }] as never,
        loadMarketValue: async () => [valueRow('p1', 6400, '2026-08-24T00:00:00Z')],
      }),
    )
    expect(out.enrichment.adpByPlayerId).toEqual({ p1: 12.5 })
    expect(out.enrichment.marketValueByPlayerId).toEqual({ p1: 6400 })
  })
})
