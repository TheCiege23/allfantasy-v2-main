// @vitest-environment node
/**
 * Challenge rewards pay out for real: FAAB lands in the winner's waiver budget, individual
 * immunity flags the manager for that week's council, and tribe immunity is recorded for the
 * council opener. A reward that cannot be applied is recorded, never invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  db: {
    survivorChallenge: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn(), update: vi.fn() },
    redraftRoster: { findFirst: vi.fn(), update: vi.fn() },
    survivorPlayer: { updateMany: vi.fn() },
    survivorTribeMember: { findMany: vi.fn() },
    survivorIdol: { create: vi.fn() },
    survivorIdolLedgerEntry: { create: vi.fn() },
    survivorAuditLog: { findMany: vi.fn() },
  },
  audit: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn(async () => ({ configId: 'cfg-1' })) }))
vi.mock('@/lib/survivor/SurvivorAuditLog', () => ({ appendSurvivorAudit: m.audit }))

import { applyChallengeRewards } from '@/lib/survivor/SurvivorEffectEngine'

function challenge(extra: Record<string, unknown> = {}) {
  return { id: 'ch-1', leagueId: 'L1', week: 6, challengeType: 'custom', configJson: {}, rewardType: null, rewardAmount: null, ...extra }
}
const auditRows = () => m.audit.mock.calls.map(([, , eventType, metadata]) => ({ eventType, metadata }))

describe('applyChallengeRewards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.db.roster.findFirst.mockResolvedValue({ id: 'r1', redraftRosterId: 'rr1', faabRemaining: 100 })
    m.db.redraftRoster.findFirst.mockResolvedValue({ id: 'rr1', faabBalance: 100 })
    m.db.roster.update.mockResolvedValue({})
    m.db.redraftRoster.update.mockResolvedValue({})
    m.db.survivorPlayer.updateMany.mockResolvedValue({ count: 1 })
  })

  it('FAAB credits the waiver budget the claims engine spends, and the legacy mirror', async () => {
    m.db.survivorChallenge.findUnique.mockResolvedValue(challenge({ configJson: { rewardType: 'faab', rewardAmount: 12 } }))
    const applied = await applyChallengeRewards('ch-1', { winnerRosterId: 'r1' })
    expect(applied).toEqual([{ rewardType: 'faab', week: 6, rosterId: 'r1', tribeId: null, amount: 12, appliedMode: 'full' }])
    expect(m.db.roster.findFirst).toHaveBeenCalledWith({ where: { id: 'r1', leagueId: 'L1' }, select: { id: true, redraftRosterId: true, faabRemaining: true } })
    expect(m.db.redraftRoster.findFirst).toHaveBeenCalledWith({ where: { id: 'rr1', leagueId: 'L1' }, select: { id: true, faabBalance: true } })
    expect(m.db.redraftRoster.update).toHaveBeenCalledWith({ where: { id: 'rr1' }, data: { faabBalance: 112 } })
    expect(m.db.roster.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { faabRemaining: 112 } })
    expect(auditRows()).toEqual([{
      eventType: 'challenge_reward_awarded',
      metadata: expect.objectContaining({
        rewardType: 'faab', rosterId: 'r1', amount: 12, appliedMode: 'full', redraftRosterId: 'rr1',
        faabBalanceBefore: 100, faabBalanceAfter: 112, faabRemainingBefore: 100, faabRemainingAfter: 112,
      }),
    }])
  })

  it('reads the reward from the challenge row when configJson does not carry it', async () => {
    m.db.survivorChallenge.findUnique.mockResolvedValue(challenge({ rewardType: 'faab', rewardAmount: 8 }))
    m.db.roster.findFirst.mockResolvedValue({ id: 'r1', redraftRosterId: 'rr1', faabRemaining: null })
    const applied = await applyChallengeRewards('ch-1', { winnerRosterId: 'r1' })
    expect(applied).toEqual([expect.objectContaining({ rewardType: 'faab', amount: 8, appliedMode: 'full' })])
    expect(m.db.redraftRoster.update).toHaveBeenCalledWith({ where: { id: 'rr1' }, data: { faabBalance: 108 } })
    expect(m.db.roster.update).not.toHaveBeenCalled()
  })

  it('records a FAAB reward it cannot credit instead of inventing a budget', async () => {
    m.db.survivorChallenge.findUnique.mockResolvedValue(challenge({ configJson: { rewardType: 'faab' } }))
    expect(await applyChallengeRewards('ch-1', { winnerRosterId: 'r1' })).toEqual([expect.objectContaining({ rewardType: 'faab', amount: null, appliedMode: 'record_only' })])
    expect(m.db.redraftRoster.update).not.toHaveBeenCalled()
    expect(m.db.roster.update).not.toHaveBeenCalled()
    expect(auditRows()[0].metadata).toMatchObject({ appliedMode: 'record_only', faabReason: 'no_amount' })

    vi.clearAllMocks()
    m.db.survivorChallenge.findUnique.mockResolvedValue(challenge({ configJson: { rewardType: 'faab', rewardAmount: 5 } }))
    m.db.roster.findFirst.mockResolvedValue(null)
    m.db.redraftRoster.findFirst.mockResolvedValue(null)
    expect(await applyChallengeRewards('ch-1', { winnerRosterId: 'ghost' })).toEqual([expect.objectContaining({ appliedMode: 'record_only' })])
    expect(auditRows()[0].metadata).toMatchObject({ faabReason: 'roster_not_found' })
  })

  it('a tribe FAAB reward credits every member of the tribe', async () => {
    m.db.survivorChallenge.findUnique.mockResolvedValue(challenge({ configJson: { rewardType: 'faab', rewardAmount: 3 } }))
    m.db.survivorTribeMember.findMany.mockResolvedValue([{ rosterId: 'r1' }, { rosterId: 'r2' }])
    m.db.roster.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, redraftRosterId: `rr-${where.id}`, faabRemaining: null }))
    m.db.redraftRoster.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, faabBalance: 20 }))
    const applied = await applyChallengeRewards('ch-1', { winnerTribeId: 'tribe-a' })
    expect(applied.map(a => [a.rosterId, a.tribeId, a.appliedMode])).toEqual([['r1', 'tribe-a', 'full'], ['r2', 'tribe-a', 'full']])
    expect(m.db.redraftRoster.update).toHaveBeenCalledTimes(2)
    expect(m.db.redraftRoster.update).toHaveBeenCalledWith({ where: { id: 'rr-r2' }, data: { faabBalance: 23 } })
  })

  it('individual immunity flags the winner for the council, and is only recorded when nobody matches', async () => {
    m.db.survivorChallenge.findUnique.mockResolvedValue(challenge({ configJson: { rewardType: 'immunity' } }))
    expect(await applyChallengeRewards('ch-1', { winnerRosterId: 'r1' })).toEqual([expect.objectContaining({ rewardType: 'immunity', rosterId: 'r1', appliedMode: 'full' })])
    expect(m.db.survivorPlayer.updateMany).toHaveBeenCalledWith({
      where: { leagueId: 'L1', redraftRosterId: 'r1', playerState: 'active' },
      data: { hasImmunityThisWeek: true, immunitySource: 'challenge_win' },
    })
    expect(m.db.roster.update).not.toHaveBeenCalled()

    m.db.survivorPlayer.updateMany.mockResolvedValue({ count: 0 })
    m.db.survivorChallenge.findUnique.mockResolvedValue(challenge({ configJson: { rewardType: 'voting_safety' } }))
    expect(await applyChallengeRewards('ch-1', { winnerRosterId: 'r9' })).toEqual([expect.objectContaining({ rewardType: 'voting_safety', appliedMode: 'record_only' })])
  })

  it('tribe immunity is recorded for the council opener and touches no roster', async () => {
    m.db.survivorChallenge.findUnique.mockResolvedValue(challenge({ configJson: { rewardType: 'tribe_immunity' } }))
    expect(await applyChallengeRewards('ch-1', { winnerTribeId: 'tribe-a' })).toEqual([{ rewardType: 'tribe_immunity', week: 6, tribeId: 'tribe-a', appliedMode: 'full' }])
    expect(auditRows()).toEqual([{ eventType: 'challenge_reward_awarded', metadata: { challengeId: 'ch-1', week: 6, rewardType: 'tribe_immunity', tribeId: 'tribe-a' } }])
    expect(m.db.roster.update).not.toHaveBeenCalled()
    expect(m.db.survivorPlayer.updateMany).not.toHaveBeenCalled()
  })
})
