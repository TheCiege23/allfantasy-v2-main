import { beforeEach, describe, expect, it, vi } from 'vitest'

const listAwardsMock = vi.fn()
const getAwardByIdInLeagueMock = vi.fn()
const getSeasonsWithAwardsMock = vi.fn()
const resolveAwardExplanationMock = vi.fn()
const runAwardsEngineMock = vi.fn()
const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()

vi.mock('@/lib/awards-engine/AwardQueryService', () => ({
  listAwards: listAwardsMock,
  getAwardByIdInLeague: getAwardByIdInLeagueMock,
  getSeasonsWithAwards: getSeasonsWithAwardsMock,
  resolveAwardExplanation: resolveAwardExplanationMock,
}))

vi.mock('@/lib/awards-engine/AwardsEngine', () => ({
  runAwardsEngine: runAwardsEngineMock,
}))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
}))

describe('Awards route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1' } })
    assertLeagueMemberMock.mockResolvedValue({
      leagueId: 'lg-1',
      leagueSport: 'NBA',
      isCommissioner: false,
      isMember: true,
    })
  })

  it('forwards list filters and validates award type', async () => {
    listAwardsMock.mockResolvedValue([])
    const { GET } = await import('@/app/api/leagues/[leagueId]/awards/handler')
    const req = new Request(
      'http://localhost/api/leagues/lg-1/awards?season=2025&awardType=gm_of_the_year&limit=25'
    )

    const res = await GET(req, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(res.status).toBe(200)
    expect(listAwardsMock).toHaveBeenCalledWith({
      leagueId: 'lg-1',
      season: '2025',
      awardType: 'gm_of_the_year',
      limit: 25,
    })

    const invalidReq = new Request(
      'http://localhost/api/leagues/lg-1/awards?awardType=not_real'
    )
    const invalidRes = await GET(invalidReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(invalidRes.status).toBe(400)
    await expect(invalidRes.json()).resolves.toEqual({ error: 'Invalid awardType' })
  })

  it('scopes award detail lookup by league id', async () => {
    getAwardByIdInLeagueMock.mockResolvedValue({
      awardId: 'a-1',
      leagueId: 'lg-1',
      sport: 'NFL',
      season: '2025',
      awardType: 'gm_of_the_year',
      awardLabel: 'GM of the Year',
      managerId: 'mgr-1',
      score: 99.1,
      createdAt: new Date(),
    })
    const { GET } = await import('@/app/api/leagues/[leagueId]/awards/[awardId]/route')
    const req = new Request('http://localhost/api/leagues/lg-1/awards/a-1')

    const res = await GET(req, { params: Promise.resolve({ leagueId: 'lg-1', awardId: 'a-1' }) })
    expect(res.status).toBe(200)
    expect(getAwardByIdInLeagueMock).toHaveBeenCalledWith('lg-1', 'a-1')
  })

  it('rejects explain requests with unknown award type', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/awards/explain/route')
    const req = new Request('http://localhost/api/leagues/lg-1/awards/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season: '2025', awardType: 'bad_type' }),
    })

    const res = await POST(req, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid awardType' })
  })

  it('requires commissioner for running awards and normalizes sport', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/awards/run/route')

    getServerSessionMock.mockResolvedValueOnce(null)
    const unauthReq = new Request('http://localhost/api/leagues/lg-1/awards/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season: '2025' }),
    })
    const unauthRes = await POST(unauthReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(unauthRes.status).toBe(401)

    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } })
    const memberReq = new Request('http://localhost/api/leagues/lg-1/awards/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season: '2025' }),
    })
    const memberRes = await POST(memberReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(memberRes.status).toBe(403)
    await expect(memberRes.json()).resolves.toEqual({ error: 'Forbidden: commissioner only' })

    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } })
    assertLeagueMemberMock.mockResolvedValueOnce({
      leagueId: 'lg-1',
      leagueSport: 'NBA',
      isCommissioner: true,
      isMember: true,
    })
    runAwardsEngineMock.mockResolvedValueOnce({
      leagueId: 'lg-1',
      season: '2025',
      sport: 'NBA',
      awardsCreated: 8,
      awardTypes: ['gm_of_the_year'],
    })
    const req = new Request('http://localhost/api/leagues/lg-1/awards/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season: '2025', sport: 'nba' }),
    })

    const res = await POST(req, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(res.status).toBe(200)
    expect(runAwardsEngineMock).toHaveBeenCalledWith('lg-1', '2025', { sport: 'NBA' })
  })
})
