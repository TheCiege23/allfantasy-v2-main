/**
 * Commissioner review mode (design step 6): the review route, and the decision routes that log which
 * review a commissioner was shown. The app advises; it never approves, rejects or vetoes on its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  session: vi.fn(),
  role: vi.fn(),
  rate: vi.fn(),
  review: vi.fn(),
  explain: vi.fn(),
  decide: vi.fn(),
  member: vi.fn(),
  proposalFind: vi.fn(),
  proposalUpdate: vi.fn(),
  decisionFind: vi.fn(),
  decisionCreate: vi.fn(),
  decisionUpdate: vi.fn(),
  leagueFind: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: h.role,
  isCommissionerRole: (r: unknown) => r === 'commissioner' || r === 'co_commissioner',
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rate }))
vi.mock('@/lib/decision-os/trade/tradeReviewContext', () => ({ reviewStoredTrade: h.review }))
vi.mock('@/lib/decision-os/trade/explainTrade', () => ({ explainTrade: h.explain }))
vi.mock('@/lib/league-trade-engine/tradeService', () => ({ commissionerAfTradeDecision: h.decide }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: h.member }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftTradeProposal: { findUnique: h.proposalFind, update: h.proposalUpdate },
    redraftTradeDecision: { findFirst: h.decisionFind, create: h.decisionCreate, update: h.decisionUpdate },
    league: { findFirst: h.leagueFind },
    redraftRoster: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/ai-learning-system/recordTradeParticipants', () => ({ recordTradeOutcomeForBothManagers: vi.fn() }))
vi.mock('@/lib/trade-market/redraftTradeMarketEvents', () => ({ recordRedraftTradeMarketEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ queueTradeStatusInDm: vi.fn() }))

import { GET as review } from '@/app/api/leagues/[leagueId]/trades/[tradeId]/review/route'
import { POST as nativeDecision } from '@/app/api/leagues/[leagueId]/trades/[tradeId]/commissioner/route'
import { POST as redraftVeto } from '@/app/api/redraft/trades/veto/route'

const REVIEW = {
  model: 'trade-review-v1',
  recommendation: 'consider_veto',
  flags: [{ code: 'heavily_lopsided', severity: 'high', explanation: 'Bravo receives 48% more league value.' }],
  checks: [],
}
const OK = {
  ok: true,
  review: REVIEW,
  sideNames: ['Alpha', 'Bravo'],
  receipt: { receiptId: 'rcpt_1', grade: { graded: true, letter: 'F', partnerLetter: 'A', percentDiff: -48, giveValue: 6000, getValue: 3100, label: 'x', recommendation: 'y' }, assets: [] },
  trade: { origin: { source: 'af', platform: 'allfantasy', deepLink: null } },
}

const get = (qs: string) =>
  review(new NextRequest(`http://localhost/api/leagues/L1/trades/t1/review?${qs}`), { params: Promise.resolve({ leagueId: 'L1', tradeId: 't1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'commish' } })
  h.role.mockResolvedValue('commissioner')
  h.rate.mockReturnValue({ success: true })
  h.review.mockResolvedValue(OK)
  h.explain.mockResolvedValue({ source: 'template', verdict: { headline: 'h', commissioner: { recommendation: 'consider_veto', flags: [], noteToLeague: 'Flagged for the commissioner: a heavily lopsided value gap.' } } })
  h.member.mockResolvedValue({ ok: true })
})

describe('GET …/trades/{id}/review', () => {
  it('only a commissioner or co-commissioner may review', async () => {
    h.role.mockResolvedValue('member')
    expect((await get('kind=af')).status).toBe(403)
    h.role.mockResolvedValue('co_commissioner')
    expect((await get('kind=af')).status).toBe(200)
    expect(h.review).toHaveBeenCalledTimes(1)
  })

  it('401 without a session, 400 without a kind', async () => {
    h.session.mockResolvedValue(null)
    expect((await get('kind=af')).status).toBe(401)
    h.session.mockResolvedValue({ user: { id: 'commish' } })
    expect((await get('kind=nope')).status).toBe(400)
  })

  it.each([
    ['af', { kind: 'af', tradeId: 't1' }],
    ['redraft', { kind: 'redraft', proposalId: 't1' }],
    ['provider', { kind: 'provider', provider: 'sleeper', providerTradeId: 't1' }],
  ])('kind=%s reviews the right trade', async (kind, ref) => {
    await get(`kind=${kind}`)
    expect(h.review).toHaveBeenCalledWith({ leagueId: 'L1', ref, userId: 'commish' })
  })

  it('returns the review, the one grade and the receipt it rests on', async () => {
    const body = await (await get('kind=af')).json()
    expect(body).toMatchObject({
      review: REVIEW,
      sides: ['Alpha', 'Bravo'],
      reviewId: 'rcpt_1',
      tradeGrade: { grade: 'F', partnerGrade: 'A' },
      explanation: { noteToLeague: 'Flagged for the commissioner: a heavily lopsided value gap.', source: 'template' },
      actOn: null,
    })
  })

  it('makes no model call unless explain=1 — and then explains THIS review', async () => {
    await get('kind=af')
    expect(h.explain.mock.calls[0]![1].spendEnabled()).toBe(false)
    await get('kind=af&explain=1')
    expect(h.explain.mock.calls[1]![1]).toEqual({})
    expect(h.explain.mock.calls[1]![0]).toMatchObject({ commissionerReview: REVIEW, teamNames: { teamA: 'Alpha', teamB: 'Bravo' } })
  })

  it('an imported trade is decided on its platform, and the review says so', async () => {
    h.review.mockResolvedValue({ ...OK, trade: { origin: { source: 'provider', platform: 'sleeper', deepLink: 'https://sleeper.com/leagues/1' } } })
    const body = await (await get('kind=provider')).json()
    expect(body.actOn).toEqual({ platform: 'sleeper', deepLink: 'https://sleeper.com/leagues/1', note: 'Approve or veto this trade on sleeper.' })
  })

  it('maps a refusal to its status', async () => {
    h.review.mockResolvedValue({ ok: false, refusal: { code: 'not_found', reason: 'That trade could not be found in this league.' } })
    const res = await get('kind=af')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'That trade could not be found in this league.' })
  })

  it('reads only — it never records a decision', async () => {
    await get('kind=af&explain=1')
    expect(h.decide).not.toHaveBeenCalled()
  })
})

describe('decisions log the review they were made with', () => {
  const post = (body: unknown) =>
    nativeDecision(
      new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }),
      { params: Promise.resolve({ leagueId: 'L1', tradeId: 't1' }) },
    )

  it('native approve/reject forwards the review id', async () => {
    await post({ decision: 'reject', reviewId: 'rcpt_1' })
    expect(h.decide).toHaveBeenCalledWith({ tradeId: 't1', leagueId: 'L1', userId: 'commish', decision: 'reject', reviewId: 'rcpt_1' })
  })

  it('an id that does not look like one is dropped, and the decision still goes through', async () => {
    await post({ decision: 'approve', reviewId: '<script>' })
    expect(h.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: 'approve', reviewId: null }))
    await post({ decision: 'approve' })
    expect(h.decide).toHaveBeenLastCalledWith(expect.objectContaining({ reviewId: null }))
  })

  it('a redraft veto records the review on its decision', async () => {
    h.proposalFind.mockResolvedValue({ id: 'rp1', leagueId: 'L1', seasonId: 's1', status: 'pending', proposerRosterId: 'a', receiverRosterId: 'b', assets: [] })
    h.leagueFind.mockResolvedValue({ userId: 'commish', teams: [] })
    h.proposalUpdate.mockResolvedValue({ id: 'rp1', status: 'vetoed' })
    h.decisionFind.mockResolvedValue(null)
    const res = await redraftVeto(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ proposalId: 'rp1', reviewId: 'rcpt_9' }) }))
    expect(res.status).toBeLessThan(300)
    expect(h.decisionCreate.mock.calls[0]![0].data.snapshot).toEqual({ reviewId: 'rcpt_9' })
  })

  it('an existing redraft decision keeps its snapshot and gains the review', async () => {
    h.proposalFind.mockResolvedValue({ id: 'rp1', leagueId: 'L1', seasonId: 's1', status: 'pending', proposerRosterId: 'a', receiverRosterId: 'b', assets: [] })
    h.leagueFind.mockResolvedValue({ userId: 'commish', teams: [] })
    h.proposalUpdate.mockResolvedValue({ id: 'rp1', status: 'vetoed' })
    h.decisionFind.mockResolvedValue({ proposalId: 'rp1', snapshot: { earlier: true } })
    await redraftVeto(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ proposalId: 'rp1', reviewId: 'rcpt_9' }) }))
    expect(h.decisionUpdate.mock.calls[0]![0].data.snapshot).toEqual({ earlier: true, reviewId: 'rcpt_9' })
  })
})
