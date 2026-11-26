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
// THE grade is the draft-proposal verdict (2026-11-26): the league grader is the only double.
const grade = vi.hoisted(() => vi.fn())
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({
  createLeagueTradeGrader: vi.fn(async () => ({ grade })),
  gradeDeal: async (grader: any, args: any) => grader.grade({ give: args.give.assets, get: args.get.assets, viewerSide: args.viewerSide }),
}))
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
it('returns THE receiver-side league grade for a draft-pick proposal without private response payloads', async () => {
  // Receiver gives 4.01 for 2.01 — the retired distance rule said ACCEPT; the grade says D.
  grade.mockResolvedValue({ graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', action: 'counter', giveValue: 1200, getValue: 1000, recommendation: 'Favors the other side on league value.' })
  const session = { teamCount: 12, draftType: 'snake', thirdRoundReversal: false, draftModeLabel: 'rookie', playerPool: 'all', startedAt: new Date('2026-05-01T00:00:00Z') }
  mocks.draftProposals.mockResolvedValue([
    { id: 'dp1', status: 'pending', createdAt: new Date(), proposerRosterId: 'other', receiverRosterId: 'roster-viewer',
      proposerName: 'Alpha', receiverName: 'Beta', giveRound: 2, giveSlot: 1, receiveRound: 4, receiveSlot: 1,
      session, responsePayload: { secret: true } },
    { id: 'dp2', status: 'pending', createdAt: new Date(), proposerRosterId: 'other', receiverRosterId: 'roster-viewer',
      proposerName: 'Alpha', receiverName: 'Beta', giveRound: 2, giveSlot: 1, receiveRound: 4, receiveSlot: 1,
      session: { ...session, draftModeLabel: 'startup', playerPool: 'all' } },
  ])
  const res = await GET(new NextRequest('http://localhost/api/league/trade-grades?leagueId=league-a&view=draft-proposals'))
  const data = await res.json()
  expect(data.proposals[0]).toMatchObject({ grade: 'D', involvesYou: true })
  expect(data.proposals[0].explanation).toBe("Receiver's league grade D (Slightly favors opponent): Favors the other side on league value.")
  // The receiver's side: it gives 4.01 and gets 2.01.
  expect(grade.mock.calls[0][0].give[0]).toMatchObject({ round: 4 })
  expect(grade.mock.calls[0][0].get[0]).toMatchObject({ round: 2 })
  expect(data.proposals[1]).toMatchObject({ grade: null })
  expect(data.proposals[1].explanation).toMatch(/^Not graded: Only rookie-draft picks are graded/)
  expect(grade).toHaveBeenCalledTimes(1)
  expect(mocks.draftProposals.mock.calls[0][0].select.session.select).toMatchObject({ draftModeLabel: true, playerPool: true, startedAt: true })
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
