// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  metrics: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/decision-os/leagueReadAuthorization', () => ({ authorizeLeagueRead: h.access }))
vi.mock('@/lib/af-projections/leaguePlayerMetrics', () => ({ loadLeaguePlayerMetrics: h.metrics }))
vi.mock('@/lib/af-projections/readAfProjections', () => ({ listAfProjections: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ success: true }), getClientIp: () => 'test' }))

import { GET } from '@/app/api/projections/af/route'

const weeklyPoolUrl = 'http://localhost/api/projections/af?leagueId=league&sport=NBA&view=weekly-player-pool&week=5'

beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user: { id: 'manager' } })
  h.access.mockResolvedValue({ authorized: true })
})

describe('weekly league player pool', () => {
  it('asks the shared reader for the selected week and forwards the exact totals', async () => {
    const board = { sport: 'NBA', week: 5, leagueId: 'league', rows: [{ playerId: 'af-1', weekly: 230.46 }] }
    h.metrics.mockResolvedValue(board)
    const response = await GET(new NextRequest(weeklyPoolUrl))
    expect(h.access).toHaveBeenCalledWith('league', 'manager')
    expect(h.metrics).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: 'league',
      week: 5,
      includePlayerPool: true,
      includeTradeValues: false,
    }))
    expect(await response.json()).toEqual(board)
  })

  it('does not read a league board for a caller outside the league', async () => {
    h.access.mockResolvedValue({ authorized: false, status: 403 })
    const response = await GET(new NextRequest(weeklyPoolUrl))
    expect(response.status).toBe(403)
    expect(h.metrics).not.toHaveBeenCalled()
  })
})
