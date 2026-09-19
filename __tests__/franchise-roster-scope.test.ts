// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ link: vi.fn(), fantrax: vi.fn(), league: vi.fn(), team: vi.fn(), roster: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  franchiseLink: { findUnique: mocks.link }, fantraxLeague: { findUnique: mocks.fantrax },
  league: { findUnique: mocks.league }, leagueTeam: { findFirst: mocks.team },
} }))
vi.mock('@/lib/leagues/rosterForTeam', () => ({ findRosterForTeam: mocks.roster, rosterPlayerIds: (data: any) => data?.players ?? null }))
import { loadFranchiseDetail } from '@/lib/franchise/franchiseService'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.link.mockResolvedValue({ id: 'link', name: 'Franchise', ownerUserId: 'owner', members: [
    { role: 'college', platform: 'fantrax', leagueId: 'college', teamExternalId: '' },
    { role: 'pro', platform: 'sleeper', leagueId: 'pro', teamExternalId: '' },
  ] })
  mocks.fantrax.mockResolvedValue({ leagueName: 'College', userTeam: 'My Team', roster: [
    { fantraxId: 'mine', teamName: 'my team' }, { fantraxId: 'theirs', teamName: 'Another team' },
  ] })
  mocks.league.mockResolvedValue({ name: 'Pro' })
  mocks.team.mockResolvedValue({ externalId: 'team', platformUserId: 'manager', teamName: 'Pro Team' })
  mocks.roster.mockResolvedValue({ playerData: { players: ['pro-player'] } })
})
describe('franchise owner rosters', () => {
  it('counts only the owner players and resolves claimed teams when membership IDs are blank', async () => {
    const detail = await loadFranchiseDetail('link')
    expect(detail?.totalPlayers).toBe(2)
    expect(detail?.sides[0].players.map((p) => p.id)).toEqual(['mine'])
    expect(detail?.view.complete).toBe(true)
    expect(mocks.team).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'pro', claimedByUserId: 'owner' } }))
    expect(mocks.roster).toHaveBeenCalledWith('pro', 'manager')
  })
  it('reports an unmatched snapshot instead of returning other managers players', async () => {
    mocks.fantrax.mockResolvedValue({ leagueName: 'College', userTeam: null, roster: [{ fantraxId: 'theirs', teamName: 'Other' }] })
    const detail = await loadFranchiseDetail('link')
    expect(detail?.sides[0].players).toEqual([])
    expect(detail?.sides[0].unavailableReason).toContain('not matched')
    expect(detail?.view.complete).toBe(false)
  })
})
