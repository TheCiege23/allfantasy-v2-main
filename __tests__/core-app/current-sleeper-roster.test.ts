import { beforeEach, describe, expect, it, vi } from 'vitest'
const get = vi.hoisted(() => vi.fn())
vi.mock('@/lib/trade-intel/sleeperTradeSync', () => ({ sleeperGet: get }))
import { currentSleeperRoster } from '@/lib/core-app/currentSleeperRoster'

function mockRosters(rows: unknown) {
  get.mockImplementation(async (path: string) => path.endsWith('/rosters') ? rows : { status: 'pre_draft' })
}

describe('current Sleeper lineup', () => {
  beforeEach(() => { get.mockReset() })
  it('keeps a benched injured player out of starters and preserves empty slot order', async () => {
    mockRosters([{ roster_id: 3, owner_id: 'owner', players: ['sampson', 'hill'], starters: ['hill', '0'], reserve: [], taxi: [] }])
    expect(await currentSleeperRoster('league', { platformUserId: 'owner', externalId: '3' })).toEqual({
      players: ['sampson', 'hill'], starters: ['hill', '0'], reserve: [], taxi: [],
    })
  })
  it('uses the current weekly lineup when Sleeper roster starters are stale', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.endsWith('/rosters')) return [{ roster_id: 3, owner_id: 'owner', players: ['sampson', 'hill'], starters: ['sampson', '0'], reserve: [], taxi: [] }]
      if (path.endsWith('/matchups/2')) return [{ roster_id: 3, matchup_id: null, starters: ['hill', null] }]
      return { status: 'in_season', settings: { leg: 2 } }
    })
    expect((await currentSleeperRoster('league', { platformUserId: 'owner' }))?.starters).toEqual(['hill', '0'])
    expect(get).toHaveBeenCalledWith('/league/league/matchups/2')
  })
  it.each([null, [], [{ roster_id: 9, starters: ['sampson'] }], [{ roster_id: 3 }]])('does not revive stale roster starters when weekly data is unavailable: %j', async (weekly) => {
    get.mockImplementation(async (path: string) => {
      if (path.endsWith('/rosters')) return [{ roster_id: 3, owner_id: 'owner', players: ['sampson'], starters: ['sampson'] }]
      if (path.endsWith('/matchups/2')) return weekly
      return { status: 'in_season', settings: { leg: 2 } }
    })
    expect(await currentSleeperRoster('league', { platformUserId: 'owner' })).toBeNull()
  })
  it('does not substitute another owner with the old roster number', async () => {
    mockRosters([{ roster_id: 3, owner_id: 'stranger', players: ['sampson'], starters: ['sampson'] }])
    expect(await currentSleeperRoster('league', { platformUserId: 'owner', externalId: '3' })).toBeNull()
  })
  it('returns unknown when the provider fails or omits starters', async () => {
    mockRosters(null)
    expect(await currentSleeperRoster('league', { platformUserId: 'owner' })).toBeNull()
    mockRosters([{ roster_id: 3, owner_id: 'owner', players: ['sampson'] }])
    expect(await currentSleeperRoster('league', { platformUserId: 'owner' })).toBeNull()
  })
  it('resolves a claimed roster number when no owner id is available', async () => {
    mockRosters([{ roster_id: 3, owner_id: 'owner', players: null, starters: [] }])
    expect(await currentSleeperRoster('league', { externalId: '3' })).toEqual({ players: [], starters: [], reserve: [], taxi: [] })
  })
  it('preserves separate bench, reserve and taxi assignments', async () => {
    const row = { roster_id: 3, owner_id: 'owner', players: ['starter', 'bench', 'ir', 'taxi'], starters: ['starter', '0'], reserve: ['ir'], taxi: ['taxi'] }
    mockRosters([row])
    expect(await currentSleeperRoster('league', { platformUserId: 'owner' })).toEqual({ players: row.players, starters: row.starters, reserve: row.reserve, taxi: row.taxi })
  })
  it('preserves null empty-slot positions instead of shifting a FLEX player into QB', async () => {
    mockRosters([{ roster_id: 3, owner_id: 'owner', players: ['hill'], starters: [null, '', 'hill'] }])
    expect((await currentSleeperRoster('league', { platformUserId: 'owner' }))?.starters).toEqual(['0', '0', 'hill'])
  })
  it('fails closed on contradictory slots and thrown provider failures', async () => {
    mockRosters([{ roster_id: 3, owner_id: 'owner', players: ['ir'], starters: ['ir'], reserve: ['ir'] }])
    expect(await currentSleeperRoster('league', { platformUserId: 'owner' })).toBeNull()
    get.mockRejectedValue(new Error('timeout'))
    expect(await currentSleeperRoster('league', { platformUserId: 'owner' })).toBeNull()
  })
})
