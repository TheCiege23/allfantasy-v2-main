/**
 * Survivor rewards, pure half (lib/survivor/survivorRewardModel.ts): validation, the FAAB transfer
 * split (never below 0), the ledger fold, Chimmy's deterministic choices and the bilingual lines.
 */
import { describe, expect, it } from 'vitest'
import {
  computeFaabTransfer,
  describeSurvivorReward,
  foldSurvivorRewardLedger,
  pickChimmyStealTarget,
  pickChimmyTribemate,
  rewardApplyWeek,
  rewardNeedsChoice,
  stealFaabTake,
  validateApplySurvivorRewardInput,
  validateSurvivorRewardSpec,
} from '@/lib/survivor/survivorRewardModel'

describe('validateSurvivorRewardSpec', () => {
  it('accepts every reward type in its documented shape', () => {
    expect(validateSurvivorRewardSpec({ type: 'score_penalty', rosterId: 'r1', points: 20 })).toBeNull()
    expect(validateSurvivorRewardSpec({ type: 'score_bonus', rosterId: 'r1', points: 12.5, targetWeek: 7 })).toBeNull()
    expect(validateSurvivorRewardSpec({ type: 'faab_grant', rosterId: 'r1', amount: 50 })).toBeNull()
    expect(validateSurvivorRewardSpec({ type: 'faab_transfer', fromTribeId: 'a', toTribeId: 'b', amount: 50, basis: 'total' })).toBeNull()
    expect(validateSurvivorRewardSpec({ type: 'tribemate_points', chooserRosterId: 'r1', points: 100 })).toBeNull()
    expect(validateSurvivorRewardSpec({ type: 'free_trade_token', rosterId: 'r1' })).toBeNull()
    expect(validateSurvivorRewardSpec({ type: 'steal_blocker', rosterId: 'r1' })).toBeNull()
    expect(validateSurvivorRewardSpec({ type: 'steal', thiefRosterId: 'r1', what: 'faab', amount: 20, targetRosterId: 'r2' })).toBeNull()
    expect(validateSurvivorRewardSpec({ type: 'advantage', rosterId: 'r1', powerType: 'extra_vote' })).toBeNull()
  })

  it('refuses bad input with a plain reason', () => {
    expect(validateSurvivorRewardSpec({ type: 'teleport', rosterId: 'r1' })).toMatch(/Unknown reward type/)
    expect(validateSurvivorRewardSpec({ type: 'score_penalty', rosterId: 'r1', points: 0 })).toMatch(/Points/)
    expect(validateSurvivorRewardSpec({ type: 'score_penalty', rosterId: 'r1', points: 501 })).toMatch(/Points/)
    expect(validateSurvivorRewardSpec({ type: 'faab_grant', rosterId: 'r1', amount: 2.5 })).toMatch(/whole/)
    expect(validateSurvivorRewardSpec({ type: 'faab_transfer', fromTribeId: 'a', toTribeId: 'a', amount: 5 })).toMatch(/different tribes/)
    expect(validateSurvivorRewardSpec({ type: 'tribemate_points', chooserRosterId: 'r1', targetRosterId: 'r1', points: 5 })).toMatch(/tribemate/)
    expect(validateSurvivorRewardSpec({ type: 'steal', thiefRosterId: 'r1', targetRosterId: 'r1', what: 'faab', amount: 5 })).toMatch(/themselves/)
    expect(validateSurvivorRewardSpec({ type: 'advantage', rosterId: 'r1', powerType: 'nuke' })).toMatch(/advantage/)
  })

  it('requires an idempotency key and a later week for a deferred reward', () => {
    const base = { leagueId: 'L1', idempotencyKey: 'k', source: { kind: 'challenge' as const }, week: 5, reward: { type: 'faab_grant' as const, rosterId: 'r1', amount: 5 } }
    expect(validateApplySurvivorRewardInput(base)).toBeNull()
    expect(validateApplySurvivorRewardInput({ ...base, idempotencyKey: ' ' })).toMatch(/idempotency/)
    expect(validateApplySurvivorRewardInput({ ...base, deferToWeek: 5 })).toMatch(/later week/)
    expect(validateApplySurvivorRewardInput({ ...base, deferToWeek: 6 })).toBeNull()
  })
})

describe('computeFaabTransfer', () => {
  it('takes per member, never below 0, and splits the take evenly with the remainder to the lowest ids', () => {
    const plan = computeFaabTransfer({
      sources: [{ rosterId: 's2', balance: 100 }, { rosterId: 's1', balance: 7 }, { rosterId: 's3', balance: 0 }],
      destinationRosterIds: ['d2', 'd1'],
      amount: 50,
    })
    expect(plan.debits).toEqual([{ rosterId: 's1', amount: 7 }, { rosterId: 's2', amount: 50 }])
    expect(plan.collected).toBe(57)
    expect(plan.credits).toEqual([{ rosterId: 'd1', amount: 29 }, { rosterId: 'd2', amount: 28 }])
  })

  it('splits a total across the source tribe', () => {
    const plan = computeFaabTransfer({ sources: [{ rosterId: 'a', balance: 100 }, { rosterId: 'b', balance: 100 }, { rosterId: 'c', balance: 100 }], destinationRosterIds: ['x'], amount: 100, basis: 'total' })
    expect(plan.debits).toEqual([{ rosterId: 'a', amount: 34 }, { rosterId: 'b', amount: 33 }, { rosterId: 'c', amount: 33 }])
    expect(plan.credits).toEqual([{ rosterId: 'x', amount: 100 }])
  })

  it('moves nothing when nobody can pay', () => {
    expect(computeFaabTransfer({ sources: [{ rosterId: 'a', balance: 0 }], destinationRosterIds: ['x'], amount: 10 })).toEqual({ debits: [], credits: [], collected: 0 })
  })

  it('caps a FAAB steal at the target balance', () => {
    expect(stealFaabTake(50, 12)).toBe(12)
    expect(stealFaabTake(50, -3)).toBe(0)
  })
})

describe('ledger fold', () => {
  it('rebuilds the current state from granted + later rows in time order', () => {
    const rows = [
      { action: 'reward_consumed', relatedEntityId: 'tok', data: { status: 'consumed', note: 'trade:t1' }, createdAt: '2026-10-02T00:00:00Z' },
      { action: 'reward_granted', relatedEntityId: 'tok', week: 4, data: { spec: { type: 'free_trade_token', rosterId: 'r1' }, status: 'available', week: 4, applyWeek: 4, source: { kind: 'challenge' } }, createdAt: '2026-10-01T00:00:00Z' },
      { action: 'reward_granted', relatedEntityId: 'bad', data: { spec: { type: 'nope' } }, createdAt: '2026-10-01T00:00:00Z' },
    ]
    const map = foldSurvivorRewardLedger(rows)
    expect(map.size).toBe(1)
    expect(map.get('tok')).toMatchObject({ type: 'free_trade_token', status: 'consumed', note: 'trade:t1', holderRosterIds: ['r1'], week: 4 })
  })
})

describe('Chimmy choices (deterministic, spoiler-safe)', () => {
  it('puts tribemate points on the weakest tribemate, never itself unless allowed and alone', () => {
    const mates = [{ rosterId: 'me', seasonPoints: 10 }, { rosterId: 'b', seasonPoints: 300 }, { rosterId: 'a', seasonPoints: 200 }, { rosterId: 'c', seasonPoints: 200 }]
    expect(pickChimmyTribemate(mates, 'me')).toBe('a')
    expect(pickChimmyTribemate([{ rosterId: 'me', seasonPoints: 1 }], 'me')).toBeNull()
    expect(pickChimmyTribemate([{ rosterId: 'me', seasonPoints: 1 }], 'me', true)).toBe('me')
  })

  it('steals from the richest opponent in what is stolen, and from nobody with nothing to take', () => {
    const field = [{ rosterId: 'x', faab: 40, points: 90 }, { rosterId: 'y', faab: 80, points: 50 }, { rosterId: 'me', faab: 999, points: 999 }]
    expect(pickChimmyStealTarget(field, 'me', 'faab')).toBe('y')
    expect(pickChimmyStealTarget(field, 'me', 'points')).toBe('x')
    expect(pickChimmyStealTarget([{ rosterId: 'x', faab: 0, points: 0 }], 'me', 'faab')).toBeNull()
  })
})

describe('describeSurvivorReward', () => {
  it('reads in English and Spanish', () => {
    const r = { spec: { type: 'tribemate_points' as const, chooserRosterId: 'r1', points: 100 }, status: 'awaiting_choice' as const, applyWeek: 6 }
    expect(describeSurvivorReward(r, 'en')).toBe('100 points to place on a tribemate (week 6) — waiting for your choice')
    expect(describeSurvivorReward(r, 'es-MX')).toBe('100 puntos para colocar en un compañero de tribu (semana 6) — falta tu elección')
  })
  it('knows which rewards wait on a choice and which week they land on', () => {
    expect(rewardNeedsChoice({ type: 'steal', thiefRosterId: 'a', what: 'faab', amount: 5 })).toBe(true)
    expect(rewardNeedsChoice({ type: 'steal', thiefRosterId: 'a', what: 'faab', amount: 5, targetRosterId: 'b' })).toBe(false)
    expect(rewardApplyWeek({ week: 5, deferToWeek: 6, reward: { type: 'score_bonus', rosterId: 'a', points: 5, targetWeek: 9 } })).toBe(6)
    expect(rewardApplyWeek({ week: 5, reward: { type: 'score_bonus', rosterId: 'a', points: 5, targetWeek: 9 } })).toBe(9)
    expect(rewardApplyWeek({ week: 5, reward: { type: 'faab_grant', rosterId: 'a', amount: 5 } })).toBe(5)
  })
})
