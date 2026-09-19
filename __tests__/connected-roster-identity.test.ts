// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ identities: vi.fn(), images: vi.fn(), sleeper: vi.fn(), directory: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerIdentityMap: { findMany: mocks.identities }, sportsPlayer: { findMany: mocks.images } } }))
vi.mock('@/lib/player-identity/resolveSleeperRosterPlayers', () => ({ resolveSleeperRosterPlayers: mocks.sleeper }))
vi.mock('@/lib/sport-teams/collegeTeamIndexStore', () => ({ loadCollegeTeamIndex: mocks.directory }))
import { connectedRosterPlayers } from '@/lib/core-app/connectedRoster'
import { buildCollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIdentity'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.directory.mockResolvedValue(buildCollegeTeamIndex([{ id: 1, school: 'Texas', abbreviation: 'TEX', logo: 'https://example.com/texas.png' }]))
  mocks.images.mockResolvedValue([{ externalId: 'ri1', source: 'rolling_insights', imageUrl: 'https://example.com/player.png' }])
  mocks.identities.mockResolvedValue([{ fantraxId: 'fx1', canonicalName: 'College Player', position: 'WR', currentTeam: 'Texas', rollingInsightsId: 'ri1' }])
})
describe('Fantrax roster imagery', () => {
  it('resolves a college headshot and school logo through exact provider IDs', async () => {
    const players = await connectedRosterPlayers('fantrax', 'cfb', ['fx1'])
    expect(players[0]).toMatchObject({ name: 'College Player', imageUrl: 'https://example.com/player.png', logoUrl: 'https://example.com/texas.png' })
    expect(mocks.identities.mock.calls[0][0].where).toEqual({ sport: 'NCAAF', fantraxId: { in: ['fx1'] } })
    expect(mocks.images.mock.calls[0][0].where).toMatchObject({ sport: 'NCAAF', OR: expect.arrayContaining([{ source: 'rolling_insights', externalId: { in: ['ri1'] } }]) })
    expect(mocks.sleeper).not.toHaveBeenCalled()
  })
  it('uses CFBD headshots when Rolling Insights has none, without crossing provider namespaces', async () => {
    mocks.identities.mockResolvedValue([{ fantraxId: 'fx1', canonicalName: 'College Player', cfbdId: '123', rollingInsightsId: '456' }])
    mocks.images.mockResolvedValue([
      { externalId: '123', source: 'rolling_insights', imageUrl: 'https://example.com/wrong.png' },
      { externalId: '456', source: 'rolling_insights', imageUrl: null },
      { externalId: '123', source: 'cfbd', imageUrl: 'https://example.com/college.png' },
    ])
    const [player] = await connectedRosterPlayers('fantrax', 'NCAAF', ['fx1'])
    expect(player.imageUrl).toBe('https://example.com/college.png')
  })
  it('does not assign another athlete image when a Fantrax ID is ambiguous', async () => {
    mocks.identities.mockResolvedValue([
      { fantraxId: 'fx1', canonicalName: 'A', rollingInsightsId: 'ri1' },
      { fantraxId: 'fx1', canonicalName: 'B', rollingInsightsId: 'ri2' },
    ])
    const [player] = await connectedRosterPlayers('fantrax', 'NCAAF', [{ fantraxId: 'fx1', name: 'Imported name', team: 'Texas' }])
    expect(player.name).toBe('Imported name')
    expect(player.imageUrl).toBeNull()
  })
})

describe('Fantrax school and position identity', () => {
  it('resolves provider school abbreviations and retains the current school after a transfer', async () => {
    mocks.directory.mockResolvedValue(buildCollegeTeamIndex([{ id: 201, school: 'Oklahoma', logo: 'https://example.com/oklahoma.png' }]))
    const [player] = await connectedRosterPlayers('fantrax', 'NCAAF', [{ fantraxId: 'fx1', name: 'Player', team: 'Okla', position: 'RWT', primaryPosition: 'TE' }])
    expect(player).toMatchObject({ team: 'Oklahoma', logoUrl: 'https://example.com/oklahoma.png', position: 'TE' })
  })
  it('does not label an unresolved athlete with a flex slot or invent a school logo', async () => {
    mocks.identities.mockResolvedValue([])
    const [player] = await connectedRosterPlayers('fantrax', 'NCAAF', [{ fantraxId: 'missing', team: 'Unknown', position: 'SFX' }])
    expect(player.position).toBeNull()
    expect(player.logoUrl).toBeNull()
    expect(player.name).toBe('Player missing')
  })
})
