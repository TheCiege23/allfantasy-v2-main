/** Anti-tanking penalties: a warning first, then a lost pick — the commissioner's to change. */
import { describe, expect, it } from 'vitest'
import {
  choosePickToForfeit,
  DEFAULT_TANKING_PENALTY_POLICY,
  describePick,
  parseTankingPenaltyPolicyPatch,
  readTankingPenaltyPolicy,
  tankingStepForStrike,
} from '@/lib/integrity/tankingPenalties'

describe('policy', () => {
  it('defaults to on: one warning, then a 1st-round pick', () => {
    expect(readTankingPenaltyPolicy({})).toEqual({ enabled: true, penalty: 'forfeit_pick', pickAtStrike: 2, pickRound: 1, lotteryOddsCutPct: 50, faabPercent: 25 })
    expect(readTankingPenaltyPolicy({ integrity_tanking_penalties: { enabled: false, pickAtStrike: 3, pickRound: 2 } })).toMatchObject({ enabled: false, penalty: 'forfeit_pick', pickAtStrike: 3, pickRound: 2 })
    expect(readTankingPenaltyPolicy({ integrity_tanking_penalties: { pickAtStrike: 0, pickRound: 'x' } })).toEqual(DEFAULT_TANKING_PENALTY_POLICY)
  })

  it('rejects a bad edit rather than guessing', () => {
    expect(parseTankingPenaltyPolicyPatch({ pickRound: 2 })).toEqual({ pickRound: 2 })
    expect(parseTankingPenaltyPolicyPatch({ pickRound: 0 })).toBeNull()
    expect(parseTankingPenaltyPolicyPatch({ enabled: 'yes' })).toBeNull()
    expect(parseTankingPenaltyPolicyPatch({})).toBeNull()
  })
})

describe('tankingStepForStrike', () => {
  it('warns before the penalty strike, then takes a pick at and after it', () => {
    const p = DEFAULT_TANKING_PENALTY_POLICY
    expect(tankingStepForStrike(p, 1)).toEqual({ kind: 'warning', strike: 1, strikesLeft: 1 })
    expect(tankingStepForStrike(p, 2)).toEqual({ kind: 'forfeit_pick', strike: 2 })
    expect(tankingStepForStrike(p, 3)).toEqual({ kind: 'forfeit_pick', strike: 3 })
    expect(tankingStepForStrike({ ...p, pickAtStrike: 1 }, 1).kind).toBe('forfeit_pick')
    expect(tankingStepForStrike({ ...p, enabled: false }, 5)).toEqual({ kind: 'none' })
  })
})

describe('choosePickToForfeit', () => {
  const pick = (season: number, round: number, owner: string, original: string) => ({ season, round, ownerTeamId: owner, originalTeamId: original })
  const inventory = [pick(2027, 1, 'r1', 'r1'), pick(2027, 2, 'r1', 'r1'), pick(2028, 1, 'r1', 'r1'), pick(2027, 1, 'r1', 'r2'), pick(2027, 1, 'r2', 'r2')]

  it("takes the team's own pick in that round, from the nearest season", () => {
    expect(choosePickToForfeit(inventory, 'r1', 1)).toMatchObject({ season: 2027, round: 1, originalTeamId: 'r1' })
  })

  it('if that pick was traded away, takes the next season’s; failing that, a later-round pick it holds', () => {
    const traded = inventory.map((p) => (p.season === 2027 && p.round === 1 && p.originalTeamId === 'r1' ? { ...p, ownerTeamId: 'r3' } : p))
    expect(choosePickToForfeit(traded, 'r1', 1)).toMatchObject({ season: 2028, round: 1, originalTeamId: 'r1' })
    const noOwnFirsts = traded.filter((p) => !(p.originalTeamId === 'r1' && p.round === 1))
    expect(choosePickToForfeit(noOwnFirsts, 'r1', 1)).toMatchObject({ season: 2027, round: 2, originalTeamId: 'r1' })
  })

  it('never takes a pick the team does not hold, and returns null when it holds none', () => {
    expect(choosePickToForfeit(inventory, 'r9', 1)).toBeNull()
    expect(choosePickToForfeit(inventory, 'r2', 1)).toMatchObject({ ownerTeamId: 'r2', originalTeamId: 'r2' })
  })

  it('reads plainly', () => {
    expect(describePick({ season: 2027, round: 1 })).toBe('2027 1st-round pick')
    expect(describePick({ season: 2028, round: 3 })).toBe('2028 3rd-round pick')
  })
})
