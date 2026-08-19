import { describe, expect, it } from 'vitest'
import { generateWaiverRecommendations } from '@/lib/shared-services/league-hub/generators/waiverRecommendations'
import { baseContext, player, staleFreshness } from './fixtures'

const NOW = '2026-07-13T00:00:00.000Z'

describe('generateWaiverRecommendations', () => {
  it('flags a positional need when every rostered player at a position is out', () => {
    const context = baseContext({
      lineup: { starters: [player({ id: 'p1', position: 'RB' })], bench: [], ir: [] },
      injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'Out', gameStatus: null, reportDate: NOW }]]),
    })
    const recs = generateWaiverRecommendations(context, NOW)
    expect(recs).toHaveLength(1)
    expect(recs[0].type).toBe('positional_need')
    expect(recs[0].title).toContain('RB')
  })

  it('does not flag a position with at least one healthy player', () => {
    const context = baseContext({
      lineup: {
        starters: [player({ id: 'p1', position: 'RB', status: 'healthy' }), player({ id: 'p2', position: 'RB', status: 'Out' })],
        bench: [],
        ir: [],
      },
    })
    const recs = generateWaiverRecommendations(context, NOW)
    expect(recs).toHaveLength(0)
  })

  it('never names a specific player to add — no fabricated free-agent availability', () => {
    const context = baseContext({
      lineup: { starters: [player({ id: 'p1', position: 'WR' })], bench: [], ir: [] },
      injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'IR', gameStatus: null, reportDate: NOW }]]),
    })
    const recs = generateWaiverRecommendations(context, NOW)
    expect(recs[0].playerIds).toEqual(['p1']) // only the rostered (unavailable) player, never a suggested add's id
    expect(recs[0].action?.payloadType).not.toBe('waiver_add') // no direct-add action — recommendation_only
    expect(recs[0].executionCapability).toBe('recommendation_only')
  })

  it('excludes any player already rostered from being suggested as a waiver target (structurally — this generator emits no player suggestions at all)', () => {
    const context = baseContext({
      lineup: { starters: [player({ id: 'p1', position: 'QB' })], bench: [], ir: [] },
      injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'Out', gameStatus: null, reportDate: NOW }]]),
    })
    const recs = generateWaiverRecommendations(context, NOW)
    expect(recs[0].evidence.every((e) => e.source !== 'FreeAgentPool')).toBe(true)
  })

  it('suppresses when freshness is stale (Part 15 — stale availability suppression)', () => {
    const context = baseContext({
      lineup: { starters: [player({ id: 'p1', position: 'RB' })], bench: [], ir: [] },
      injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'Out', gameStatus: null, reportDate: NOW }]]),
      syncFreshness: staleFreshness(),
    })
    const recs = generateWaiverRecommendations(context, NOW)
    expect(recs).toHaveLength(0)
  })

  it('returns nothing when the waiver domain is unavailable', () => {
    const context = baseContext({ unavailableDomains: ['waiver'] })
    const recs = generateWaiverRecommendations(context, NOW)
    expect(recs).toEqual([])
  })
})
