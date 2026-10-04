import { beforeEach, describe, expect, it, vi } from 'vitest'

const listCommentaryMock = vi.fn()
const generateCommentaryMock = vi.fn()
const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()

vi.mock('@/lib/commentary-engine', () => ({
  listCommentary: listCommentaryMock,
  generateCommentary: generateCommentaryMock,
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

describe('Commentary route contracts', () => {
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

  it('enforces auth/membership and validates list filters', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/commentary/handler')

    getServerSessionMock.mockResolvedValueOnce(null)
    const unauthReq = new Request('http://localhost/api/leagues/lg-1/commentary')
    const unauthRes = await GET(unauthReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(unauthRes.status).toBe(401)

    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-2' } })
    assertLeagueMemberMock.mockRejectedValueOnce(new Error('Forbidden'))
    const forbiddenReq = new Request('http://localhost/api/leagues/lg-1/commentary')
    const forbiddenRes = await GET(forbiddenReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(forbiddenRes.status).toBe(403)
    await expect(forbiddenRes.json()).resolves.toEqual({ error: 'Forbidden' })

    const badReq = new Request('http://localhost/api/leagues/lg-1/commentary?eventType=bad')
    const badRes = await GET(badReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(badRes.status).toBe(400)
    await expect(badRes.json()).resolves.toEqual({ error: 'Invalid eventType' })
  })

  it('forwards normalized list query params', async () => {
    listCommentaryMock.mockResolvedValueOnce({ entries: [], nextCursor: 'c-2' })
    const { GET } = await import('@/app/api/leagues/[leagueId]/commentary/handler')
    const req = new Request(
      'http://localhost/api/leagues/lg-1/commentary?eventType=matchup_commentary&limit=99&cursor=c-1'
    )
    const res = await GET(req, { params: Promise.resolve({ leagueId: 'lg-1' }) })

    expect(res.status).toBe(200)
    expect(listCommentaryMock).toHaveBeenCalledWith({
      leagueId: 'lg-1',
      eventType: 'matchup_commentary',
      limit: 50,
      cursor: 'c-1',
    })
  })

  it('requires commissioner role for commentary generation', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/commentary/generate/route')
    const req = new Request('http://localhost/api/leagues/lg-1/commentary/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'matchup_commentary',
        teamAName: 'A',
        teamBName: 'B',
        scoreA: 10,
        scoreB: 9,
      }),
    })
    const res = await POST(req, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden: commissioner only' })
  })

  it('validates generate payload and forwards normalized context', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/commentary/generate/route')

    assertLeagueMemberMock.mockResolvedValueOnce({
      leagueId: 'lg-1',
      leagueSport: 'NBA',
      isCommissioner: true,
      isMember: true,
    })
    const invalidSportReq = new Request('http://localhost/api/leagues/lg-1/commentary/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'trade_reaction',
        sport: 'NFL',
        managerA: 'A',
        managerB: 'B',
        summary: 'Blockbuster.',
      }),
    })
    const invalidSportRes = await POST(invalidSportReq, {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(invalidSportRes.status).toBe(400)
    await expect(invalidSportRes.json()).resolves.toEqual({ error: 'Invalid sport' })

    assertLeagueMemberMock.mockResolvedValueOnce({
      leagueId: 'lg-1',
      leagueSport: 'NBA',
      isCommissioner: true,
      isMember: true,
    })
    const invalidPayloadReq = new Request('http://localhost/api/leagues/lg-1/commentary/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'matchup_commentary',
        teamAName: '',
        teamBName: 'B',
        scoreA: 'nope',
        scoreB: 9,
      }),
    })
    const invalidPayloadRes = await POST(invalidPayloadReq, {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })
    expect(invalidPayloadRes.status).toBe(400)
    await expect(invalidPayloadRes.json()).resolves.toEqual({ error: 'Invalid matchup payload' })

    assertLeagueMemberMock.mockResolvedValueOnce({
      leagueId: 'lg-1',
      leagueSport: 'NBA',
      isCommissioner: true,
      isMember: true,
    })
    generateCommentaryMock.mockResolvedValueOnce({
      headline: 'Final Minute Frenzy',
      body: 'Team A clings to the lead.',
    })
    const req = new Request('http://localhost/api/leagues/lg-1/commentary/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'matchup_commentary',
        sport: 'nba',
        teamAName: 'Team A',
        teamBName: 'Team B',
        scoreA: 101.5,
        scoreB: 98.2,
        week: '8',
        season: 2026,
        skipStats: true,
        persist: false,
      }),
    })
    const res = await POST(req, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(res.status).toBe(200)
    expect(generateCommentaryMock).toHaveBeenCalledWith(
      {
        leagueId: 'lg-1',
        sport: 'NBA',
        leagueName: undefined,
        eventType: 'matchup_commentary',
        teamAName: 'Team A',
        teamBName: 'Team B',
        scoreA: 101.5,
        scoreB: 98.2,
        week: 8,
        season: 2026,
        situation: undefined,
      },
      { skipStatisticalContext: true, persist: false }
    )
  })
})
