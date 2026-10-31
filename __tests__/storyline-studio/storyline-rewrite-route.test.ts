import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const getLeagueRoleMock = vi.fn()
const entitledMock = vi.fn()
const readStudioViewMock = vi.fn()
const requireFeatureEntitlementMock = vi.fn()
const rewriteMock = vi.fn()
const refundMock = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: getLeagueRoleMock }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({ requireFeatureEntitlement: requireFeatureEntitlementMock }))
vi.mock('@/lib/tokens/paidToolBilling', () => ({
  withPaidToolBilling: (fn: unknown) => fn,
  paidToolNotDelivered: vi.fn(),
}))
vi.mock('@/lib/tokens/storylineSpendRefund', () => ({ refundStorylineSpend: refundMock }))
vi.mock('@/lib/league-story-creator/OneBrainNarrativeComposer', () => ({ rewriteHookInTone: rewriteMock }))
vi.mock('@/lib/storyline-studio/storylineService', () => ({ storylineEntitled: entitledMock, readStudioView: readStudioViewMock }))

const ROUTE = '../../app/api/leagues/[leagueId]/storylines/rewrite/route'
const ctx = { params: Promise.resolve({ leagueId: 'l1' }) }
const post = (body: unknown) => new Request('http://localhost/r', { method: 'POST', body: JSON.stringify(body) })
const HOOK = {
  id: 'h1',
  text: 'Hawks lead Owls 2-1.',
  facts: [
    { key: 'leaderTeam', value: 'Hawks', source: 'f' },
    { key: 'trailerTeam', value: 'Owls', source: 'f' },
    { key: 'leaderWins', value: 2, source: 'f' },
    { key: 'trailerWins', value: 1, source: 'f' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
  getLeagueRoleMock.mockResolvedValue('commissioner')
  entitledMock.mockResolvedValue(true)
  readStudioViewMock.mockResolvedValue({ hooks: { byMatchup: [{ hooks: [HOOK] }], league: [] } })
  requireFeatureEntitlementMock.mockResolvedValue({ ok: true, tokenSpend: { id: 'ledger1', balanceAfter: 10 } })
})

describe('storyline tone rewrite', () => {
  it('needs AF Commissioner before anything is charged', async () => {
    const { POST } = await import(ROUTE)
    entitledMock.mockResolvedValue(false)
    expect((await POST(post({ hookId: 'h1', tone: 'announcer' }), ctx)).status).toBe(402)
    expect(requireFeatureEntitlementMock).not.toHaveBeenCalled()
  })

  it('is billed like story/create: storyline_creation with token fallback and confirm-before-spend', async () => {
    const { POST } = await import(ROUTE)
    rewriteMock.mockResolvedValue('Hawks over Owls, 2-1 all-time!')
    const body = await (await POST(post({ hookId: 'h1', tone: 'trash_talk', confirmTokenSpend: true }), ctx)).json()
    expect(requireFeatureEntitlementMock.mock.calls[0][0]).toMatchObject({
      featureId: 'storyline_creation',
      allowTokenFallback: true,
      confirmTokenSpend: true,
      tokenRuleCode: 'ai_storyline_creation',
    })
    expect(body).toMatchObject({ source: 'ai', text: 'Hawks over Owls, 2-1 all-time!' })
  })

  it('a rewrite that invents a number is discarded, the template returned, and the spend refunded', async () => {
    const { POST } = await import(ROUTE)
    rewriteMock.mockResolvedValue('Hawks lead Owls 7-1!')
    const body = await (await POST(post({ hookId: 'h1', tone: 'announcer' }), ctx)).json()
    expect(body).toMatchObject({ source: 'template', text: HOOK.text, refunded: true })
    expect(refundMock).toHaveBeenCalledOnce()
  })

  it('a bad request costs nothing', async () => {
    const { POST } = await import(ROUTE)
    expect((await POST(post({ hookId: 'h1', tone: 'roast' }), ctx)).status).toBe(400)
    expect((await POST(post({ hookId: 'nope', tone: 'neutral' }), ctx)).status).toBe(404)
    expect(requireFeatureEntitlementMock).not.toHaveBeenCalled()
  })
})
