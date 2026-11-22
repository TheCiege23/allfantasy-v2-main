// @vitest-environment node
/**
 * A challenge result naming one of the newer reward types (score_penalty, faab_transfer, steal…),
 * or any reward marked deferred, is paid through the one reward API with a stable key per
 * challenge / reward / recipient. The original reward types keep their original path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  db: {
    survivorChallenge: { findUnique: vi.fn() },
    survivorTribeMember: { findMany: vi.fn(async () => []) },
    survivorPlayer: { updateMany: vi.fn(async () => ({ count: 1 })) },
  },
  apply: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn(async () => ({ configId: 'cfg-1' })) }))
vi.mock('@/lib/survivor/SurvivorAuditLog', () => ({ appendSurvivorAudit: m.audit }))
vi.mock('@/lib/survivor/survivorRewardEngine', () => ({
  applySurvivorReward: m.apply,
  applyDueDeferredSurvivorRewards: vi.fn(), chooseSurvivorRewardTarget: vi.fn(), getSurvivorTradeTokens: vi.fn(),
  listSurvivorRewards: vi.fn(), redeemSurvivorTradeToken: vi.fn(), reverseSurvivorReward: vi.fn(),
}))

import { applyChallengeRewards } from '@/lib/survivor/SurvivorEffectEngine'

const challenge = { id: 'ch-1', leagueId: 'L1', week: 6, challengeType: 'custom', configJson: {}, rewardType: null, rewardAmount: null }

beforeEach(() => {
  vi.clearAllMocks()
  m.db.survivorChallenge.findUnique.mockResolvedValue(challenge)
  m.apply.mockResolvedValue({ ok: true, rewardId: 'x', status: 'applied', duplicate: false, changes: [], note: null })
})

describe('applyChallengeRewards → applySurvivorReward', () => {
  it('pays a penalty, a tribe FAAB transfer and a steal through the reward API', async () => {
    const applied = await applyChallengeRewards('ch-1', {
      rewards: [
        { rewardType: 'score_penalty', rosterId: 'r1', amount: 20 },
        { rewardType: 'faab_transfer', tribeId: 'winners', fromTribeId: 'losers', amount: 50 },
        { rewardType: 'steal', rosterId: 'r2', what: 'points', targetRosterId: 'r3', amount: 15 },
      ],
    })
    expect(m.apply.mock.calls.map(([i]) => [i.idempotencyKey, i.reward])).toEqual([
      ['challenge:ch-1:0:r1', { type: 'score_penalty', rosterId: 'r1', points: 20 }],
      ['challenge:ch-1:1:winners', { type: 'faab_transfer', fromTribeId: 'losers', toTribeId: 'winners', amount: 50, basis: 'per_member' }],
      ['challenge:ch-1:2:r2', { type: 'steal', thiefRosterId: 'r2', what: 'points', amount: 15, targetRosterId: 'r3' }],
    ])
    expect(m.apply.mock.calls[0][0]).toMatchObject({ source: { kind: 'challenge', id: 'ch-1' }, week: 6, deferToWeek: null })
    expect(applied.map((a) => a.rewardType)).toEqual(['score_penalty', 'faab_transfer', 'steal'])
    expect(m.audit).not.toHaveBeenCalled()
  })

  it('defers an ordinary FAAB prize to next week when the challenge says so', async () => {
    await applyChallengeRewards('ch-1', { rewards: [{ rewardType: 'faab', rosterId: 'r1', amount: 30, deferred: true }] })
    expect(m.apply).toHaveBeenCalledWith(expect.objectContaining({ deferToWeek: 7, reward: { type: 'faab_grant', rosterId: 'r1', amount: 30 } }))
  })

  it('leaves the original reward types on their original path', async () => {
    await applyChallengeRewards('ch-1', { rewards: [{ rewardType: 'immunity', rosterId: 'r1' }] })
    expect(m.apply).not.toHaveBeenCalled()
    expect(m.audit).toHaveBeenCalledWith('L1', 'cfg-1', 'challenge_reward_awarded', expect.objectContaining({ rewardType: 'immunity', rosterId: 'r1' }))
  })
})
