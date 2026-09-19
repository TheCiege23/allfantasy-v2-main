import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), league: vi.fn(), proposals: vi.fn(), draftProposals: vi.fn(), rosterId: vi.fn(), commissioner: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: mocks.league }, redraftTradeProposal: { findMany: mocks.proposals }, draftPickTradeProposal: { findMany: mocks.draftProposals } } }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: mocks.rosterId }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: mocks.commissioner }))
vi.mock('@/lib/trade-intel/importedTradeLedgerService', () => ({ getImportedTradeLedger: vi.fn() }))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ getTradeGrades: vi.fn() }))
import { GET } from '@/app/api/league/trade-grades/route'
const request = () => new NextRequest('http://localhost/api/league/trade-grades?leagueId=league-a&view=proposals')
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'viewer' } })
  mocks.league.mockResolvedValue({ id: 'league-a' })
  mocks.proposals.mockResolvedValue([])
  mocks.draftProposals.mockResolvedValue([])
  mocks.rosterId.mockResolvedValue('roster-viewer')
  mocks.commissioner.mockResolvedValue(false)
})
it('keeps private draft-pick proposals participant-only and accepted ones league-visible', async () => {
  const res = await GET(new NextRequest('http://localhost/api/league/trade-grades?leagueId=league-a&view=draft-proposals'))
  expect(res.status).toBe(200)
  expect(mocks.draftProposals.mock.calls[0][0].where).toEqual({
    session: { leagueId: 'league-a' },
    OR: [
      { proposerRosterId: 'roster-viewer' },
      { receiverRosterId: 'roster-viewer' },
      { status: 'accepted' },
    ],
  })
})
it('returns a deterministic receiver-side draft verdict without private response payloads', async () => {
  mocks.draftProposals.mockResolvedValue([{
    id: 'dp1', status: 'pending', createdAt: new Date(), proposerRosterId: 'other', receiverRosterId: 'roster-viewer',
    proposerName: 'Alpha', receiverName: 'Beta', giveRound: 2, giveSlot: 1, receiveRound: 4, receiveSlot: 1,
    session: { teamCount: 12, draftType: 'snake', thirdRoundReversal: false }, responsePayload: { secret: true },
  }])
  const res = await GET(new NextRequest('http://localhost/api/league/trade-grades?leagueId=league-a&view=draft-proposals'))
  const data = await res.json()
  expect(data.proposals[0]).toMatchObject({ grade: 'ACCEPT', involvesYou: true })
  expect(data.proposals[0].explanation).toMatch(/receiver-side draft-capital verdict/i)
  expect(JSON.stringify(data)).not.toContain('secret')
  expect(res.headers.get('cache-control')).toBe('private, no-store')
})
it('denies access before reading offers for a nonmember', async () => {
  mocks.league.mockResolvedValue(null)
  expect((await GET(request())).status).toBe(404)
  expect(mocks.proposals).not.toHaveBeenCalled()
})
it('restricts private proposals to the viewer in the selected league', async () => {
  await GET(request())
  expect(mocks.proposals.mock.calls[0][0].where).toEqual({ leagueId: 'league-a', OR: [
    { proposerRoster: { ownerId: 'viewer' } }, { receiverRoster: { ownerId: 'viewer' } },
    { status: { in: ['accepted', 'approved', 'completed', 'executed'] } },
  ] })
})
it('withholds thin grades and keeps raw private snapshot data off the wire', async () => {
  mocks.proposals.mockResolvedValue([{ id: 'p1', status: 'pending', createdAt: new Date(),
    proposerRoster: { ownerId: 'viewer', teamName: 'A' }, receiverRoster: { ownerId: 'other', teamName: 'B' }, assets: [],
    valueSnapshot: { grade: 'A+', confidenceScore: 0, payload: { grade: { insufficientData: true }, privateData: 'secret' } },
  }])
  const res = await GET(request())
  const data = await res.json()
  expect(data.proposals[0].grade).toBeNull()
  expect(JSON.stringify(data)).not.toContain('secret')
  expect(res.headers.get('cache-control')).toBe('private, no-store')
})
