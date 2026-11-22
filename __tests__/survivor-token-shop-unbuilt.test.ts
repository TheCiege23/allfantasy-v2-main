// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  member: vi.fn(),
  prisma: { survivorPlayer: { findFirst: vi.fn(), update: vi.fn() }, league: { findUnique: vi.fn() } },
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
 * Exile return needs. Nothing is for sale until it delivers: the old spend route stays refused, and the
 * shop lists only the reward-API items a commissioner priced (bought through /api/survivor/side-games).
 */
beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'u-1' } })
  m.member.mockResolvedValue({ ok: true })
  m.prisma.survivorPlayer.findFirst.mockResolvedValue({ id: 'p-1', tokenBalance: 5 })
  m.prisma.league.findUnique.mockResolvedValue({ settings: {}, language: 'en' })
})

const params = { params: { leagueId: 'lg' } }

describe('Survivor token shop', () => {
  it('lists nothing for sale while no advantage delivers', async () => {
    const res = await shop(new Request('http://x/api/leagues/lg/survivor/token-shop') as never, params)
    const body = await res.json()
    expect(body.catalog).toEqual([])
    expect(body.balance).toBe(5)
  })

  it('lists only the items the commissioner put on sale, at their price, in the league language', async () => {
    m.prisma.league.findUnique.mockResolvedValue({ language: 'es', settings: { survivorSideGames: { tokenShopEnabled: true, tokenShopItems: [
      { id: 'extra_vote', kind: 'advantage', enabled: true, cost: 4, amount: 0, powerType: 'extra_vote' },
      { id: 'faab_50', kind: 'faab', enabled: true, cost: 1, amount: 50, powerType: 'extra_vote' },
      { id: 'vote_steal', kind: 'advantage', enabled: false, cost: 5, amount: 0, powerType: 'vote_steal' },
    ] } } })
    const body = await (await shop(new Request('http://x/api/leagues/lg/survivor/token-shop') as never, params)).json()
    expect(body.catalog).toEqual([
      { id: 'extra_vote', kind: 'advantage', label: 'Voto extra', cost: 4, status: 'available' },
      { id: 'faab_50', kind: 'faab', label: 'FAAB $50', cost: 1, status: 'available' },
    ])
    expect(body.shopStatus).toBe('open')
  })

  it.each(['buy_clue', 'buy_extra_vote', 'buy_vote_steal'])('refuses %s without touching the balance', async advantage => {
    const res = await spend(new Request('http://x', { method: 'POST', body: JSON.stringify({ advantage }) }) as never, params)
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ pending: true, advantage })
    expect(m.prisma.survivorPlayer.update).not.toHaveBeenCalled()
    expect(m.audit).not.toHaveBeenCalled()
  })
})
