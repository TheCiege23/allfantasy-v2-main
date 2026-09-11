import { beforeEach, describe, expect, it, vi } from 'vitest'

const listArticlesMock = vi.fn()
const generateArticleMock = vi.fn()
const getArticleByIdMock = vi.fn()
const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()

vi.mock('@/lib/sports-media-engine', () => ({
  listArticles: listArticlesMock,
  generateArticle: generateArticleMock,
  getArticleById: getArticleByIdMock,
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

describe('Media route contracts', () => {
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

  it('forwards list filters and normalizes sport', async () => {
    listArticlesMock.mockResolvedValueOnce({ articles: [], nextCursor: undefined })
    const { GET } = await import('@/app/api/leagues/[leagueId]/media/handler')
    const req = new Request(
      'http://localhost/api/leagues/lg-1/media?sport=nba&tags=weekly_recap,power_rankings&limit=10&cursor=c-1'
    )
    const res = await GET(req, { params: Promise.resolve({ leagueId: 'lg-1' }) })

    expect(res.status).toBe(200)
    expect(listArticlesMock).toHaveBeenCalledWith({
      leagueId: 'lg-1',
      sport: 'NBA',
      tags: ['weekly_recap', 'power_rankings'],
      limit: 10,
      cursor: 'c-1',
    })
  })

  it('rejects invalid sport and invalid tags for list', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/media/handler')

    const badSportReq = new Request('http://localhost/api/leagues/lg-1/media?sport=bad')
    const badSportRes = await GET(badSportReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(badSportRes.status).toBe(400)
    await expect(badSportRes.json()).resolves.toEqual({ error: 'Invalid sport' })

    const mismatchReq = new Request('http://localhost/api/leagues/lg-1/media?sport=nfl')
    const mismatchRes = await GET(mismatchReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(mismatchRes.status).toBe(400)
    await expect(mismatchRes.json()).resolves.toEqual({ error: 'Sport must match league sport' })

    const badTagReq = new Request('http://localhost/api/leagues/lg-1/media?tags=weekly_recap,nope')
    const badTagRes = await GET(badTagReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(badTagRes.status).toBe(400)
    await expect(badTagRes.json()).resolves.toEqual({ error: 'Invalid tag: nope' })
  })

  it('requires auth, membership, and commissioner role for media generation', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/media/handler')

    getServerSessionMock.mockResolvedValueOnce(null)
    const unauthReq = new Request('http://localhost/api/leagues/lg-1/media', {
      method: 'POST',
      body: JSON.stringify({ type: 'weekly_recap' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const unauthRes = await POST(unauthReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(unauthRes.status).toBe(401)

    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-2' } })
    assertLeagueMemberMock.mockRejectedValueOnce(new Error('Forbidden'))
    const forbiddenReq = new Request('http://localhost/api/leagues/lg-1/media', {
      method: 'POST',
      body: JSON.stringify({ type: 'weekly_recap' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const forbiddenRes = await POST(forbiddenReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(forbiddenRes.status).toBe(403)
    await expect(forbiddenRes.json()).resolves.toEqual({ error: 'Forbidden' })

    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } })
    const memberReq = new Request('http://localhost/api/leagues/lg-1/media', {
      method: 'POST',
      body: JSON.stringify({ type: 'weekly_recap' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const memberRes = await POST(memberReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(memberRes.status).toBe(403)
    await expect(memberRes.json()).resolves.toEqual({ error: 'Forbidden: commissioner only' })
  })

  it('validates generate payload and forwards normalized values', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/media/handler')

    getServerSessionMock.mockResolvedValue({ user: { id: 'u-1' } })
    assertLeagueMemberMock.mockResolvedValueOnce({
      leagueId: 'lg-1',
      leagueSport: 'NBA',
      isCommissioner: true,
      isMember: true,
    })
    generateArticleMock.mockResolvedValueOnce({
      articleId: 'a-1',
      headline: 'Weekly Recap — League',
      tags: ['weekly_recap'],
    })

    const req = new Request('http://localhost/api/leagues/lg-1/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'weekly_recap',
        sport: 'nba',
        week: '8',
      }),
    })
    const res = await POST(req, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(res.status).toBe(200)
    expect(generateArticleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'lg-1',
        type: 'weekly_recap',
        sport: 'NBA',
        week: 8,
      })
    )

    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } })
    assertLeagueMemberMock.mockResolvedValueOnce({
      leagueId: 'lg-1',
      leagueSport: 'NBA',
      isCommissioner: true,
      isMember: true,
    })
    const badTypeReq = new Request('http://localhost/api/leagues/lg-1/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'bad_type' }),
    })
    const badTypeRes = await POST(badTypeReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(badTypeRes.status).toBe(400)

    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'u-1' } })
    assertLeagueMemberMock.mockResolvedValueOnce({
      leagueId: 'lg-1',
      leagueSport: 'NBA',
      isCommissioner: true,
      isMember: true,
    })
    const badSportReq = new Request('http://localhost/api/leagues/lg-1/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'weekly_recap', sport: 'bad' }),
    })
    const badSportRes = await POST(badSportReq, { params: Promise.resolve({ leagueId: 'lg-1' }) })
    expect(badSportRes.status).toBe(400)
    await expect(badSportRes.json()).resolves.toEqual({ error: 'Invalid sport' })
  })

  it('scopes article detail by league', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/media/[articleId]/route')
    getArticleByIdMock.mockResolvedValueOnce({
      id: 'a-1',
      leagueId: 'lg-1',
      sport: 'NBA',
      headline: 'Title',
      body: 'Body',
      tags: ['weekly_recap'],
      createdAt: new Date(),
    })

    const req = new Request('http://localhost/api/leagues/lg-1/media/a-1')
    const res = await GET(req, { params: Promise.resolve({ leagueId: 'lg-1', articleId: 'a-1' }) })
    expect(res.status).toBe(200)
    expect(getArticleByIdMock).toHaveBeenCalledWith('a-1', 'lg-1')

    getArticleByIdMock.mockResolvedValueOnce(null)
    const missingRes = await GET(req, {
      params: Promise.resolve({ leagueId: 'lg-1', articleId: 'missing' }),
    })
    expect(missingRes.status).toBe(404)
  })
})
