import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRecordLeaderboardMock = vi.fn()
const getRecordByIdInLeagueMock = vi.fn()
const resolveRecordExplanationMock = vi.fn()
const getServerSessionMock = vi.fn()
const runRecordBookEngineMock = vi.fn()
const assertLeagueMemberMock = vi.fn()

vi.mock('@/lib/record-book-engine/RecordLeaderboardService', () => ({
  getRecordLeaderboard: getRecordLeaderboardMock,
}))

vi.mock('@/lib/record-book-engine/RecordQueryService', () => ({
  getRecordByIdInLeague: getRecordByIdInLeagueMock,
  resolveRecordExplanation: resolveRecordExplanationMock,
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

vi.mock('@/lib/record-book-engine/RecordBookEngine', () => ({
  runRecordBookEngine: runRecordBookEngineMock,
}))

describe('Record book route contracts', () => {
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

  it('forwards leaderboard filters with normalized sport', async () => {
    getRecordLeaderboardMock.mockResolvedValue([])
    const { GET } = await import('@/app/api/leagues/[leagueId]/record-book/handler')
    const req = new Request(
      'http://localhost/api/leagues/lg-1/record-book?recordType=highest_score&season=2025&sport=nba&limit=15'
    )

    const res = await GET(req, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(res.status).toBe(200)
    expect(getRecordLeaderboardMock).toHaveBeenCalledWith({
      leagueId: 'lg-1',
      recordType: 'highest_score',
      season: '2025',
      sport: 'NBA',
      limit: 15,
    })
  })

  it('rejects invalid leaderboard filters', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/record-book/handler')

    const invalidTypeReq = new Request(
      'http://localhost/api/leagues/lg-1/record-book?recordType=not_real'
    )
    const invalidTypeRes = await GET(invalidTypeReq, {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(invalidTypeRes.status).toBe(400)
    await expect(invalidTypeRes.json()).resolves.toEqual({ error: 'Invalid recordType' })

    const invalidSportReq = new Request('http://localhost/api/leagues/lg-1/record-book?sport=bad')
    const invalidSportRes = await GET(invalidSportReq, {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(invalidSportRes.status).toBe(400)
    await expect(invalidSportRes.json()).resolves.toEqual({ error: 'Invalid sport' })
  })

  it('scopes detail lookup and explain by league', async () => {
    getRecordByIdInLeagueMock.mockResolvedValue({
      recordId: 'r-1',
      sport: 'NFL',
      leagueId: 'lg-1',
      recordType: 'highest_score',
      recordLabel: 'Highest Score',
      holderId: 'mgr-1',
      value: 201.4,
      season: '2025',
      createdAt: new Date(),
    })
    resolveRecordExplanationMock.mockResolvedValue('Highest Score (2025): mgr-1 set 201.4.')

    const detail = await import('@/app/api/leagues/[leagueId]/record-book/[recordId]/route')
    const detailReq = new Request('http://localhost/api/leagues/lg-1/record-book/r-1')
    const detailRes = await detail.GET(detailReq, {
      params: Promise.resolve({ leagueId: 'lg-1', recordId: 'r-1' }),
    })
    expect(detailRes.status).toBe(200)
    expect(getRecordByIdInLeagueMock).toHaveBeenCalledWith('lg-1', 'r-1')

    const explain = await import('@/app/api/leagues/[leagueId]/record-book/explain/route')
    const explainReq = new Request('http://localhost/api/leagues/lg-1/record-book/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId: 'r-1' }),
    })
    const explainRes = await explain.POST(explainReq, {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(explainRes.status).toBe(200)
    expect(getRecordByIdInLeagueMock).toHaveBeenCalledWith('lg-1', 'r-1')
    expect(resolveRecordExplanationMock).toHaveBeenCalled()
  })

  it('requires commissioner for run and normalizes run inputs', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/record-book/run/route')

    getServerSessionMock.mockResolvedValueOnce(null)
    const unauthReq = new Request('http://localhost/api/leagues/lg-1/record-book/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasons: ['2025'] }),
    })
    const unauthRes = await POST(unauthReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(unauthRes.status).toBe(401)

    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } })
    const memberReq = new Request('http://localhost/api/leagues/lg-1/record-book/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasons: ['2025'] }),
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
    runRecordBookEngineMock.mockResolvedValueOnce({
      leagueId: 'lg-1',
      seasonsProcessed: ['2025', 'all'],
      entriesCreated: 4,
      entriesUpdated: 2,
    })
    const req = new Request('http://localhost/api/leagues/lg-1/record-book/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasons: ['2025', '2025'], sport: 'nba' }),
    })
    const res = await POST(req, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(res.status).toBe(200)
    expect(runRecordBookEngineMock).toHaveBeenCalledWith('lg-1', ['2025'], { sport: 'NBA' })
  })
})
