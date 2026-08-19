/**
 * Beta guardrail: the redraft live-scoring route coerced `week` with raw
 * `Number(week)` (GET) and passed `body.week` straight into the scoring runtime
 * (POST). A malformed `week` (abc/2.5/0/negative) reached the scorer / Int
 * columns and could 500. The shared `parseOptionalRedraftPositiveInteger` guard
 * now rejects it with a clean 400 after auth but before any scoring work.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from './helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const assertLeagueCommissionerMock = vi.fn()
const resolveRuntimeMock = vi.fn()
const persistWeekMock = vi.fn()
const ingestMock = vi.fn()
const correctionMock = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { redraftSeason: { findUnique: vi.fn() } } }))
vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
  assertLeagueCommissioner: assertLeagueCommissionerMock,
}))
vi.mock('@/lib/scoring-runtime', () => ({
  applyNflRedraftStatCorrectionToSeason: correctionMock,
  ingestNflRedraftStatPayload: ingestMock,
  persistNflRedraftLiveScoringWeek: persistWeekMock,
  resolveNflRedraftLiveScoringRuntime: resolveRuntimeMock,
}))

const get = (qs: string) =>
  createMockNextRequest(`http://localhost/api/redraft/live-scoring${qs}`)
const post = (body: unknown) =>
  createMockNextRequest('http://localhost/api/redraft/live-scoring', { method: 'POST', body })

describe('redraft live-scoring route — week input guard (beta)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    assertLeagueMemberMock.mockResolvedValue({ ok: true, status: 200 })
    assertLeagueCommissionerMock.mockResolvedValue({ ok: true, status: 200 })
    resolveRuntimeMock.mockResolvedValue({ ok: true, state: { week: 5 } })
    persistWeekMock.mockResolvedValue({ state: {}, standings: {} })
  })

  it('GET rejects a non-numeric week with 400 before resolving the runtime', async () => {
    const { GET } = await import('@/app/api/redraft/live-scoring/route')
    const res = await GET(get('?leagueId=L&week=abc'))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
    expect(resolveRuntimeMock).not.toHaveBeenCalled()
  })

  it('GET rejects a fractional week with 400', async () => {
    const { GET } = await import('@/app/api/redraft/live-scoring/route')
    const res = await GET(get('?leagueId=L&week=2.5'))
    expect(res.status).toBe(400)
    expect(resolveRuntimeMock).not.toHaveBeenCalled()
  })

  it('GET accepts a valid week and passes the coerced integer to the runtime', async () => {
    const { GET } = await import('@/app/api/redraft/live-scoring/route')
    const res = await GET(get('?leagueId=L&week=5'))
    expect(res.status).toBe(200)
    expect(resolveRuntimeMock).toHaveBeenCalledTimes(1)
    expect(resolveRuntimeMock.mock.calls[0][0]).toMatchObject({ leagueId: 'L', week: 5 })
  })

  it('POST rejects a non-numeric week with 400 before persisting the week', async () => {
    const { POST } = await import('@/app/api/redraft/live-scoring/route')
    const res = await POST(post({ leagueId: 'L', action: 'recalculate_week', week: 'abc' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'week must be a positive integer' })
    expect(persistWeekMock).not.toHaveBeenCalled()
  })

  it('POST accepts a valid week and passes the coerced integer to the scorer', async () => {
    const { POST } = await import('@/app/api/redraft/live-scoring/route')
    const res = await POST(post({ leagueId: 'L', action: 'recalculate_week', week: 4 }))
    expect(res.status).toBe(200)
    expect(persistWeekMock).toHaveBeenCalledTimes(1)
    expect(persistWeekMock.mock.calls[0][0]).toMatchObject({ leagueId: 'L', week: 4 })
  })

  it('preserves 401 for unauthenticated GET requests', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const { GET } = await import('@/app/api/redraft/live-scoring/route')
    const res = await GET(get('?leagueId=L&week=abc'))
    expect(res.status).toBe(401)
  })
})
