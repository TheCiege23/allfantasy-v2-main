import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { genericTradeComparison: {
  findMany: mocks.findMany, upsert: mocks.upsert, deleteMany: mocks.deleteMany,
} } }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ success: true }), getClientIp: () => '127.0.0.1' }))

import { GET, POST, DELETE } from '@/app/api/trade-value/comparisons/route'

const comparison = {
  id: 'device-1', sport: 'NFL', title: 'Team A ↔ Team B', at: '2026-10-03T10:00:00.000Z',
  basis: 'General market values', uncertainty: 'Market estimate',
  sides: ['Team A', 'Team B'], assets: [['Player One'], ['Player Two']],
  grades: ['B', 'D'], verdict: 'Favors Team A',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'user-1' } })
  mocks.findMany.mockResolvedValue([])
  mocks.upsert.mockResolvedValue({})
  mocks.deleteMany.mockResolvedValue({ count: 1 })
})

describe('account-saved generic trade comparisons', () => {
  it('requires sign-in for every operation', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await GET(new Request('https://example.com/api/trade-value/comparisons'))).status).toBe(401)
    expect((await POST(new Request('https://example.com/api/trade-value/comparisons', { method: 'POST', body: '{}' }))).status).toBe(401)
    expect((await DELETE(new Request('https://example.com/api/trade-value/comparisons?id=device-1', { method: 'DELETE' }))).status).toBe(401)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it('scopes reads, idempotent imports, and deletes to the signed-in user', async () => {
    const post = await POST(new Request('https://example.com/api/trade-value/comparisons', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshots: [comparison] }),
    }))
    expect(post.status).toBe(200)
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_sourceId: { userId: 'user-1', sourceId: 'device-1' } },
      create: expect.objectContaining({ userId: 'user-1', sourceId: 'device-1' }),
      update: {},
    }))
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }))
    const removed = await DELETE(new Request('https://example.com/api/trade-value/comparisons?id=device-1', { method: 'DELETE' }))
    expect(removed.status).toBe(200)
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', sourceId: 'device-1' } })
  })

  it('rejects oversized or malformed snapshots before any write', async () => {
    const response = await POST(new Request('https://example.com/api/trade-value/comparisons', {
      method: 'POST', body: JSON.stringify({ snapshots: [{ ...comparison, assets: [['x'.repeat(121)], ['Player Two']] }] }),
    }))
    expect(response.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
