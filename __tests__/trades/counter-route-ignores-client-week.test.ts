// @vitest-environment node
/**
 * 🛑 The counter route forwarded `body.currentWeek` to the trade service, so the requester chose the
 * week the deadline was checked against. A counter in week 14 that sent `currentWeek: 1` passed.
 * The service now resolves the league's own week; the route must not hand it one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'uB' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/league-trade-engine/tradeService', () => ({ createAfLeagueTrade: h.create }))

import { POST } from '@/app/api/leagues/[leagueId]/trades/[tradeId]/counter/route'

beforeEach(() => {
  vi.clearAllMocks()
  h.create.mockResolvedValue({ id: 'counter-1' })
})

describe('POST /api/leagues/[leagueId]/trades/[tradeId]/counter', () => {
  it('does not forward a client-supplied week to the trade service', async () => {
    const req = new Request('http://x/api/leagues/L/trades/T/counter', {
      method: 'POST',
      body: JSON.stringify({
        proposerRosterId: 'rB',
        receiverRosterId: 'rA',
        assets: [{ itemType: 'player', itemReference: 'b1', fromRosterId: 'rB', toRosterId: 'rA' }],
        currentWeek: 1,
      }),
    })
    const res = await POST(req as never, { params: Promise.resolve({ leagueId: 'L', tradeId: 'T' }) })
    expect(res.status).toBe(200)
    expect(h.create).toHaveBeenCalledTimes(1)
    const args = h.create.mock.calls[0][0] as Record<string, unknown>
    expect(args).toMatchObject({ leagueId: 'L', parentTradeId: 'T', proposedByUserId: 'uB' })
    expect(args).not.toHaveProperty('currentWeek')
  })
})
