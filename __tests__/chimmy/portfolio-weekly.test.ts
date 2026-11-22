import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ world: vi.fn(), names: vi.fn(), basis: vi.fn(), price: vi.fn() }))
vi.mock('@/lib/decision-os/world', () => ({ resolveCanonicalWorld: h.world }))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({ resolveNames: h.names }))
vi.mock('@/lib/chimmy/lineupAvailability', () => ({ enrichLineupAvailability: async (_: string, names: unknown) => names, unavailableForLineup: (s: string) => s === 'Out' }))
vi.mock('@/lib/decision-os/trade/leagueWeekPricing', () => ({ leagueWeekBasis: h.basis, isLeagueWeekRefusal: (b: object) => 'refuse' in b, priceLeagueWeek: h.price }))
import { weeklyLeagueStrength } from '@/lib/chimmy/portfolio/weeklyStrength'

const world = () => ({ league: { sport: 'NFL', season: 2026, teamCount: 3, rosterSettings: { starterSlots: ['QB'] } },
  provenance: { provider: 'sleeper' }, teams: [{ teamId: 't1', managerUserId: 'u1' }],
  rosters: [1, 2, 3].map(i => ({ rosterId: 'r' + i, teamId: 't' + i, playerIds: ['p' + i], reserveIds: [], taxiIds: [] })) })
beforeEach(() => {
  vi.resetAllMocks()
  h.world.mockResolvedValue(world())
  h.basis.mockResolvedValue({ rules: { pass_td: 6 }, week: { season: '2026', week: 9 } })
  h.names.mockResolvedValue(new Map([1, 2, 3].map(i => ['p' + i, { name: 'Quarterback ' + i, position: 'QB', injury: null }])))
  h.price.mockResolvedValue(new Map([1, 2, 3].map(i => ['p' + i, { playerId: 'p' + i, position: 'QB', projectedPoints: i * 10 }])))
})
describe('weekly league-relative strength', () => {
  it('uses the shared league scorer and lineup fill to rank within a single league', async () => {
    const result = await weeklyLeagueStrength('a', 'u1')
    expect(result).toMatchObject({ rank: 3, outOf: 3, points: 10, weakest: { position: 'QB', rank: 3, outOf: 3 } })
    expect(h.price).toHaveBeenCalledWith(expect.objectContaining({ rules: { pass_td: 6 } }), ['p1', 'p2', 'p3'], expect.any(Map))
  })
  it('does not rank a league with missing opponent projections as complete', async () => {
    h.price.mockResolvedValue(new Map([['p1', { playerId: 'p1', position: 'QB', projectedPoints: 10 }]]))
    expect(await weeklyLeagueStrength('a', 'u1')).toBeNull()
  })
  it('rejects a projection feed from the wrong season', async () => {
    h.basis.mockResolvedValue({ rules: { pass_td: 6 }, week: { season: '2025', week: 9 } })
    expect(await weeklyLeagueStrength('a', 'u1')).toBeNull()
    expect(h.price).not.toHaveBeenCalled()
  })
  it('does not rank missing teams or unsupported slots', async () => {
    const w = world(); w.league.teamCount = 4; h.world.mockResolvedValue(w)
    expect(await weeklyLeagueStrength('a', 'u1')).toBeNull()
    w.league.teamCount = 3; w.league.rosterSettings.starterSlots = ['UNKNOWN']; h.world.mockResolvedValue(w)
    expect(await weeklyLeagueStrength('a', 'u1')).toBeNull()
  })
  it('excludes an unavailable player from a positive weekly contribution', async () => {
    h.names.mockResolvedValue(new Map([1, 2, 3].map(i => ['p' + i, { name: 'Quarterback ' + i, position: 'QB', injury: i === 1 ? 'Out' : null }])))
    expect(await weeklyLeagueStrength('a', 'u1')).toMatchObject({ points: 0, rank: 3 })
  })
})
