/**
 * College football pools: former players leave, and projections rank the rest (2026-11-27).
 */
import { describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { aFProjectionSnapshot: { findMany: (...a: unknown[]) => findMany(...a) } } }))

import { isFormerCollegeFootballRow } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { loadAfBaselineProjectionsByCfbdIds } from '@/lib/af-projections/readAfProjections'

describe('isFormerCollegeFootballRow', () => {
  it('drops a Rolling Insights row its source marks INACT, keeps ACT', () => {
    expect(isFormerCollegeFootballRow('NCAAF', { source: 'rolling_insights', status: 'INACT' })).toBe(true)
    expect(isFormerCollegeFootballRow('NCAAF', { source: 'rolling_insights', status: 'ACT' })).toBe(false)
  })
  it('drops TheSportsDB coaches and retirees, keeps Active', () => {
    expect(isFormerCollegeFootballRow('NCAAF', { source: 'thesportsdb', status: 'Coaching' })).toBe(true)
    expect(isFormerCollegeFootballRow('NCAAF', { source: 'thesportsdb', status: 'Retired' })).toBe(true)
    expect(isFormerCollegeFootballRow('NCAAF', { source: 'thesportsdb', status: 'Active' })).toBe(false)
  })
  it('keeps a row with no status, and every CFBD row', () => {
    expect(isFormerCollegeFootballRow('NCAAF', { source: 'rolling_insights', status: null })).toBe(false)
    expect(isFormerCollegeFootballRow('NCAAF', { source: 'cfbd', status: 'active' })).toBe(false)
  })
  it('never touches another sport: an INACT row there is the feed\'s, not this rule\'s', () => {
    expect(isFormerCollegeFootballRow('NFL', { source: 'rolling_insights', status: 'INACT' })).toBe(false)
    expect(isFormerCollegeFootballRow('NCAAB', { source: 'rolling_insights', status: 'INACT' })).toBe(false)
  })
})

describe('loadAfBaselineProjectionsByCfbdIds', () => {
  it('reads season projections keyed by the CFBD id itself, positive and newest only', async () => {
    findMany.mockResolvedValue([
      { playerId: '5079574', afProjection: 14.2, season: 2026, computedAt: new Date('2026-11-27') },
      { playerId: '5079574', afProjection: 9, season: 2025, computedAt: new Date('2025-11-27') },
      { playerId: '5082548', afProjection: 0, season: 2026, computedAt: new Date('2026-11-27') },
    ])
    const out = await loadAfBaselineProjectionsByCfbdIds({ cfbdIds: ['5079574', '5082548', 'not-a-cfbd-id'], season: 2026 })
    expect(findMany.mock.calls[0][0].where).toMatchObject({ sport: 'NCAAF', week: null, playerId: { in: ['5079574', '5082548'] } })
    expect(out.get('5079574')?.afProjection).toBe(14.2)
    expect(out.has('5082548')).toBe(false)
  })
})
