import { describe, expect, it, vi } from 'vitest'
const board = vi.hoisted(() => ({
  skipped: null, valueBySleeperId: new Map([['lb', 2010], ['dl', 134], ['missing', 100]]),
  projectionBySleeperId: new Map<string, number | null>([['lb', 17.1], ['dl', 7.25], ['missing', null]]),
  projectedFor: { season: 2026, week: 3 }, unpricedReasonBySleeperId: new Map(),
  coverage: { defenders: 3, projected: 2, priced: 3 },
}))
vi.mock('@/lib/idp-projections/leagueIdpVorp', () => ({
  resolveLeagueIdpScoring: async () => ({ ok: true }), loadLeagueIdpVorp: async () => board,
}))
vi.mock('@/lib/sleeper-client', () => ({ getLeagueInfo: vi.fn(), getLeagueRosters: vi.fn(), getPlayersBySport: vi.fn() }))
import { loadIdpTradeValuesByName } from '@/lib/idp-projections/idpTradeValues'

describe('defender value board projection provenance', () => {
  it('retains the board target week per player and never joins shared names', async () => {
    const result = await loadIdpTradeValuesByName({ prisma: {} as never, platformLeagueId: 'L', isDynasty: true,
      prefetched: { numTeams: 16, rosterPositions: ['LB', 'DL'], rosters: [{ players: ['lb', 'dl', 'missing'] }],
        players: { lb: { full_name: 'Shared Defender', position: 'LB' }, dl: { full_name: 'Shared Defender', position: 'DL' },
          missing: { full_name: 'Missing Projection', position: 'DB' } } },
    })
    expect(result.bySleeperId?.get('lb')).toMatchObject({ value: 2010, projection: { points: 17.1, season: 2026, week: 3 } })
    expect(result.bySleeperId?.get('dl')).toMatchObject({ value: 134, projection: { points: 7.25, season: 2026, week: 3 } })
    expect(result.bySleeperId?.get('missing')?.projection).toBeUndefined()
    expect(result.byNameLower.has('shared defender')).toBe(false)
  })
})
