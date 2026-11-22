import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const resolveLeagueAccessMock = vi.fn()
const createPredictionPollMock = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: resolveLeagueAccessMock }))
vi.mock('@/lib/league-chat/predictionPolls', () => ({
  createPredictionPoll: createPredictionPollMock,
  listPredictableMatchups: vi.fn(async () => ({ native: false, season: null, week: null, matchups: [] })),
  loadPredictionLeaderboard: vi.fn(),
  resolvePredictionPollsForLeague: vi.fn(),
}))

const HANDLER = '../../app/api/leagues/[leagueId]/predictions/handler'
const ctx = { params: Promise.resolve({ leagueId: 'l1' }) }
const post = (body: unknown) =>
  new Request('http://localhost/p', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
  resolveLeagueAccessMock.mockResolvedValue({ leagueId: 'l1', isCommissioner: false })
})

describe('/api/leagues/[leagueId]/predictions', () => {
  it('refuses a non-member on both methods', async () => {
    const { GET, POST } = await import(HANDLER)
    resolveLeagueAccessMock.mockResolvedValue(null)
    expect((await GET(new Request('http://localhost/p'), ctx)).status).toBe(403)
    expect((await POST(post({ matchupId: 'mu1' }), ctx)).status).toBe(403)
    expect(createPredictionPollMock).not.toHaveBeenCalled()
  })

  it('says native:false for an imported league instead of an empty board', async () => {
    const { GET } = await import(HANDLER)
    const res = await GET(new Request('http://localhost/p'), ctx)
    expect(await res.json()).toMatchObject({ native: false, leaderboard: [] })
  })

  it('lets any member post, and maps a refusal to its status', async () => {
    const { POST } = await import(HANDLER)
    createPredictionPollMock.mockResolvedValueOnce({ ok: true, messageId: 'predpoll_mu1', created: true })
    expect((await POST(post({ matchupId: 'mu1', resultsVisibility: 'after_close' }), ctx)).status).toBe(200)
    expect(createPredictionPollMock.mock.calls[0][0]).toMatchObject({ authorUserId: 'u1', resultsVisibility: 'after_close' })
    createPredictionPollMock.mockResolvedValueOnce({ ok: false, code: 'kicked_off' })
    expect((await POST(post({ matchupId: 'mu1' }), ctx)).status).toBe(409)
  })
})
