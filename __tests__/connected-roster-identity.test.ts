// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ identities: vi.fn(), images: vi.fn(), sleeper: vi.fn(), directory: vi.fn(), teams: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerIdentityMap: { findMany: mocks.identities }, sportsPlayer: { findMany: mocks.images }, sportsTeam: { findMany: mocks.teams } } }))
vi.mock('@/lib/player-identity/resolveSleeperRosterPlayers', () => ({ resolveSleeperRosterPlayers: mocks.sleeper }))
vi.mock('@/lib/sport-teams/collegeTeamIndexStore', () => ({ loadCollegeTeamIndex: mocks.directory }))
import { connectedRosterPlayers } from '@/lib/core-app/connectedRoster'
import { buildCollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIdentity'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.teams.mockResolvedValue([])
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

describe('college crests through the Rolling Insights team', () => {
  it('gives a basketball player his school crest from his RI row, whatever Fantrax abbreviates it to', async () => {
    mocks.identities.mockResolvedValue([{ fantraxId: 'fx1', canonicalName: 'Hoops Player', rollingInsightsId: 'ri9' }])
    mocks.images.mockResolvedValue([{ externalId: 'ri9', source: 'rolling_insights', imageUrl: null, team: 'High Point University' }])
    mocks.teams.mockResolvedValue([{ name: 'High Point University', logo: 'https://example.com/hpu.png' }])
    const [player] = await connectedRosterPlayers('fantrax', 'NCAAB', [{ fantraxId: 'fx1', team: 'HiPt' }])
    expect(player).toMatchObject({ team: 'HiPt', logoUrl: 'https://example.com/hpu.png' })
    expect(mocks.teams.mock.calls[0][0].where).toMatchObject({ sport: 'NCAAB', source: 'rolling_insights', name: { in: ['High Point University'] } })
    expect(mocks.directory).not.toHaveBeenCalled()
  })
  it('falls back to the RI crest for a football school the CFBD directory cannot name', async () => {
    mocks.images.mockResolvedValue([{ externalId: 'ri1', source: 'rolling_insights', imageUrl: null, team: 'University of Somewhere' }])
    mocks.teams.mockResolvedValue([{ name: 'University of Somewhere', logo: 'https://example.com/somewhere.png' }])
    const [player] = await connectedRosterPlayers('fantrax', 'NCAAF', [{ fantraxId: 'fx1', team: 'Smwh' }])
    expect(player.logoUrl).toBe('https://example.com/somewhere.png')
  })
  it('keeps the CFBD directory crest ahead of the RI one', async () => {
    mocks.images.mockResolvedValue([{ externalId: 'ri1', source: 'rolling_insights', imageUrl: null, team: 'University of Texas' }])
    mocks.teams.mockResolvedValue([{ name: 'University of Texas', logo: 'https://example.com/ri-texas.png' }])
    const [player] = await connectedRosterPlayers('fantrax', 'NCAAF', [{ fantraxId: 'fx1', team: 'Texas' }])
    expect(player.logoUrl).toBe('https://example.com/texas.png')
  })
  it('leaves the crest empty when the RI school has no team row, rather than borrowing another', async () => {
    mocks.identities.mockResolvedValue([{ fantraxId: 'fx1', canonicalName: 'Hoops Player', rollingInsightsId: 'ri9' }])
    mocks.images.mockResolvedValue([{ externalId: 'ri9', source: 'rolling_insights', imageUrl: null, team: 'Nowhere College' }])
    mocks.teams.mockResolvedValue([])
    const [player] = await connectedRosterPlayers('fantrax', 'NCAAB', [{ fantraxId: 'fx1', team: 'Nwhr' }])
    expect(player.logoUrl).toBeNull()
  })
  it('resolves the Fantrax football abbreviations that showed no crest on Peach Bowl', async () => {
    mocks.identities.mockResolvedValue([])
    mocks.directory.mockResolvedValue(buildCollegeTeamIndex([
      { id: 249, school: 'North Texas', logo: 'https://example.com/unt.png' },
      { id: 152, school: 'NC State', logo: 'https://example.com/ncst.png' },
      { id: 324, school: 'Coastal Carolina', logo: 'https://example.com/ccu.png' },
    ]))
    const rows = await connectedRosterPlayers('fantrax', 'NCAAF', ['NorTx', 'NCSt', 'CoCar'].map((team, i) => ({ fantraxId: `fx${i}`, team })))
    expect(rows.map((r) => r.logoUrl)).toEqual(['https://example.com/unt.png', 'https://example.com/ncst.png', 'https://example.com/ccu.png'])
  })
})
