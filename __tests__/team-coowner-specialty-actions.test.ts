import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  coOwner: vi.fn(), roster: vi.fn(), right: vi.fn(), commissioner: vi.fn(),
  eligibility: vi.fn(), promote: vi.fn(), requireDraft: vi.fn(), makePick: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'co-user' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { roster: { findFirst: h.roster }, devyRights: { findUnique: h.right } } }))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: h.coOwner }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: h.commissioner }))
vi.mock('@/lib/devy', () => ({ isDevyLeague: vi.fn(async () => true), getDevyConfig: vi.fn(), checkPromotionEligibility: h.eligibility, executePromotion: h.promote }))
vi.mock('@/lib/devy/lifecycle/DevyLifecycleAutomation', () => ({ getPromotionWindowStatus: vi.fn() }))
vi.mock('@/lib/league/dispersal-draft-route-helpers', () => ({ requireDispersalDraftForLeague: h.requireDraft }))
vi.mock('@/lib/dispersal-draft/DispersalDraftEngine', () => ({ DispersalDraftEngine: { makePick: h.makePick } }))
import { POST as promote } from '@/app/api/leagues/[leagueId]/devy/promotion/route'
import { POST as pass } from '@/app/api/leagues/[leagueId]/dispersal-draft/[draftId]/pass/route'

const req = (body: object) => new NextRequest('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
describe('co-owner specialty actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.roster.mockResolvedValue({ platformUserId: 'owner' })
    h.right.mockResolvedValue({ leagueId: 'league', rosterId: 'roster' })
    h.commissioner.mockResolvedValue(false)
    h.eligibility.mockResolvedValue({ canPromote: true })
    h.promote.mockResolvedValue({ ok: true })
    h.makePick.mockResolvedValue({})
  })
  it.each([['roster', 200], [null, 403], ['other', 403]])('limits promotion to the accepted roster (%s)', async (id, status) => {
    h.coOwner.mockResolvedValue(id)
    const result = await promote(req({ rightsId: 'right', promotedProPlayerId: 'player' }), { params: Promise.resolve({ leagueId: 'league' }) })
    expect(result.status).toBe(status)
    expect(h.promote).toHaveBeenCalledTimes(status === 200 ? 1 : 0)
  })
  it.each([['roster', 200], [null, 403], ['other', 403]])('limits dispersal passes to the accepted roster (%s)', async (id, status) => {
    h.coOwner.mockResolvedValue(id)
    const result = await pass(req({ rosterId: 'roster' }), { params: Promise.resolve({ leagueId: 'league', draftId: 'draft' }) })
    expect(result.status).toBe(status)
    expect(h.makePick).toHaveBeenCalledTimes(status === 200 ? 1 : 0)
  })
})
