import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ season: vi.fn(), players: vi.fn(), rights: vi.fn(), c2c: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { redraftSeason: { findFirst: m.season }, redraftRosterPlayer: { findMany: m.players }, devyRights: { findMany: m.rights }, c2CPlayerState: { findMany: m.c2c } } }))
import { loadRookieAuctionAvailability } from '@/lib/live-draft-engine/auction/rookieAuctionAvailability'

beforeEach(() => {
  m.season.mockReset().mockResolvedValue({ id: 'season-2' })
  m.players.mockReset().mockResolvedValue([{ playerId: 'p1', playerName: 'John Smith Jr.' }])
  m.rights.mockReset().mockResolvedValue([{ devyPlayerId: 'college-1', promotedProPlayerId: 'pro-1' }])
  m.c2c.mockReset().mockResolvedValue([{ playerId: 'c2c-1', playerName: 'Campus Star' }])
})
describe('rookie auction availability', () => {
  it('refuses current rostered players by id or canonical name', async () => {
    const available = await loadRookieAuctionAvailability('league')
    expect(available({ playerId: 'p1', playerName: 'Different Name' })).toBe(false)
    expect(available({ playerName: 'john smith jr.' })).toBe(false)
    expect(available({ playerId: 'p2', playerName: 'Another Player' })).toBe(true)
    expect(available({ playerId: 'pro-1', playerName: 'Promoted Player' })).toBe(false)
    expect(available({ playerName: 'Campus Star' })).toBe(false)
    expect(m.players).toHaveBeenCalledWith(expect.objectContaining({ where: { droppedAt: null, roster: { leagueId: 'league', seasonId: 'season-2' } } }))
  })
  it('does not guess when current league rosters cannot be loaded', async () => {
    m.season.mockResolvedValue(null)
    await expect(loadRookieAuctionAvailability('league')).rejects.toThrow(/rosters are unavailable/)
  })
})
