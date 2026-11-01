// @vitest-environment node
/**
 * Token → FAAB on an Exile return: paid through the reward API from the `return_to_island` row, in
 * stable chunks of at most $1000, so a retry never pays twice; a return with the rate at 0 pays nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rows: [] as unknown[], apply: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { survivorAuditEntry: { findMany: async () => h.rows } } }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ applySurvivorReward: h.apply }))
vi.mock('@/lib/survivor/shareCards/hooks', () => ({ afterExileReturnResolved: vi.fn() }))
vi.mock('@/lib/survivor/survivorChatBridge', () => ({ createSurvivorChatMessage: vi.fn() }))

import { settleExileReturnFaab } from '@/lib/survivor/survivorExileLifecycle'

beforeEach(() => {
  h.apply.mockReset()
  h.apply.mockImplementation(async (input: { idempotencyKey: string }) => ({ ok: true, rewardId: input.idempotencyKey, status: 'applied', duplicate: false, changes: [], note: null }))
})

describe('settleExileReturnFaab', () => {
  it('pays tokens × rate as faab_grant chunks keyed on the manager', async () => {
    h.rows = [{ week: 8, targetUserId: 'u1', relatedEntityId: 'r1', data: { tokensHeld: 25, faabPerToken: 50, faab: 1250 } }]
    expect(await settleExileReturnFaab('L1')).toBe(1250)
    expect(h.apply.mock.calls.map(([i]) => [i.idempotencyKey, i.reward])).toEqual([
      ['exile_return:u1:faab:1', { type: 'faab_grant', rosterId: 'r1', amount: 1000 }],
      ['exile_return:u1:faab:2', { type: 'faab_grant', rosterId: 'r1', amount: 250 }],
    ])
    expect(h.apply.mock.calls[0][0].source).toMatchObject({ kind: 'exile' })
  })

  it('a return at rate 0 (today’s behaviour) pays nothing, and a duplicate is not counted twice', async () => {
    h.rows = [{ week: 8, targetUserId: 'u1', relatedEntityId: 'r1', data: { tokensSpent: 3, rosterRebuild: 'waivers' } }]
    expect(await settleExileReturnFaab('L1')).toBe(0)
    expect(h.apply).not.toHaveBeenCalled()
    h.rows = [{ week: 8, targetUserId: 'u1', relatedEntityId: 'r1', data: { faab: 100 } }]
    h.apply.mockResolvedValueOnce({ ok: true, rewardId: 'x', status: 'applied', duplicate: true, changes: [], note: null })
    expect(await settleExileReturnFaab('L1')).toBe(0)
  })
})
