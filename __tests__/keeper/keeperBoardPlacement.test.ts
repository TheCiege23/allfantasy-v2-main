import { describe, expect, it } from 'vitest'

import { isWaiverCostLabel, keeperCostRound, readWaiverStack, stackWaiverKeeperCosts, type KeeperRules } from '@/lib/keeper/keeperRules'
import { keeperBoardDirection, ownedOwnRounds, ownedPicks, placeKeepersOnBoard, type KeeperForBoard } from '@/lib/keeper/keeperBoardPlacement'
import { validateRosterKeeperSelections } from '@/lib/live-draft-engine/keeper/KeeperRuleEngine'
import { buildKeeperLocks } from '@/lib/live-draft-engine/keeper/KeeperDraftOrder'

const rules = (over: Partial<KeeperRules> = {}): KeeperRules => ({
  costSystem: 'round_based',
  roundsEarlier: 1,
  inflationPerYear: 1,
  waiverCostRound: null,
  minCostRound: null,
  sameRoundRule: 'player_chooses',
  ...over,
})

const slotOrder = [
  { slot: 1, rosterId: 'A', displayName: 'Alpha' },
  { slot: 2, rosterId: 'B', displayName: 'Bravo' },
  { slot: 3, rosterId: 'C', displayName: 'Charlie' },
]
const shape = (tradedPicks: { round: number; originalRosterId: string; newRosterId: string }[] = [], rounds = 6) => ({
  slotOrder,
  rounds,
  tradedPicks: tradedPicks.map((t) => ({ ...t, previousOwnerName: 'x', newOwnerName: 'y' })),
})
const k = (rosterId: string, playerName: string, costRound: number): KeeperForBoard => ({
  rosterId, playerId: `id-${playerName}`, playerName, position: 'RB', team: 'KC', costRound,
})

describe('keeper cost round — the commissioner’s rule (same / 1 earlier / 1 later)', () => {
  const total = { yearsKept: 0, totalRounds: 15 }
  it('drafted R6: same round → R6, 1 earlier → R5, 1 later → R7', () => {
    expect(keeperCostRound(rules({ roundsEarlier: 0 }), { lastRound: 6, ...total })).toMatchObject({ ok: true, costRound: 6 })
    expect(keeperCostRound(rules({ roundsEarlier: 1 }), { lastRound: 6, ...total })).toMatchObject({ ok: true, costRound: 5 })
    expect(keeperCostRound(rules({ roundsEarlier: -1 }), { lastRound: 6, ...total })).toMatchObject({ ok: true, costRound: 7 })
  })
  it('1 earlier from Round 1 stays Round 1; 1 later past the last round stays the last round', () => {
    expect(keeperCostRound(rules({ roundsEarlier: 1 }), { lastRound: 1, ...total })).toMatchObject({ costRound: 1 })
    expect(keeperCostRound(rules({ roundsEarlier: -1 }), { lastRound: 15, ...total })).toMatchObject({ costRound: 15 })
  })
  it('a player nobody drafted (waiver / FA) costs the last round, or the commissioner’s fixed round', () => {
    expect(keeperCostRound(rules(), { lastRound: null, ...total })).toMatchObject({ costRound: 15, basis: 'waiver' })
    expect(keeperCostRound(rules({ waiverCostRound: 10 }), { lastRound: null, ...total })).toMatchObject({ costRound: 10, basis: 'waiver' })
  })
  it('multi-year: the rule applies to last season’s COST round (a kept player’s lastRound is his keeper round)', () => {
    // Drafted R8, kept at R7 last season under "1 earlier" → R6 now. Inflation adds per year kept.
    expect(keeperCostRound(rules({ roundsEarlier: 1 }), { lastRound: 7, yearsKept: 1, totalRounds: 15 })).toMatchObject({ costRound: 6 })
    expect(keeperCostRound(rules({ costSystem: 'inflation', roundsEarlier: 1, inflationPerYear: 1 }), { lastRound: 7, yearsKept: 1, totalRounds: 15 })).toMatchObject({ costRound: 5 })
  })
})

describe('automatic keeper placement on the draft board', () => {
  it('each keeper takes his own team’s pick in the round he costs', () => {
    const out = placeKeepersOnBoard(rules(), [k('A', 'Ace', 3), k('B', 'Bo', 5)], shape())
    expect(out.flagged).toEqual([])
    expect(out.selections.map((s) => [s.rosterId, s.playerName, s.roundCost, s.placementNote ?? null])).toEqual([
      ['A', 'Ace', 3, null],
      ['B', 'Bo', 5, null],
    ])
  })

  it('snake vs linear: the lock is the team’s actual pick in that round', () => {
    const { selections } = placeKeepersOnBoard(rules(), [k('A', 'Ace', 2)], shape())
    const snake = buildKeeperLocks(selections, slotOrder, [], 3, 6, 'snake', false)
    const linear = buildKeeperLocks(selections, slotOrder, [], 3, 6, 'linear', false)
    expect(snake[0]).toMatchObject({ round: 2, slot: 1, overall: 6, rosterId: 'A' })
    expect(linear[0]).toMatchObject({ round: 2, slot: 1, overall: 4, rosterId: 'A' })
  })

  it('collision: the later keeper moves to the team’s next EARLIER open round by default', () => {
    expect(keeperBoardDirection(rules())).toBe('earlier')
    const out = placeKeepersOnBoard(rules(), [k('A', 'Ace', 5), k('A', 'Ash', 5)], shape())
    expect(out.selections.map((s) => [s.playerName, s.roundCost])).toEqual([['Ash', 4], ['Ace', 5]])
    expect(out.selections[0].placementNote).toBe('Round 4 (moved from Round 5: two keepers cost Round 5)')
  })

  it('collision with the league’s “round after” rule moves the later keeper to the next LATER round', () => {
    const out = placeKeepersOnBoard(rules({ sameRoundRule: 'lose_round_after' }), [k('A', 'Ace', 5), k('A', 'Ash', 5)], shape())
    expect(out.selections.map((s) => [s.playerName, s.roundCost])).toEqual([['Ace', 5], ['Ash', 6]])
  })

  it('traded pick: the keeper takes his team’s nearest owned pick and the board says why', () => {
    const traded = shape([{ round: 4, originalRosterId: 'A', newRosterId: 'B' }])
    expect(ownedOwnRounds('A', traded)).toEqual([1, 2, 3, 5, 6])
    const out = placeKeepersOnBoard(rules(), [k('A', 'Ace', 4)], traded)
    expect(out.selections[0]).toMatchObject({ roundCost: 3, costRound: 4, placementNote: 'Round 3 (moved from Round 4: Round 4 pick was traded)' })
    // and the lock stays on team A's own pick — never the team that bought the R4 pick
    expect(buildKeeperLocks(out.selections, slotOrder, traded.tradedPicks, 3, 6, 'snake', false)[0]).toMatchObject({ round: 3, rosterId: 'A' })
  })

  it('traded pick with nothing earlier owned falls back to the nearest later owned pick', () => {
    const traded = shape([{ round: 1, originalRosterId: 'A', newRosterId: 'C' }])
    const out = placeKeepersOnBoard(rules(), [k('A', 'Ace', 1)], traded)
    expect(out.flagged).toEqual([])
    expect(out.selections[0]).toMatchObject({ roundCost: 2 })
    expect(out.selections[0].placementNote).toMatch(/moved from Round 1/)
  })

  it('no pick left: the keeper is flagged for the commissioner, never dropped silently', () => {
    const allTraded = shape([1, 2].map((round) => ({ round, originalRosterId: 'A', newRosterId: 'B' })), 2)
    const out = placeKeepersOnBoard(rules(), [k('A', 'Ace', 1)], allTraded)
    expect(out.selections).toEqual([])
    expect(out.flagged).toEqual([expect.objectContaining({ playerName: 'Ace', reason: 'no_pick_available', costRound: 1 })])
  })

  it('a round the commissioner already filled by hand is not taken', () => {
    const out = placeKeepersOnBoard(rules(), [k('A', 'Ace', 3)], shape(), new Map([['A', new Set(['3:1'])]]))
    expect(out.selections[0]).toMatchObject({ roundCost: 2 })
  })

  it('a team not seated on the board is flagged', () => {
    const out = placeKeepersOnBoard(rules(), [k('Z', 'Zed', 3)], shape())
    expect(out.flagged[0]).toMatchObject({ rosterId: 'Z', reason: 'no_pick_available' })
  })
})

describe('undrafted (waiver / FA) keepers stack from the last round — owner, 2026-11-27', () => {
  const w = (playerId: string, costRound = 15) => ({ playerId, costRound, waiver: true })
  const d = (playerId: string, costRound: number) => ({ playerId, costRound, waiver: false })
  const rounds = (list: { playerId: string; costRound: number }[]) => list.map((k) => [k.playerId, k.costRound])

  it('one pickup costs the last round, labelled as not drafted', () => {
    expect(keeperCostRound(rules(), { lastRound: null, yearsKept: 0, totalRounds: 15 })).toMatchObject({ costRound: 15, label: 'Round 15 (not drafted)' })
    expect(isWaiverCostLabel('Round 15 (not drafted)')).toBe(true)
    expect(isWaiverCostLabel('Round 15')).toBe(false)
    expect(rounds(stackWaiverKeeperCosts([w('fa1')], { totalRounds: 15 }))).toEqual([['fa1', 15]])
  })

  it('two pickups: the first (in the order listed) costs the last round, the second last - 1; a third last - 2', () => {
    expect(rounds(stackWaiverKeeperCosts([w('fa1'), w('fa2')], { totalRounds: 15 }))).toEqual([['fa1', 15], ['fa2', 14]])
    expect(rounds(stackWaiverKeeperCosts([w('fa2'), w('fa1'), w('fa3')], { totalRounds: 15 }))).toEqual([['fa2', 15], ['fa1', 14], ['fa3', 13]])
  })

  it('a stacked pickup that lands on a drafted keeper’s round moves to the next earlier free round', () => {
    expect(rounds(stackWaiverKeeperCosts([d('dr', 14), w('fa1'), w('fa2')], { totalRounds: 15 })))
      .toEqual([['dr', 14], ['fa1', 15], ['fa2', 13]])
    expect(rounds(stackWaiverKeeperCosts([d('dr', 15), w('fa1'), w('fa2')], { totalRounds: 15 })))
      .toEqual([['dr', 15], ['fa1', 14], ['fa2', 13]])
  })

  it('respects the commissioner’s fixed waiver round, and can be turned off', () => {
    expect(rounds(stackWaiverKeeperCosts([w('fa1', 10), w('fa2', 10)], { totalRounds: 15 }))).toEqual([['fa1', 10], ['fa2', 9]])
    expect(readWaiverStack({})).toBe(true)
    expect(readWaiverStack({ keeper_waiver_stack: false })).toBe(false)
  })
})

describe('automatic placement uses picks a team ACQUIRED, not only its own', () => {
  it('lists own and acquired picks; the latest trade of a pick wins', () => {
    const traded = shape([{ round: 4, originalRosterId: 'A', newRosterId: 'B' }, { round: 4, originalRosterId: 'C', newRosterId: 'A' }])
    expect(ownedPicks('A', traded).filter((p) => p.round === 4)).toEqual([{ round: 4, slot: 3, own: false, from: 'Charlie' }])
  })

  it('cost round traded away but held via trade: he takes the acquired pick, and the board says whose it was', () => {
    const traded = shape([{ round: 4, originalRosterId: 'A', newRosterId: 'B' }, { round: 4, originalRosterId: 'C', newRosterId: 'A' }])
    const out = placeKeepersOnBoard(rules(), [k('A', 'Ace', 4)], traded)
    expect(out.selections[0]).toMatchObject({ roundCost: 4, pickSlot: 3, placementNote: 'Round 4 (placed on pick acquired from Charlie)' })
    // snake round 4 runs 3→1: Charlie's slot-3 pick is the 10th overall, and the lock is TEAM A's
    expect(buildKeeperLocks(out.selections, slotOrder, traded.tradedPicks, 3, 6, 'snake', false)[0])
      .toMatchObject({ round: 4, slot: 3, overall: 10, rosterId: 'A', playerName: 'Ace' })
  })

  it('the nearest round counts acquired picks as owned', () => {
    const traded = shape([
      { round: 4, originalRosterId: 'A', newRosterId: 'C' },
      { round: 3, originalRosterId: 'A', newRosterId: 'C' },
      { round: 3, originalRosterId: 'B', newRosterId: 'A' },
    ])
    const out = placeKeepersOnBoard(rules(), [k('A', 'Ace', 4)], traded)
    expect(out.selections[0]).toMatchObject({ roundCost: 3, pickSlot: 2, placementNote: 'Round 3 (moved from Round 4: Round 4 pick was traded; pick acquired from Bravo)' })
  })

  it('own + acquired pick in one round hold two keepers there, and the board accepts both', () => {
    const traded = shape([{ round: 5, originalRosterId: 'B', newRosterId: 'A' }])
    const out = placeKeepersOnBoard(rules(), [k('A', 'Ace', 5), k('A', 'Ash', 5)], traded)
    expect(out.selections.map((s) => [s.playerName, s.roundCost, s.pickSlot ?? null])).toEqual([['Ace', 5, null], ['Ash', 5, 2]])
    expect(validateRosterKeeperSelections({ maxKeepers: 3 }, out.selections, 6)).toEqual({ valid: true })
    const locks = buildKeeperLocks(out.selections, slotOrder, traded.tradedPicks, 3, 6, 'snake', false)
    expect(locks.map((l) => [l.playerName, l.slot, l.rosterId])).toEqual([['Ace', 1, 'A'], ['Ash', 2, 'A']])
  })
})
