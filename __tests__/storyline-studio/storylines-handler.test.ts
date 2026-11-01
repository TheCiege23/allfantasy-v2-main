import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const getLeagueRoleMock = vi.fn()
const entitledMock = vi.fn()
const readStudioViewMock = vi.fn()
const saveMock = vi.fn()
const postMock = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: getLeagueRoleMock }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: vi.fn(async () => ({ platform: 'sleeper' })) } } }))
vi.mock('@/lib/storyline-studio/storylineService', () => ({
  storylineEntitled: entitledMock,
  storylineUpgradePath: vi.fn(async () => '/pricing?plan=commissioner'),
  readStudioView: readStudioViewMock,
  saveStudioSettings: saveMock,
  postStoryline: postMock,
}))

const HANDLER = '../../app/api/leagues/[leagueId]/storylines/handler'
const ctx = { params: Promise.resolve({ leagueId: 'l1' }) }
const req = (method: string, body?: unknown) =>
  new Request('http://localhost/s?lang=en', { method, ...(body ? { body: JSON.stringify(body) } : {}) })

const HOOK = { id: 'rivalry_record:1|2:2-1', text: 'Hawks lead.', facts: [], matchup: { a: '1', b: '2', matchupId: 'mu1' } }

beforeEach(() => {
  vi.clearAllMocks()
  getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
  getLeagueRoleMock.mockResolvedValue('commissioner')
  entitledMock.mockResolvedValue(true)
})

describe('/api/leagues/[leagueId]/storylines', () => {
  it('a non-subscriber gets the upsell and no hooks; writes are 402', async () => {
    const { GET, POST } = await import(HANDLER)
    entitledMock.mockResolvedValue(false)
    const body = await (await GET(req('GET'), ctx)).json()
    expect(body).toMatchObject({ entitled: false, upgradePath: '/pricing?plan=commissioner' })
    expect(body.hooks).toBeUndefined()
    expect(readStudioViewMock).not.toHaveBeenCalled()
    expect((await POST(req('POST', { action: 'post', text: 'x' }), ctx)).status).toBe(402)
  })

  it('a manager who does not run the league is refused', async () => {
    const { GET } = await import(HANDLER)
    getLeagueRoleMock.mockResolvedValue('member')
    expect((await GET(req('GET'), ctx)).status).toBe(403)
  })

  it('a lapsed plan can still switch auto-post OFF, but not on', async () => {
    const { PUT } = await import(HANDLER)
    entitledMock.mockResolvedValue(false)
    saveMock.mockResolvedValue({ ok: true, settings: { autoPost: false, enabledByUserId: 'u1', posted: {} } })
    expect((await PUT(req('PUT', { autoPost: false }), ctx)).status).toBe(200)
    expect((await PUT(req('PUT', { autoPost: true }), ctx)).status).toBe(402)
  })

  it('an imported league: auto-post ON is refused server-side (409), and so is posting a hook', async () => {
    const { PUT, POST } = await import(HANDLER)
    saveMock.mockResolvedValue({ ok: false, error: 'imported' })
    expect((await PUT(req('PUT', { autoPost: true }), ctx)).status).toBe(409)
    readStudioViewMock.mockResolvedValue({ native: false, hooks: { byMatchup: [{ hooks: [HOOK] }], league: [] } })
    expect((await POST(req('POST', { action: 'post', hookId: HOOK.id, text: 'x' }), ctx)).status).toBe(409)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('a native league posts the server’s own hook (its facts and matchup), with the commissioner’s edited text', async () => {
    const { POST } = await import(HANDLER)
    readStudioViewMock.mockResolvedValue({ native: true, hooks: { byMatchup: [{ hooks: [HOOK] }], league: [] } })
    postMock.mockResolvedValue({ ok: true, messageId: 'm1', created: true, pollMessageId: null })
    const res = await POST(req('POST', { action: 'post', hookId: HOOK.id, text: 'Edited!', includePoll: true, facts: ['forged'] }), ctx)
    expect(res.status).toBe(200)
    expect(postMock.mock.calls[0][0]).toMatchObject({ text: 'Edited!', hook: HOOK, matchupId: 'mu1', includePoll: true })
  })
})
