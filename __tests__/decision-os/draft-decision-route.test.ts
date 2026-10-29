import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  canAccess: vi.fn(),
  viewerRoster: vi.fn(),
  snapshot: vi.fn(),
  context: vi.fn(),
  fit: vi.fn(),
  recommend: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: h.canAccess,
  getCurrentUserRosterIdForLeague: h.viewerRoster,
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: h.snapshot }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateRosterFitForDraftPick: h.fit }))
vi.mock('@/lib/shared-services/draft/DraftContextAssembler', () => ({ buildDraftDecisionContext: h.context }))
vi.mock('@/lib/draft-helper/RecommendationEngine', () => ({ computeDraftRecommendation: h.recommend }))

import { GET } from '@/app/api/leagues/[leagueId]/draft/decision/route'

const params = { params: Promise.resolve({ leagueId: 'lg1' }) }
const req = new Request('http://x/api/leagues/lg1/draft/decision') as never

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.canAccess.mockResolvedValue(true)
  h.viewerRoster.mockResolvedValue('me')
  h.snapshot.mockResolvedValue({
    id: 's1',
    status: 'in_progress',
    draftType: 'snake',
    rounds: 15,
    teamCount: 12,
    picks: [{ rosterId: 'me', playerName: 'Early Pick', position: 'QB' }],
    currentPick: { overall: 14, round: 2, slot: 2, rosterId: 'me', displayName: 'Me', pickLabel: '2.02' },
  })
  h.context.mockResolvedValue({
    sport: 'NFL',
    engineInput: { available: [], teamRoster: [], round: 2, pick: 14, totalTeams: 12, sport: 'NFL' },
    dataCompleteness: { availablePoolSize: 150, adpSampleTotal: 40, rosterPickCount: 1, unresolvedPlayerIdCount: 0 },
  })
  h.fit.mockResolvedValue({ valid: true })
  h.recommend.mockReturnValue({
    recommendation: {
      player: { name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 13 },
      reason: 'Best value.',
      confidence: 81,
      needScore: 70,
      adpEdge: 1,
      adpIsReal: true,
    },
    alternatives: [],
  })
})

describe('GET /api/leagues/[leagueId]/draft/decision', () => {
  it('returns the four-answer decision for the viewer’s roster', async () => {
    const res = await GET(req, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.decision).toMatchObject({
      decisionType: 'manager.draft.pick',
      forOverall: 14,
      fourAnswers: { what_to_do: 'Draft Atlas Runner.' },
      ruleVerdicts: [expect.objectContaining({ verdict: 'legal' })],
    })
    expect(h.context).toHaveBeenCalledWith({ leagueId: 'lg1', rosterId: 'me' })
    expect(h.fit).toHaveBeenCalledWith({
      leagueId: 'lg1',
      rosterId: 'me',
      existingPicks: [{ rosterId: 'me', position: 'QB' }],
      newPickPosition: 'RB',
    })
  })

  it('refuses signed-out and non-member callers', async () => {
    h.session.mockResolvedValueOnce(null)
    expect((await GET(req, params)).status).toBe(401)
    h.canAccess.mockResolvedValueOnce(false)
    expect((await GET(req, params)).status).toBe(403)
    expect(h.context).not.toHaveBeenCalled()
  })

  it('answers 409 with a reason when there is no pick decision to make', async () => {
    h.viewerRoster.mockResolvedValueOnce(null)
    const noRoster = await GET(req, params)
    expect(noRoster.status).toBe(409)
    expect((await noRoster.json()).reason).toBe('no_roster')

    h.snapshot.mockResolvedValueOnce({ draftType: 'auction', picks: [], currentPick: null })
    const auction = await GET(req, params)
    expect((await auction.json()).reason).toBe('auction_unsupported')

    h.snapshot.mockResolvedValueOnce(null)
    expect((await (await GET(req, params)).json()).reason).toBe('no_draft')

    h.context.mockRejectedValueOnce(new Error('Roster not found'))
    expect((await (await GET(req, params)).json()).reason).toBe('context_unavailable')
    expect(h.recommend).not.toHaveBeenCalled()
  })
})
