// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), roster: vi.fn(), save: vi.fn(), get: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: h.access }))
vi.mock('@/lib/prisma', () => ({ prisma: { roster: { findFirst: h.roster } } }))
vi.mock('@/lib/league-trade-engine/managerStrategy', async (original) => {
  const actual = await original<typeof import('@/lib/league-trade-engine/managerStrategy')>()
  return { ...actual, saveTradeManagerStrategy: h.save, getTradeManagerStrategy: h.get }
})

import { PUT } from '@/app/api/leagues/[leagueId]/trades/strategy/route'

const ctx = { params: Promise.resolve({ leagueId: 'l1' }) }

describe('trade strategy route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    h.access.mockResolvedValue({ ok: true })
    h.roster.mockResolvedValue({ id: 'r1' })
    h.save.mockResolvedValue({ active: 'rebuild', rosterId: 'r1', confirmedAt: new Date() })
  })

  it('rejects an invented objective before writing', async () => {
    const response = await PUT(new Request('http://local', { method: 'PUT', body: JSON.stringify({ active: 'maybe' }) }) as never, ctx)
    expect(response.status).toBe(400)
    expect(h.save).not.toHaveBeenCalled()
  })

  it('persists the signed-in member strategy against their roster', async () => {
    const response = await PUT(new Request('http://local', { method: 'PUT', body: JSON.stringify({ active: 'rebuild' }) }) as never, ctx)
    expect(response.status).toBe(200)
    expect(h.save).toHaveBeenCalledWith({ leagueId: 'l1', userId: 'u1', rosterId: 'r1', active: 'rebuild' })
  })
})
