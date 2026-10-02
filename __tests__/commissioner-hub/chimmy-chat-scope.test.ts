import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(), role: vi.fn(), gate: vi.fn(), answer: vi.fn(), network: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: mocks.role }))
vi.mock('@/lib/prisma', () => ({ prisma: { commissionerNetworkMember: { findFirst: mocks.network } } }))
vi.mock('@/lib/ai-commissioner', () => ({ answerAICommissionerQuestion: mocks.answer }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({ requireFeatureEntitlement: mocks.gate }))
vi.mock('@/lib/tokens/TokenSpendService', () => ({ TokenSpendService: class {} }))

import { POST } from '@/app/api/leagues/[leagueId]/ai-commissioner/chat/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'user-1', email: 'commish@example.com' } })
  mocks.role.mockResolvedValue('co_commissioner')
  mocks.gate.mockResolvedValue({ ok: true, tokenSpend: null, tokenPreview: null })
  mocks.network.mockResolvedValue(null)
  mocks.answer.mockResolvedValue({ answer: 'Review the trade evidence.', source: 'template', insights: {} })
})

const request = () => new Request('http://localhost/chat', { method: 'POST', body: JSON.stringify({ question: 'Recent trades?' }) })
const context = { params: Promise.resolve({ leagueId: 'league-1' }) }

describe('commissioner Chimmy scope', () => {
  it('rejects an ordinary member before entitlement or AI work', async () => {
    mocks.role.mockResolvedValue('member')
    const response = await POST(request(), context)
    expect(response.status).toBe(403)
    expect(mocks.gate).not.toHaveBeenCalled()
    expect(mocks.answer).not.toHaveBeenCalled()
  })

  it('allows read-only guidance for a co-commissioner in the selected league', async () => {
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    expect(mocks.answer).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'league-1', question: 'Recent trades?' }))
  })
})
