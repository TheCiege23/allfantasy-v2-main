/** Confirming (escalating) a tanking flag applies the penalty ladder — once, on the change only. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(async () => ({ count: 1 })),
  confirmed: vi.fn(async () => [{ rosterId: 'r1', step: { kind: 'forfeit_pick', strike: 2 } }]),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/requireEntitlement', () => ({ requireEntitlement: vi.fn(async () => 'commish') }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => undefined) }))
vi.mock('@/lib/prisma', () => ({ prisma: { integrityFlag: { findFirst: m.findFirst, updateMany: m.updateMany } } }))
vi.mock('@/lib/integrity/tankingPenaltyService', () => ({ onTankingFlagConfirmed: m.confirmed }))

import { PATCH } from '@/app/api/leagues/[leagueId]/integrity/flags/[flagId]/route'

const patch = (status: string) =>
  PATCH(createMockNextRequest('http://x/api/leagues/L/integrity/flags/f1', { method: 'PATCH', body: { status } }) as never, {
    params: Promise.resolve({ leagueId: 'L', flagId: 'f1' }),
  })

beforeEach(() => vi.clearAllMocks())

describe('PATCH integrity flag', () => {
  it('escalating an open tanking flag applies the penalty and returns it', async () => {
    m.findFirst.mockResolvedValueOnce({ status: 'open', flagType: 'tanking' }).mockResolvedValueOnce({ id: 'f1', status: 'escalated' })
    const res = await patch('escalated')
    expect(res.status).toBe(200)
    expect(m.confirmed).toHaveBeenCalledWith('f1', 'commish')
    expect(await res.json()).toMatchObject({ penalties: [{ rosterId: 'r1' }] })
  })

  it('re-saving an already escalated flag never takes a second pick', async () => {
    m.findFirst.mockResolvedValueOnce({ status: 'escalated', flagType: 'tanking' }).mockResolvedValueOnce({ id: 'f1' })
    await patch('escalated')
    expect(m.confirmed).not.toHaveBeenCalled()
  })

  it('dismissing a flag, or escalating a collusion flag, applies no penalty', async () => {
    m.findFirst.mockResolvedValueOnce({ status: 'open', flagType: 'tanking' }).mockResolvedValueOnce({ id: 'f1' })
    await patch('dismissed')
    m.findFirst.mockResolvedValueOnce({ status: 'open', flagType: 'collusion' }).mockResolvedValueOnce({ id: 'f1' })
    await patch('escalated')
    expect(m.confirmed).not.toHaveBeenCalled()
  })
})
