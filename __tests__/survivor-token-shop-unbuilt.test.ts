// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  member: vi.fn(),
  prisma: { survivorPlayer: { findFirst: vi.fn(), update: vi.fn() } },
  audit: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: m.member }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/survivor/auditEntry', () => ({ logSurvivorAuditEntry: m.audit }))

import { GET as shop } from '@/server/api-route-modules/league-survivor/token-shop/route'
import { POST as spend } from '@/server/api-route-modules/league-survivor/tokens/spend/route'

/*
 * buy_clue was sold and charged for, and no clue was ever sent. The tokens are the same balance an
 * Exile return needs. Nothing is for sale until it delivers.
 */
beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'u-1' } })
  m.member.mockResolvedValue({ ok: true })
  m.prisma.survivorPlayer.findFirst.mockResolvedValue({ id: 'p-1', tokenBalance: 5 })
})

const params = { params: { leagueId: 'lg' } }

describe('Survivor token shop', () => {
  it('lists nothing for sale while no advantage delivers', async () => {
    const res = await shop(new Request('http://x/api/leagues/lg/survivor/token-shop') as never, params)
    const body = await res.json()
    expect(body.catalog).toEqual([])
    expect(body.balance).toBe(5)
  })

  it.each(['buy_clue', 'buy_extra_vote', 'buy_vote_steal'])('refuses %s without touching the balance', async advantage => {
    const res = await spend(new Request('http://x', { method: 'POST', body: JSON.stringify({ advantage }) }) as never, params)
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ pending: true, advantage })
    expect(m.prisma.survivorPlayer.update).not.toHaveBeenCalled()
    expect(m.audit).not.toHaveBeenCalled()
  })
})
