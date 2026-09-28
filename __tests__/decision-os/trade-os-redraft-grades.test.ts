/**
 * Trade OS (design build-order step 5): the redraft proposal list and the commissioner review show the
 * ONE grade — not the proposal-time `TradeValueSnapshot` letter (`canonicalFairnessGrade`, A+..F).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  session: vi.fn(),
  member: vi.fn(),
  proposalsFindMany: vi.fn(),
  proposalFindUnique: vi.fn(),
  createGrader: vi.fn(),
  gradeDeal: vi.fn(),
  receiptIdForGrade: vi.fn(),
  evaluateStoredTrade: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: h.member }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftTradeProposal: { findMany: h.proposalsFindMany, findUnique: h.proposalFindUnique },
    league: {
      findFirst: vi.fn(async () => ({ userId: 'commish', teams: [] })),
      findUnique: vi.fn(async () => ({ scoring: 'ppr', tradeReviewHours: 48, tradeDeadlineWeek: 12, draftPickTrading: false })),
    },
    redraftSeason: { findUnique: vi.fn(async () => ({ sport: 'NFL', season: 2026, currentWeek: 5 })) },
    redraftRoster: { count: vi.fn(async () => 12), findUnique: vi.fn(async () => null) },
    redraftTradeMarketEvent: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({ createLeagueTradeGrader: h.createGrader, gradeDeal: h.gradeDeal }))
vi.mock('@/lib/decision-os/trade/recordTradeGrade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/decision-os/trade/recordTradeGrade')>()),
  receiptIdForGrade: h.receiptIdForGrade,
}))
vi.mock('@/lib/decision-os/trade/evaluateStoredTrade', () => ({ evaluateStoredTrade: h.evaluateStoredTrade }))

import { GET as listProposals } from '@/app/api/redraft/trade-proposals/route'
import { GET as commissionerReview } from '@/app/api/redraft/trades/[proposalId]/commissioner-review/route'

const SNAPSHOT = { grade: 'A+', fairnessScore: 31, confidenceScore: 40, valueDifference: 900, payload: null }
const PROPOSAL = {
  id: 'rp1',
  leagueId: 'l1',
  seasonId: 's1',
  status: 'pending',
  proposerRosterId: 'rr-a',
  receiverRosterId: 'rr-b',
  vetoMode: 'commissioner',
  vetoThreshold: null,
  assets: [
    { fromRosterId: 'rr-a', toRosterId: 'rr-b', assetType: 'player', playerId: 'p1', playerName: 'Star Runner', pickSeason: null, pickRound: null, metadata: null },
    { fromRosterId: 'rr-b', toRosterId: 'rr-a', assetType: 'draft_pick', playerId: null, playerName: null, pickSeason: 2027, pickRound: 1, metadata: null },
  ],
  votes: [],
  decision: null,
  valueSnapshot: SNAPSHOT,
}
const ONE_GRADE = { graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', percentDiff: -18, giveValue: 5000, getValue: 4100, recommendation: 'Counter.' }

const listReq = () =>
  ({ nextUrl: { searchParams: new URLSearchParams({ leagueId: 'l1', seasonId: 's1' }) } }) as unknown as Parameters<typeof listProposals>[0]

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'commish' } })
  h.member.mockResolvedValue({ ok: true })
  h.proposalsFindMany.mockResolvedValue([PROPOSAL])
  h.proposalFindUnique.mockResolvedValue(PROPOSAL)
  h.createGrader.mockResolvedValue({ grade: vi.fn() })
  h.gradeDeal.mockResolvedValue(ONE_GRADE)
  h.receiptIdForGrade.mockResolvedValue('rcpt_list')
  h.evaluateStoredTrade.mockResolvedValue({ ok: true, receipt: { receiptId: 'rcpt_review', assets: [], grade: ONE_GRADE } })
})

describe('the redraft proposal list', () => {
  it("badges each proposal with the ONE grade from the proposer's side, not the snapshot letter", async () => {
    const body = await (await listProposals(listReq())).json()
    expect(body.proposals[0].tradeGrade).toEqual({ grade: 'D', partnerGrade: 'B', gradeWithheld: null, receiptId: 'rcpt_list' })
    // The snapshot is still sent for its non-letter fields; the letter to show is `tradeGrade`.
    expect(body.proposals[0].valueSnapshot.grade).toBe('A+')
    expect(h.gradeDeal).toHaveBeenCalledWith(expect.anything(), {
      give: { assets: [{ kind: 'player', name: 'Star Runner' }], unpriceable: [] },
      get: { assets: [{ kind: 'pick', year: 2027, round: 1 }], unpriceable: [] },
      viewerSide: false,
    })
  })

  it('records the grade as a receipt linked to the proposal', async () => {
    await listProposals(listReq())
    expect(h.receiptIdForGrade).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'redraft-trade-list',
      grade: ONE_GRADE,
      stored: expect.objectContaining({ ref: { kind: 'redraft', proposalId: 'rp1' } }),
    }))
  })

  it('one grader for the whole list', async () => {
    h.proposalsFindMany.mockResolvedValue([PROPOSAL, { ...PROPOSAL, id: 'rp2' }, { ...PROPOSAL, id: 'rp3' }])
    await listProposals(listReq())
    expect(h.createGrader).toHaveBeenCalledTimes(1)
    expect(h.gradeDeal).toHaveBeenCalledTimes(3)
  })

  it('a grader failure is a withheld grade on that row, never the snapshot letter', async () => {
    h.gradeDeal.mockRejectedValue(new Error('boom'))
    const body = await (await listProposals(listReq())).json()
    expect(body.proposals[0].tradeGrade).toMatchObject({ grade: null, gradeWithheld: 'This trade could not be graded just now.' })
  })
})

describe('the commissioner review', () => {
  const review = async () =>
    (await commissionerReview({} as never, { params: Promise.resolve({ proposalId: 'rp1' }) })).json()

  it("shows the ONE grade from the proposer's side, and sends no snapshot letter at all", async () => {
    const body = await review()
    expect(h.evaluateStoredTrade).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: 'l1', ref: { kind: 'redraft', proposalId: 'rp1' }, userId: 'commish', surface: 'redraft-commissioner-review',
    }))
    expect(body.tradeGrade).toMatchObject({ grade: 'D', partnerGrade: 'B', evaluationReceiptId: 'rcpt_review' })
    expect(body.review.summary.grade).toBe('D')
    expect(body.snapshotSummary).not.toHaveProperty('grade')
    expect(JSON.stringify(body)).not.toContain('A+')
  })

  it('a refusal is a withheld grade with its reason', async () => {
    h.evaluateStoredTrade.mockResolvedValue({ ok: false, refusal: { code: 'asset_moved', reason: 'Star Runner is no longer on the roster sending him.' } })
    const body = await review()
    expect(body.tradeGrade).toMatchObject({ grade: null, gradeWithheld: 'Star Runner is no longer on the roster sending him.' })
    expect(body.review.summary.grade).toBeNull()
  })
})
