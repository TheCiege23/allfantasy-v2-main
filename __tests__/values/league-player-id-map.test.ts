import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/idp-projections/idpTradeValues', () => ({ loadIdpTradeValuesByName: async () => ({
  byNameLower: new Map(), bySleeperId: new Map([
    ['cb', { value: 800, position: 'CB', sleeperId: 'cb' }],
    ['dl', { value: 3200, position: 'DL', sleeperId: 'dl' }],
  ]), unpricedReasonByNameLower: new Map([['byron murphy', { code: 'ambiguous_identity', label: 'Choose a player ID' }]]),
  skipped: null, coverage: { defenders: 2, projected: 2, priced: 2, named: 0 }, ambiguousNames: ['byron murphy'],
}) }))
vi.mock('@/lib/sleeper-client', () => ({ getLeagueInfo: vi.fn(), getLeagueRosters: vi.fn(), getPlayersBySport: vi.fn() }))
import { loadLeagueTradeValues } from '@/lib/league-values/leagueTradeValues'
import { leagueValueForPlayer, valuePositionsAgree } from '@/lib/league-values/playerValueIdentity'

describe('league non-market values retain player identity', () => {
  it('preserves distinct defender values and a kicker value while refusing their shared names', async () => {
    const values = await loadLeagueTradeValues({ prisma: {} as never, platformLeagueId: 'L', isDynasty: true,
      prefetched: { rosterPositions: ['QB', 'K', 'CB', 'DL'], numTeams: 12,
        rosters: [{ players: ['cb', 'dl', 'k', 'wr'] }], players: {
          cb: { full_name: 'Byron Murphy', position: 'CB' }, dl: { full_name: 'Byron Murphy', position: 'DL' },
          k: { full_name: 'Shared Name', position: 'K' }, wr: { full_name: 'Shared Name', position: 'WR' },
        } },
    })
    expect(values.byNameLower.size).toBe(0)
    expect(values.bySleeperId?.get('cb')).toMatchObject({ value: 800, basis: 'idp-vorp', sleeperId: 'cb' })
    expect(values.bySleeperId?.get('dl')?.value).toBe(3200)
    expect(values.bySleeperId?.get('k')).toMatchObject({ value: values.kicker.value, basis: 'kicker-flat', sleeperId: 'k' })
    expect(values.unpricedReasonByNameLower?.get('shared name')?.code).toBe('ambiguous_identity')
  })
  it('never substitutes a same-name entry when an explicit ID is absent from the ID map', () => {
    expect(leagueValueForPlayer({ name: 'Shared', identity: { sleeperId: 'wr', position: 'WR' },
      bySleeperId: new Map(), byNameLower: new Map([['shared', { value: 800, position: 'LB', basis: 'idp-vorp' }]]),
    })).toBeNull()
    expect(valuePositionsAgree('CB', 'DB')).toBe(true)
    expect(valuePositionsAgree('ILB', 'LB')).toBe(true)
    expect(valuePositionsAgree('WR', 'LB')).toBe(false)
  })
})
