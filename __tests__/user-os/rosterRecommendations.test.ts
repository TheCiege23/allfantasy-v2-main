import { describe, expect, it } from 'vitest'
import { generateRosterRecommendations } from '@/lib/shared-services/league-hub/generators/rosterRecommendations'
import { baseContext, player } from './fixtures'

const NOW = '2026-07-13T00:00:00.000Z'

describe('generateRosterRecommendations', () => {
  it('flags injury concentration when 3+ roster players are out', () => {
    const injured = { playerId: '', status: 'Out', gameStatus: null, reportDate: NOW }
    const context = baseContext({
      lineup: {
        starters: [player({ id: 'p1' }), player({ id: 'p2' }), player({ id: 'p3' })],
        bench: [player({ id: 'p4', status: 'healthy' })],
        ir: [],
      },
      injuryByPlayerId: new Map([
        ['p1', { ...injured, playerId: 'p1' }],
        ['p2', { ...injured, playerId: 'p2' }],
        ['p3', { ...injured, playerId: 'p3' }],
      ]),
    })
    const recs = generateRosterRecommendations(context, NOW)
    expect(recs.some((r) => r.type === 'injury_concentration')).toBe(true)
  })

  it('does not flag injury concentration for a single injury', () => {
    const context = baseContext({
      lineup: { starters: [player({ id: 'p1' })], bench: [], ir: [] },
      injuryByPlayerId: new Map([['p1', { playerId: 'p1', status: 'Out', gameStatus: null, reportDate: NOW }]]),
    })
    const recs = generateRosterRecommendations(context, NOW)
    expect(recs.some((r) => r.type === 'injury_concentration')).toBe(false)
  })

  it('flags positional weakness with exactly one player at a position on a large-enough roster', () => {
    const context = baseContext({
      lineup: {
        starters: [
          player({ id: 'p1', position: 'QB' }),
          player({ id: 'p2', position: 'RB' }),
          player({ id: 'p3', position: 'RB' }),
        ],
        bench: [
          player({ id: 'p4', position: 'WR' }),
          player({ id: 'p5', position: 'WR' }),
          player({ id: 'p6', position: 'TE' }),
          player({ id: 'p7', position: 'K' }),
          player({ id: 'p8', position: 'DEF' }),
        ],
        ir: [],
      },
    })
    const recs = generateRosterRecommendations(context, NOW)
    expect(recs.some((r) => r.type === 'position_weakness' && r.title.includes('QB'))).toBe(true)
  })

  it('flags bench inefficiency when a bench player outprojects a starter at the same position', () => {
    const context = baseContext({
      lineup: {
        starters: [player({ id: 'starter', position: 'WR', projection: 8 })],
        bench: [player({ id: 'bench', position: 'WR', projection: 15 })],
        ir: [],
      },
    })
    const recs = generateRosterRecommendations(context, NOW)
    const rec = recs.find((r) => r.type === 'bench_inefficiency')
    expect(rec).toBeDefined()
    expect(rec?.playerIds).toEqual(['bench', 'starter'])
  })

  it('does not apply dynasty age/pick logic — no such recommendation type exists this phase', () => {
    const context = baseContext({ isDynasty: true })
    const recs = generateRosterRecommendations(context, NOW)
    expect(recs.every((r) => !r.type.includes('age') && !r.type.includes('pick'))).toBe(true)
  })

  it('returns nothing when the roster domain is unavailable', () => {
    const context = baseContext({ unavailableDomains: ['roster'], lineup: null, teamId: null })
    const recs = generateRosterRecommendations(context, NOW)
    expect(recs).toEqual([])
  })
})
