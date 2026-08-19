import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getLeagueRole: vi.fn(),
  requireAdmin: vi.fn(),
  resolveLeagueFinancialContext: vi.fn(),
  persistLeagueFinancialConfirmation: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: mocks.getLeagueRole }))
vi.mock('@/lib/adminAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/decision-os/leagueContext', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/leagueContext')>(
    '@/lib/decision-os/leagueContext',
  )
  return {
    ...actual,
    resolveLeagueFinancialContext: mocks.resolveLeagueFinancialContext,
    persistLeagueFinancialConfirmation: mocks.persistLeagueFinancialConfirmation,
  }
})

function getReq(url: string) {
  return new Request(url)
}
function postReq(url: string, body: unknown) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

describe('GET /api/decision-os/league-context', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('denies an unauthenticated caller with 401', async () => {
    mocks.getServerSession.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/decision-os/league-context/route')
    const res = await GET(getReq('http://localhost/api/decision-os/league-context?leagueId=league-1'))
    expect(res.status).toBe(401)
    expect(mocks.resolveLeagueFinancialContext).not.toHaveBeenCalled()
  })

  it('refuses a missing leagueId with 400', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    const { GET } = await import('@/app/api/decision-os/league-context/route')
    const res = await GET(getReq('http://localhost/api/decision-os/league-context'))
    expect(res.status).toBe(400)
  })

  // Phase OS-C6.1: real per-league membership authorization coverage — this used to be "any
  // authenticated caller, no per-league role check"; that was the exact gap the production-readiness
  // audit found and this phase closed. `authorizeLeagueRead` reuses `getLeagueRole` (already mocked
  // above for the POST tests), so no separate mock is needed here.
  it('allows the league commissioner to read', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'commish-1' } })
    mocks.getLeagueRole.mockResolvedValueOnce('commissioner')
    mocks.resolveLeagueFinancialContext.mockResolvedValueOnce({ leagueId: 'league-1', financialStatus: 'UNKNOWN' })
    const { GET } = await import('@/app/api/decision-os/league-context/route')
    const res = await GET(getReq('http://localhost/api/decision-os/league-context?leagueId=league-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.financialStatus).toBe('UNKNOWN')
    expect(mocks.getLeagueRole).toHaveBeenCalledWith('league-1', 'commish-1')
  })

  it('allows a real league member to read', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'member-1' } })
    mocks.getLeagueRole.mockResolvedValueOnce('member')
    mocks.resolveLeagueFinancialContext.mockResolvedValueOnce({ leagueId: 'league-1', financialStatus: 'PAID' })
    const { GET } = await import('@/app/api/decision-os/league-context/route')
    const res = await GET(getReq('http://localhost/api/decision-os/league-context?leagueId=league-1'))
    expect(res.status).toBe(200)
  })

  it('denies an authenticated user with no relationship to the league (403) — this is the real financial-data leak the audit found', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'stranger-1' } })
    mocks.getLeagueRole.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/decision-os/league-context/route')
    const res = await GET(getReq('http://localhost/api/decision-os/league-context?leagueId=league-1'))
    expect(res.status).toBe(403)
    expect(mocks.resolveLeagueFinancialContext).not.toHaveBeenCalled()
  })
})

describe('POST /api/decision-os/league-context', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ ok: false, res: Response.json({ error: 'Forbidden' }, { status: 403 }) })
  })

  it('denies an unauthenticated caller with 401', async () => {
    mocks.getServerSession.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/decision-os/league-context/route')
    const res = await POST(postReq('http://localhost/api/decision-os/league-context', { leagueId: 'league-1', action: 'confirm_free' }))
    expect(res.status).toBe(401)
  })

  it('refuses an invalid action with 400', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'user-1' } })
    const { POST } = await import('@/app/api/decision-os/league-context/route')
    const res = await POST(postReq('http://localhost/api/decision-os/league-context', { leagueId: 'league-1', action: 'nonsense' }))
    expect(res.status).toBe(400)
  })

  it('denies a plain member (403) — a normal member cannot mutate league context', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'member-1' } })
    mocks.getLeagueRole.mockResolvedValueOnce('member')
    const { POST } = await import('@/app/api/decision-os/league-context/route')
    const res = await POST(postReq('http://localhost/api/decision-os/league-context', { leagueId: 'league-1', action: 'confirm_paid' }))
    expect(res.status).toBe(403)
    expect(mocks.persistLeagueFinancialConfirmation).not.toHaveBeenCalled()
  })

  it('allows the league commissioner to confirm FREE', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'commish-1' } })
    mocks.getLeagueRole.mockResolvedValueOnce('commissioner')
    mocks.persistLeagueFinancialConfirmation.mockResolvedValueOnce({ leagueId: 'league-1', financialStatus: 'FREE' })
    const { POST } = await import('@/app/api/decision-os/league-context/route')
    const res = await POST(postReq('http://localhost/api/decision-os/league-context', { leagueId: 'league-1', action: 'confirm_free' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.financialStatus).toBe('FREE')
    expect(mocks.persistLeagueFinancialConfirmation).toHaveBeenCalledWith(
      'league-1',
      expect.objectContaining({ type: 'confirm', input: expect.objectContaining({ financialStatus: 'FREE' }) }),
    )
  })

  it('allows the league commissioner to confirm PAID with a buy-in amount', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'commish-1' } })
    mocks.getLeagueRole.mockResolvedValueOnce('commissioner')
    mocks.persistLeagueFinancialConfirmation.mockResolvedValueOnce({
      leagueId: 'league-1',
      financialStatus: 'PAID',
      buyInAmount: 50,
    })
    const { POST } = await import('@/app/api/decision-os/league-context/route')
    const res = await POST(
      postReq('http://localhost/api/decision-os/league-context', {
        leagueId: 'league-1',
        action: 'confirm_paid',
        buyInAmount: 50,
        buyInCurrency: 'usd',
      }),
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.financialStatus).toBe('PAID')
    expect(mocks.persistLeagueFinancialConfirmation).toHaveBeenCalledWith(
      'league-1',
      expect.objectContaining({
        type: 'confirm',
        input: expect.objectContaining({ financialStatus: 'PAID', buyInAmount: 50, buyInCurrency: 'usd' }),
      }),
    )
  })

  it('allows a co-commissioner to reset to UNKNOWN', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'coco-1' } })
    mocks.getLeagueRole.mockResolvedValueOnce('co_commissioner')
    mocks.persistLeagueFinancialConfirmation.mockResolvedValueOnce({ leagueId: 'league-1', financialStatus: 'UNKNOWN' })
    const { POST } = await import('@/app/api/decision-os/league-context/route')
    const res = await POST(postReq('http://localhost/api/decision-os/league-context', { leagueId: 'league-1', action: 'reset' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.financialStatus).toBe('UNKNOWN')
    expect(mocks.persistLeagueFinancialConfirmation).toHaveBeenCalledWith('league-1', { type: 'reset' })
  })

  it('allows a site admin to mutate even without a league relationship', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'admin-1' } })
    mocks.getLeagueRole.mockResolvedValueOnce(null)
    mocks.requireAdmin.mockResolvedValueOnce({ ok: true, user: { id: 'admin-1', role: 'admin' } })
    mocks.persistLeagueFinancialConfirmation.mockResolvedValueOnce({ leagueId: 'league-1', financialStatus: 'FREE' })
    const { POST } = await import('@/app/api/decision-os/league-context/route')
    const res = await POST(postReq('http://localhost/api/decision-os/league-context', { leagueId: 'league-1', action: 'confirm_free' }))
    expect(res.status).toBe(200)
    expect(mocks.persistLeagueFinancialConfirmation).toHaveBeenCalled()
  })

  it('returns 503 (not a false success) when the context store is unavailable', async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: 'commish-1' } })
    mocks.getLeagueRole.mockResolvedValueOnce('commissioner')
    const { LeagueContextStoreUnavailableError } = await import('@/lib/decision-os/leagueContext')
    mocks.persistLeagueFinancialConfirmation.mockRejectedValueOnce(new LeagueContextStoreUnavailableError())
    const { POST } = await import('@/app/api/decision-os/league-context/route')
    const res = await POST(postReq('http://localhost/api/decision-os/league-context', { leagueId: 'league-1', action: 'confirm_free' }))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.error).toBe('context_store_unavailable')
  })
})
