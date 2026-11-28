/**
 * Native NBA / NCAAB / NHL leagues key their rosters by Rolling Insights number, not Sleeper id.
 *
 * Before this, pricing crossed every id through `PlayerIdentityMap.sleeperId`. Those registry rows
 * carry no Sleeper id, so the crossing found nothing, every player was unpriced, and Chimmy answered
 * every offer with `cannot_value`.
 *
 * 🛑 The id spaces collide: "1232" is Deni Avdija in Rolling Insights and Robert Covington in
 * Sleeper. So the Rolling Insights space must never ask a Sleeper-keyed source, and the Sleeper
 * space must never cross through `rollingInsightsId`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const findIdentity = vi.fn()
const findProjection = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findMany: (...a: unknown[]) => findIdentity(...a) },
    aFProjectionSnapshot: { findMany: (...a: unknown[]) => findProjection(...a) },
  },
}))

import { loadAfProjectionRows } from '@/lib/decision-os/world/port'
import { resolveTradeEnrichment, type TradeEnrichmentPort } from '@/lib/decision-os/trade/enrichmentPort'

const NOW = new Date('2026-11-26T00:00:00.000Z')

const snapshotRow = (playerId: string, rosProjection: number) => ({
  playerId, sport: 'NBA', season: 2026, week: null, afProjection: 40, rosProjection,
  rosWeeksRemaining: 20, confidenceLevel: 'high', computedAt: NOW,
})

describe('loadAfProjectionRows crosses through the caller\'s id space', () => {
  beforeEach(() => {
    findIdentity.mockReset()
    findProjection.mockReset()
  })

  it('rolling_insights: crosses through rollingInsightsId, scoped to the sport, and keys rows back', async () => {
    findIdentity.mockResolvedValue([{ id: 'reg-avdija', sleeperId: null, rollingInsightsId: '1232' }])
    findProjection.mockResolvedValue([snapshotRow('reg-avdija', 900)])

    const rows = await loadAfProjectionRows('NBA', ['1232'], 2026, null, 'rolling_insights')

    expect(findIdentity.mock.calls[0][0].where).toEqual({ sport: 'NBA', rollingInsightsId: { in: ['1232'] } })
    expect(rows.map((r) => [r.playerId, r.rosProjection])).toEqual([['1232', 900]])
  })

  it('sleeper (the default): still crosses through sleeperId only', async () => {
    findIdentity.mockResolvedValue([{ id: 'reg-covington', sleeperId: '1232', rollingInsightsId: '77' }])
    findProjection.mockResolvedValue([snapshotRow('reg-covington', 300)])

    const rows = await loadAfProjectionRows('NBA', ['1232'], 2026, null)

    expect(findIdentity.mock.calls[0][0].where).toEqual({ sleeperId: { in: ['1232'] } })
    // Keyed back by the Sleeper id that was asked, never the row's Rolling Insights number.
    expect(rows.map((r) => r.playerId)).toEqual(['1232'])
  })

  it('rolling_insights: a registry row matched only by Sleeper id is not keyed back', async () => {
    // A row the RI query would not return, but if it did, it must not be read as the asked id.
    findIdentity.mockResolvedValue([{ id: 'reg-covington', sleeperId: '1232', rollingInsightsId: null }])
    findProjection.mockResolvedValue([snapshotRow('reg-covington', 300)])

    const rows = await loadAfProjectionRows('NBA', ['1232'], 2026, null, 'rolling_insights')

    // It is never re-keyed to the asked number, so it cannot price Deni Avdija as Robert Covington.
    expect(rows.some((r) => r.playerId === '1232')).toBe(false)
  })
})

/** A port where every Sleeper-keyed source would answer for a DIFFERENT player with the same id. */
function collidingPort(calls: string[], over: Partial<TradeEnrichmentPort> = {}): TradeEnrichmentPort {
  return {
    loadAdp: async () => { calls.push('adp'); return [{ playerId: '1232', adp: 150, position: 'SF' }] as never },
    resolveMetadata: async () => { calls.push('metadata'); return { byId: new Map([['1232', { position: 'PF' }]]), complete: true, unresolvedIds: [], warnings: [] } as never },
    loadProjections: async () => { calls.push('provider'); return [] },
    loadAfProjections: async (_s, _ids, _season, _week, idSpace) => {
      calls.push(`af:${idSpace ?? 'sleeper'}`)
      return [{ ...snapshotRow('1232', 900) }] as never
    },
    loadMarketValue: async () => { calls.push('market'); return [] },
    loadIdpValue: async () => { calls.push('idp'); return [] },
    loadNativePositions: async () => { calls.push('native-positions'); return new Map([['1232', 'SF']]) },
    ...over,
  }
}

describe('resolveTradeEnrichment in the rolling_insights space', () => {
  const args = {
    sport: 'NBA', playerIds: ['1232'], season: 2026, week: 5,
    idSpace: 'rolling_insights' as const,
    valueFormat: { format: 'REDRAFT', qbFormat: 'ONE_QB', tepEnabled: false, teamCount: 12 } as never,
    idpLeague: { scoringPreset: 'x' } as never,
  }

  it('prices from AF projections and asks no Sleeper-keyed source', async () => {
    const calls: string[] = []
    const res = await resolveTradeEnrichment(args, collidingPort(calls))

    expect(res.enrichment.projectionByPlayerId?.['1232']).toBe(900)
    expect(res.enrichment.positionByPlayerId?.['1232']).toBe('SF')
    // Nothing Sleeper-keyed was consulted, so nothing could answer for Robert Covington.
    expect(calls.sort()).toEqual(['af:rolling_insights', 'native-positions'])
    expect(res.enrichment.adpByPlayerId?.['1232']).toBeUndefined()
  })

  it('the Sleeper space is unchanged: every source is still asked', async () => {
    const calls: string[] = []
    const res = await resolveTradeEnrichment({ ...args, idSpace: undefined }, collidingPort(calls))

    expect(calls).toContain('adp')
    expect(calls).toContain('metadata')
    expect(calls).toContain('provider')
    expect(calls).toContain('af:sleeper')
    expect(calls).not.toContain('native-positions')
    expect(res.enrichment.positionByPlayerId?.['1232']).toBe('PF')
  })
})
