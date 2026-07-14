import { describe, expect, it } from 'vitest'
import { generateLineupRecommendations } from '@/lib/shared-services/league-hub/generators/lineupRecommendations'
import { baseContext, player, staleFreshness } from './fixtures'

const NOW = '2026-07-13T00:00:00.000Z'

describe('generateLineupRecommendations', () => {
  it('flags a starter with a live injury report indicating out status', () => {
    const context = baseContext({
      lineup: { starters: [player({ id: 'p1', status: 'healthy' })], bench: [], ir: [] },
      injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'Out', gameStatus: null, reportDate: NOW }]]),
    })
    const recs = generateLineupRecommendations(context, NOW)
    expect(recs).toHaveLength(1)
    expect(recs[0].type).toBe('injured_starter')
    expect(recs[0].priority).toBe('critical')
    expect(recs[0].playerIds).toEqual(['p1'])
  })

  it('does not flag a healthy starter', () => {
    const context = baseContext({ lineup: { starters: [player({ status: 'healthy' })], bench: [], ir: [] } })
    const recs = generateLineupRecommendations(context, NOW)
    expect(recs.filter((r) => r.type === 'injured_starter')).toHaveLength(0)
  })

  it('flags an empty starting lineup when bench/IR players exist', () => {
    const context = baseContext({
      lineup: { starters: [], bench: [player({ id: 'b1' })], ir: [] },
    })
    const recs = generateLineupRecommendations(context, NOW)
    expect(recs.some((r) => r.type === 'empty_slot')).toBe(true)
  })

  it('does not flag an empty lineup when the roster genuinely has no players at all', () => {
    const context = baseContext({ lineup: { starters: [], bench: [], ir: [] } })
    const recs = generateLineupRecommendations(context, NOW)
    expect(recs.some((r) => r.type === 'empty_slot')).toBe(false)
  })

  it('suppresses a critical injury alert when sync freshness is stale (Part 15)', () => {
    const context = baseContext({
      lineup: { starters: [player({ id: 'p1' })], bench: [], ir: [] },
      injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'Out', gameStatus: null, reportDate: NOW }]]),
      syncFreshness: staleFreshness(),
    })
    const recs = generateLineupRecommendations(context, NOW)
    expect(recs).toHaveLength(0)
  })

  it('returns nothing when the lineup domain is marked unavailable (e.g. no claimed roster)', () => {
    const context = baseContext({ unavailableDomains: ['lineup'], teamId: null, lineup: null })
    const recs = generateLineupRecommendations(context, NOW)
    expect(recs).toEqual([])
  })

  it('never generates lineup recommendations for a non-NFL context (illegal-position suppression via unavailableDomains)', () => {
    const context = baseContext({ sport: 'NBA', unavailableDomains: ['lineup', 'waiver'] })
    const recs = generateLineupRecommendations(context, NOW)
    expect(recs).toEqual([])
  })

  it('produces deterministic ids — same context twice never duplicates', () => {
    const context = baseContext({
      lineup: { starters: [player({ id: 'p1' })], bench: [], ir: [] },
      injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'Out', gameStatus: null, reportDate: NOW }]]),
    })
    const first = generateLineupRecommendations(context, NOW)
    const second = generateLineupRecommendations(context, NOW)
    expect(first[0].id).toBe(second[0].id)
  })
})
