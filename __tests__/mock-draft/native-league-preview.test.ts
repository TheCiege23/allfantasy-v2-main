// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  viewer: 'owner', platform: 'manual', member: '' as string, draft: true,
  findLeague: vi.fn(), draftSession: vi.fn(), config: vi.fn(), template: vi.fn(), sleeper: vi.fn(),
  redraft: vi.fn(), rosterCount: vi.fn(), claim: vi.fn(), imported: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: mocks.viewer } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: mocks.findLeague, findFirst: mocks.imported },
  draftSession: { findFirst: mocks.draftSession },
  redraftLeagueMember: { findUnique: mocks.redraft }, roster: { count: mocks.rosterCount },
  leagueTeam: { findFirst: mocks.claim },
} }))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({ getDraftConfigForLeague: mocks.config }))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({ getEffectiveLeagueRosterTemplate: mocks.template }))
vi.mock('@/lib/sleeper-client', () => ({ getLeagueInfo: mocks.sleeper, getLeagueRosters: mocks.sleeper, getLeagueUsers: mocks.sleeper, getLeagueDrafts: mocks.sleeper, getScoringType: () => 'Standard' }))
import { GET } from '@/app/api/mock-draft/route'

const rosters = Array.from({ length: 16 }, (_, index) => ({ id: `roster-${index + 1}`, platformUserId: index === 0 ? 'owner' : index === 1 ? 'friend' : `open-slot-${index + 1}` }))
const teams = [...rosters].reverse().map((r, index) => ({ id: `team-${r.id}`, externalId: r.id, claimedByUserId: null, platformUserId: null, ownerName: `Manager ${r.id}`, avatarUrl: null, role: 'member', isOrphan: index < 14, wins: 0, losses: 0, ties: 0, pointsFor: 0 }))
const league = {
  id: 'native-nba', name: 'NBA Redraft', platformLeagueId: 'native-nba', sport: 'NBA', scoring: 'points', isDynasty: false, leagueSize: 16,
  rosters, teams,
  leagueEntrySlots: rosters.map((r, index) => ({ slotNumber: index + 1, rosterId: r.id, status: index < 2 ? 'FILLED' : 'OPEN' })),
  leagueSettings: { draftOrderSlots: null },
}
const request = () => new NextRequest('https://allfantasy.ai/api/mock-draft?leagueId=native-nba&platformLeagueId=wrong-provider-id&sport=NFL')

beforeEach(() => {
  vi.clearAllMocks(); mocks.viewer = 'owner'; mocks.platform = 'manual'; mocks.member = ''; mocks.draft = true
  mocks.findLeague.mockImplementation(async ({ select }) => select.platform ? { platform: mocks.platform } : select.userId ? { id: league.id, sport: 'NBA', userId: 'owner' } : league)
  mocks.redraft.mockImplementation(async () => mocks.member === 'redraft' ? { role: 'MEMBER' } : null)
  mocks.rosterCount.mockImplementation(async () => mocks.member === 'roster' ? 1 : 0)
  mocks.claim.mockImplementation(async () => mocks.member === 'claim' ? { isCommissioner: false, isCoCommissioner: false } : null)
  mocks.config.mockResolvedValue({ rounds: 9, draft_type: 'snake' })
  mocks.template.mockResolvedValue({ superflexSlotNames: [], template: { slots: [
    { slotName: 'BN', starterCount: 0, benchCount: 4 },
    { slotName: 'UTIL', starterCount: 4, benchCount: 0 },
    { slotName: 'SUPER_UTIL', starterCount: 1, benchCount: 0 },
    { slotName: 'IL', starterCount: 0, benchCount: 0, reserveCount: 1 },
  ] } })
  mocks.draftSession.mockResolvedValue({ teamCount: 16, rounds: 9, draftType: 'snake', slotOrder: [...rosters].reverse().map((r, index) => ({ slot: index + 1, rosterId: r.id, displayName: 'Saved name' })) })
  mocks.imported.mockResolvedValue(null)
})

describe('native league mock preview', () => {
  it('uses actual NBA settings, roster identities and saved order without calling Sleeper or writing', async () => {
    const response = await GET(request()); expect(response.status).toBe(200)
    const { league: preview } = await response.json()
    expect(preview).toMatchObject({ leagueId: 'native-nba', leagueName: 'NBA Redraft', sport: 'NBA', scoring: 'Points', isDynasty: false, teamCount: 16, rounds: 9, draftType: 'snake', detectedUserSlot: 16, hasExplicitDraftOrder: true })
    expect(preview.rosterSlots).toEqual(['UTIL', 'UTIL', 'UTIL', 'UTIL', 'SUPER_UTIL', 'BN', 'BN', 'BN', 'BN'])
    expect(preview.managers).toHaveLength(16)
    expect(preview.managers[0]).toMatchObject({ slot: 1, managerName: 'Manager roster-16', isOrphan: true })
    expect(preview.managers[15]).toMatchObject({ slot: 16, managerId: 'owner', isUser: true })
    expect(mocks.sleeper).not.toHaveBeenCalled(); expect(mocks.imported).not.toHaveBeenCalled()
  })
  it.each(['redraft', 'roster', 'claim'])('permits an invited manager through canonical %s membership', async member => {
    mocks.viewer = 'friend'; mocks.member = member
    const response = await GET(request()); expect(response.status).toBe(200)
    expect((await response.json()).league.detectedUserSlot).toBe(15)
    expect(mocks.sleeper).not.toHaveBeenCalled()
  })
  it('rejects nonmembers before loading managers or settings', async () => {
    mocks.viewer = 'stranger'
    const response = await GET(request()); expect(response.status).toBe(403)
    expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.draftSession).not.toHaveBeenCalled(); expect(mocks.sleeper).not.toHaveBeenCalled()
  })
  it('rejects anonymous visitors before looking up the league', async () => {
    mocks.viewer = ''
    expect((await GET(request())).status).toBe(401); expect(mocks.findLeague).not.toHaveBeenCalled()
  })
  it('uses entry-slot order and sport defaults before a draft exists', async () => {
    mocks.draftSession.mockResolvedValue(null)
    const preview = (await (await GET(request())).json()).league
    expect(preview.rounds).toBe(9); expect(preview.hasExplicitDraftOrder).toBe(false)
    expect(preview.managers[0]).toMatchObject({ managerId: 'owner', slot: 1, isUser: true })
  })
  it('preserves unfilled entry seats before the first draft exists', async () => {
    mocks.draftSession.mockResolvedValue(null)
    mocks.findLeague.mockImplementation(async ({ select }) => select.platform ? { platform: 'manual' } : select.userId ? { id: league.id, sport: 'NBA', userId: 'owner' } : {
      ...league, rosters: [rosters[0]], leagueEntrySlots: [{ slotNumber: 7, rosterId: rosters[0].id, status: 'FILLED' }, { slotNumber: 1, rosterId: null, status: 'OPEN' }],
    })
    const preview = (await (await GET(request())).json()).league
    expect(preview.detectedUserSlot).toBe(7)
    expect(preview.managers[0]).toMatchObject({ slot: 1, isOrphan: true, isUser: false })
    expect(preview.managers[6]).toMatchObject({ slot: 7, isUser: true })
  })
  it('keeps imported league ownership checks on the existing Sleeper path', async () => {
    mocks.platform = 'sleeper'
    const response = await GET(new NextRequest('https://allfantasy.ai/api/mock-draft?leagueId=someone-elses-import'))
    expect(response.status).toBe(404); expect(mocks.imported).toHaveBeenCalled()
    expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.sleeper).not.toHaveBeenCalled()
  })
})
