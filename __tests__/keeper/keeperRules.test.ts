import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEvaluate } = vi.hoisted(() => ({ mockEvaluate: vi.fn() }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    evaluateUserFeatureAccess = mockEvaluate
  },
}))

import {
  keeperCostRound,
  placeTeamKeepers,
  placedKeeperLabel,
  resolveKeeperRules,
  type KeeperRules,
} from '@/lib/keeper/keeperRules'
import { keeperRuleSettingsRefusal } from '@/lib/keeper/keeperRuleGate'

const rules = (over: Partial<KeeperRules> = {}): KeeperRules => ({
  costSystem: 'round_based',
  roundsEarlier: 1,
  inflationPerYear: 1,
  waiverCostRound: null,
  minCostRound: null,
  sameRoundRule: 'player_chooses',
  ...over,
})
const cost = (r: KeeperRules, lastRound: number | null, yearsKept = 0) => keeperCostRound(r, { lastRound, yearsKept, totalRounds: 15 })

describe('keeper cost', () => {
  it('same round, one up (earlier) and one down (later) — drafted R5', () => {
    expect(cost(rules({ roundsEarlier: 0 }), 5)).toMatchObject({ ok: true, costRound: 5 })
    expect(cost(rules({ roundsEarlier: 1 }), 5)).toMatchObject({ ok: true, costRound: 4 })
    expect(cost(rules({ roundsEarlier: -1 }), 5)).toMatchObject({ ok: true, costRound: 6 })
  })

  it('clamps to the draft: round 1 can go no earlier, the last round no later', () => {
    expect(cost(rules({ roundsEarlier: 1 }), 1)).toMatchObject({ ok: true, costRound: 1 })
    expect(cost(rules({ roundsEarlier: -2 }), 15)).toMatchObject({ ok: true, costRound: 15 })
  })

  it('inflation moves earlier for every season already kept', () => {
    const r = rules({ costSystem: 'inflation', roundsEarlier: 1, inflationPerYear: 2 })
    expect(cost(r, 8, 0)).toMatchObject({ costRound: 7 })
    expect(cost(r, 8, 2)).toMatchObject({ costRound: 3 })
  })

  it('waiver pickups cost the waiver round with no penalty, defaulting to the last round', () => {
    expect(cost(rules(), null)).toMatchObject({ ok: true, costRound: 15, basis: 'waiver' })
    expect(cost(rules({ waiverCostRound: 10 }), null)).toMatchObject({ ok: true, costRound: 10, basis: 'waiver' })
    expect(cost(rules({ waiverCostRound: 30 }), null)).toMatchObject({ costRound: 15 })
  })

  it('the round floor makes a keeper ineligible when his cost lands earlier', () => {
    const r = rules({ minCostRound: 2, roundsEarlier: 0 })
    expect(cost(r, 1)).toMatchObject({ ok: false, reason: 'above_round_floor', costRound: 1 })
    expect(cost(r, 2)).toMatchObject({ ok: true, costRound: 2 })
  })

  it('reads rules from the league columns and settings, with safe defaults', () => {
    expect(resolveKeeperRules({})).toEqual(rules())
    expect(
      resolveKeeperRules({
        keeperCostSystem: 'inflation', keeperRoundPenalty: -1, keeperInflationRate: 2, keeperConflictRule: 'lose_round_before',
        settings: { keeper_waiver_cost_round: '10', keeper_min_cost_round: 2 },
      }),
    ).toEqual(rules({ costSystem: 'inflation', roundsEarlier: -1, inflationPerYear: 2, sameRoundRule: 'lose_round_before', waiverCostRound: 10, minCostRound: 2 }))
    expect(resolveKeeperRules({ keeperConflictRule: 'nonsense', keeperCostSystem: 'x' })).toMatchObject({ sameRoundRule: 'player_chooses', costSystem: 'round_based' })
  })
})

describe('placing a team’s keepers on the board', () => {
  const opts = { totalRounds: 15 }

  it('lose the round before (owner default): R5 + R5 → R5 and R4', () => {
    const out = placeTeamKeepers(rules({ sameRoundRule: 'lose_round_before' }), [{ playerId: 'a', costRound: 5 }, { playerId: 'b', costRound: 5 }], opts)
    expect(out.refused).toEqual([])
    expect(out.placed.map((p) => [p.playerId, p.round, p.movedBecause])).toEqual([['b', 4, 'same_round'], ['a', 5, null]])
    expect(placedKeeperLabel(out.placed[0])).toBe('Round 4 (moved from Round 5: two keepers cost Round 5)')
  })

  it('lose the round before keeps walking earlier past rounds already used', () => {
    const out = placeTeamKeepers(
      rules({ sameRoundRule: 'lose_round_before' }),
      [{ playerId: 'a', costRound: 5 }, { playerId: 'b', costRound: 5 }, { playerId: 'c', costRound: 4 }],
      opts,
    )
    expect(Object.fromEntries(out.placed.map((p) => [p.playerId, p.round]))).toEqual({ c: 4, a: 5, b: 3 })
  })

  it('lose the round after: R5 + R5 → R5 and R6', () => {
    const out = placeTeamKeepers(rules({ sameRoundRule: 'lose_round_after' }), [{ playerId: 'a', costRound: 5 }, { playerId: 'b', costRound: 5 }], opts)
    expect(Object.fromEntries(out.placed.map((p) => [p.playerId, p.round]))).toEqual({ a: 5, b: 6 })
  })

  it('refusing rules refuse EVERY keeper in the clashing round so the manager chooses', () => {
    const out = placeTeamKeepers(rules({ sameRoundRule: 'player_chooses' }), [{ playerId: 'a', costRound: 5 }, { playerId: 'b', costRound: 5 }, { playerId: 'c', costRound: 8 }], opts)
    expect(out.placed.map((p) => p.playerId)).toEqual(['c'])
    expect(out.refused.map((r) => r.playerId).sort()).toEqual(['a', 'b'])
  })

  it('a traded-away pick moves the keeper to the next pick the team owns', () => {
    const out = placeTeamKeepers(rules({ sameRoundRule: 'player_chooses' }), [{ playerId: 'a', costRound: 5 }], { totalRounds: 15, ownedRounds: [1, 2, 3, 6, 7] })
    expect(out.placed[0]).toMatchObject({ round: 3, movedBecause: 'pick_traded' })
  })

  it('no pick left in that direction refuses the keeper', () => {
    const out = placeTeamKeepers(rules({ sameRoundRule: 'lose_round_before' }), [{ playerId: 'a', costRound: 1 }, { playerId: 'b', costRound: 1 }], opts)
    expect(out.refused).toEqual([{ playerId: 'b', costRound: 1, reason: 'no_pick_available' }])
  })
})

describe('keeper rule settings gate', () => {
  beforeEach(() => mockEvaluate.mockReset())
  const cur = { keeperConflictRule: 'player_chooses' }

  it('free: cost shifts, waiver round, floor and the refusing same-round rules', async () => {
    mockEvaluate.mockResolvedValue({ allowed: false })
    expect(await keeperRuleSettingsRefusal('u', { keeperRoundPenalty: -1 }, cur)).toBeNull()
    expect(await keeperRuleSettingsRefusal('u', { settingsMerge: { keeper_waiver_cost_round: 10, keeper_min_cost_round: null } }, cur)).toBeNull()
    expect(await keeperRuleSettingsRefusal('u', { keeperConflictRule: 'reject_both' }, cur)).toBeNull()
    expect(mockEvaluate).not.toHaveBeenCalled()
  })

  it('moving same-round keepers needs AF Commissioner, unless it was already set', async () => {
    mockEvaluate.mockResolvedValue({ allowed: false })
    expect(await keeperRuleSettingsRefusal('u', { keeperConflictRule: 'lose_round_before' }, cur)).toMatchObject({ status: 403 })
    expect(await keeperRuleSettingsRefusal('u', { keeperConflictRule: 'lose_round_before' }, { keeperConflictRule: 'lose_round_before' })).toBeNull()
    mockEvaluate.mockResolvedValue({ allowed: true })
    expect(await keeperRuleSettingsRefusal('u', { keeperConflictRule: 'lose_round_after' }, cur)).toBeNull()
  })

  it('rejects bad values', async () => {
    expect(await keeperRuleSettingsRefusal('u', { keeperRoundPenalty: 9 }, cur)).toMatchObject({ status: 400 })
    expect(await keeperRuleSettingsRefusal('u', { settingsMerge: { keeper_min_cost_round: 0 } }, cur)).toMatchObject({ status: 400 })
    expect(await keeperRuleSettingsRefusal('u', { keeperConflictRule: 'coin_flip' }, cur)).toMatchObject({ status: 400 })
  })
})
