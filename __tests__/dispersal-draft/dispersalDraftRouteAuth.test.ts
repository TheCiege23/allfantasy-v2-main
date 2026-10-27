/**
 * POST/PATCH /api/leagues/[leagueId]/dispersal-draft/[draftId]: a named roster must be the caller's own, and any
 * member may nudge an expired pick (the server checks the expiry).
 *
 * 🛑 POST took `body.rosterId` as given, so any member of the league could pick, pass or auto-pick for another team.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  canAccess: vi.fn(),
  canSubmit: vi.fn(),
  ownRoster: vi.fn(),
  makePick: vi.fn(),
  autoPick: vi.fn(),
  advanceExpired: vi.fn(),
  getState: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { dispersalDraft: { update: vi.fn() } } }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: m.canAccess, canSubmitDispersalPickForUser: m.canSubmit }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn() }))
vi.mock('@/lib/league/dispersal-draft-route-helpers', () => ({
  getRosterIdForLeagueUser: m.ownRoster,
  requireDispersalDraftForLeague: vi.fn(async () => ({ id: 'd1' })),
}))
vi.mock('@/lib/dispersal-draft/dispersal-draft-detail', () => ({ getDispersalDraftDetail: vi.fn(async () => ({ detail: true })) }))
vi.mock('@/lib/subscription/requireEntitlement', () => ({ requireEntitlement: vi.fn() }))
vi.mock('@/lib/dispersal-draft/DispersalDraftEngine', () => ({
  DispersalDraftEngine: {
    makePick: m.makePick,
    advancePickOnTimeout: m.autoPick,
    advanceExpiredPick: m.advanceExpired,
    getDraftState: m.getState,
  },
}))

const ctx = { params: Promise.resolve({ leagueId: 'L', draftId: 'd1' }) }
const req = (method: 'POST' | 'PATCH', body: unknown) =>
  new Request('http://localhost/api/leagues/L/dispersal-draft/d1', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'u-me' } })
  m.canAccess.mockResolvedValue(true)
  m.ownRoster.mockResolvedValue('r-me')
  m.canSubmit.mockImplementation(async (_l: string, _u: string, rosterId: string) => rosterId === 'r-me')
  m.makePick.mockResolvedValue({ id: 'd1', picked: true })
  m.autoPick.mockResolvedValue({ id: 'd1', auto: true })
  m.getState.mockResolvedValue({ id: 'd1', unchanged: true })
})

describe('POST: a named roster must be the caller’s own', () => {
  it.each(['make_pick', 'pass', 'auto_pick'])('🛑 %s for another team is refused, and nothing is written', async (action) => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/dispersal-draft/[draftId]/route')
    const res = await POST(req('POST', { action, rosterId: 'r-someone-else', assetId: 'a1' }), ctx)
    expect(res.status).toBe(403)
    expect(m.makePick).not.toHaveBeenCalled()
    expect(m.autoPick).not.toHaveBeenCalled()
  })

  it('the caller’s own team, named or not, still picks', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/dispersal-draft/[draftId]/route')
    expect((await POST(req('POST', { action: 'make_pick', assetId: 'a1' }), ctx)).status).toBe(200)
    expect((await POST(req('POST', { action: 'make_pick', rosterId: 'r-me', assetId: 'a1' }), ctx)).status).toBe(200)
    expect(m.makePick).toHaveBeenCalledTimes(2)
    expect(m.makePick).toHaveBeenCalledWith('d1', 'r-me', 'a1', { isAutoPick: false })
    // Its own team needs no second check: the claim lookup already resolved it.
    expect(m.canSubmit).not.toHaveBeenCalled()
  })
})

describe('advance_expired: any member may nudge an expired pick', () => {
  it('PATCH asks the engine, which reads the expiry itself', async () => {
    m.advanceExpired.mockResolvedValue({ id: 'd1', advanced: true })
    const { PATCH } = await import('@/app/api/leagues/[leagueId]/dispersal-draft/[draftId]/route')
    const res = await PATCH(req('PATCH', { action: 'advance_expired' }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: { id: 'd1', advanced: true }, detail: { detail: true } })
    expect(m.advanceExpired).toHaveBeenCalledWith('d1')
  })

  it('nothing to advance: the draft comes back as it is', async () => {
    m.advanceExpired.mockResolvedValue(null)
    const { POST } = await import('@/app/api/leagues/[leagueId]/dispersal-draft/[draftId]/route')
    const res = await POST(req('POST', { action: 'advance_expired' }), ctx)
    expect(await res.json()).toEqual({ id: 'd1', unchanged: true })
  })

  it('a non-member cannot ask', async () => {
    m.canAccess.mockResolvedValue(false)
    const { PATCH } = await import('@/app/api/leagues/[leagueId]/dispersal-draft/[draftId]/route')
    expect((await PATCH(req('PATCH', { action: 'advance_expired' }), ctx)).status).toBe(403)
    expect(m.advanceExpired).not.toHaveBeenCalled()
  })
})
