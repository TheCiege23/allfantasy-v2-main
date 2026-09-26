/**
 * What a trade does to the lineup.
 *
 * The assertions that carry weight are the refusals: an unpriced traded asset must block rather
 * than produce a delta, an unknown slot must block rather than be skipped, and an unpriced bench
 * player must never be treated as scoring zero — each of those failures produces a plausible
 * NUMBER, which is far worse than an absent one.
 */
import { describe, expect, it } from 'vitest'

import {
  computeRosterImpact,
  fillLineup,
  type ImpactPlayer,
} from '@/lib/decision-os/trade/rosterImpact'

const p = (playerId: string, position: string, projectedPoints: number | null): ImpactPlayer => ({
  playerId,
  position,
  projectedPoints,
})

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN']

describe('fillLineup', () => {
  it('fills specific defensive positions before DB/DL and IDP flex without losing players', () => {
    const fill = fillLineup([
      p('corner', 'CB', 12), p('safety', 'SS', 11), p('tackle', 'DT', 10),
      p('edge', 'EDGE', 9), p('linebacker', 'LB', 8),
    ], ['IDP_FLEX', 'DB', 'DL', 'CB', 'DT'])
    expect(fill.unknownSlots).toEqual([])
    expect(fill.unfilledSlots).toEqual([])
    expect(fill.points).toBe(50)
    expect(fill.assignments).toContainEqual({ slot: 'CB', playerId: 'corner' })
    expect(fill.assignments).toContainEqual({ slot: 'DT', playerId: 'tackle' })
  })
  it('fills each dedicated slot with the best player at that position', () => {
    const fill = fillLineup(
      [p('qb1', 'QB', 20), p('rb1', 'RB', 15), p('rb2', 'RB', 10), p('wr1', 'WR', 12)],
      ['QB', 'RB', 'WR'],
    )
    expect(fill.starterIds.sort()).toEqual(['qb1', 'rb1', 'wr1'])
    expect(fill.points).toBe(47)
  })

  /**
   * 🛑 THE ORDERING PROPERTY. FLEX must be filled AFTER the dedicated slots, or a FLEX taking the
   * best player overall stops an RB slot being filled by the best RB. Here the greedy-by-points
   * order would put RB1 in FLEX and leave RB2 in the RB slot — same total by luck in some shapes,
   * different in others. This shape distinguishes them.
   */
  it('fills the restrictive slots before the flex, whatever order they are declared in', () => {
    /*
     * 🛑 FLEX IS DECLARED FIRST HERE ON PURPOSE, AND AN EARLIER VERSION OF THIS TEST DID NOT DO
     * THAT. With slots listed ['RB','WR','FLEX'] the declaration order is ALREADY restrictive-first,
     * so filling in declaration order gives the identical answer and the test proves nothing —
     * confirmed by mutation: replacing the restrictiveness sort with declaration order left the old
     * assertion green. Only a flex-first declaration separates them.
     *
     * declaration order:   FLEX->rb1(30), RB->rb2(5),  WR->wr1(20)  = 55
     * restrictive first:   RB->rb1(30),   WR->wr1(20), FLEX->wr2(19) = 69
     */
    const fill = fillLineup(
      [p('rb1', 'RB', 30), p('rb2', 'RB', 5), p('wr1', 'WR', 20), p('wr2', 'WR', 19)],
      ['FLEX', 'RB', 'WR'],
    )
    expect(fill.points).toBe(69)
    expect(fill.starterIds).toContain('wr2')
    expect(fill.starterIds).not.toContain('rb2')
  })

  it('lets a superflex take a quarterback', () => {
    const fill = fillLineup(
      [p('qb1', 'QB', 25), p('qb2', 'QB', 22), p('rb1', 'RB', 10)],
      ['QB', 'SUPER_FLEX'],
    )
    expect(fill.points).toBe(47)
    expect(fill.starterIds.sort()).toEqual(['qb1', 'qb2'])
  })

  /**
   * ⚠ AN UNPRICED PLAYER IS NOT A CANDIDATE AT ALL — he is not a zero.
   *
   * 🛑 TWO RB SLOTS, ON PURPOSE. With a single slot the two behaviours are indistinguishable: a
   * player scored 0 sorts last and loses the slot anyway, so the assertion passes either way.
   * Confirmed by mutation — coercing null to 0 left the previous single-slot version green. With a
   * slot to spare, coercion SEATS him and the empty slot disappears, which is the observable
   * difference: a lineup reporting a filled slot for a player nobody projects.
   */
  it('never treats an unpriced player as a zero-point candidate', () => {
    const fill = fillLineup([p('rb1', 'RB', null), p('rb2', 'RB', 8)], ['RB', 'RB'])
    expect(fill.starterIds).toEqual(['rb2'])
    expect(fill.points).toBe(8)
    expect(fill.unfilledSlots).toEqual(['RB'])
  })

  it('reports a slot it cannot fill rather than silently scoring it', () => {
    const fill = fillLineup([p('rb1', 'RB', 10)], ['RB', 'TE'])
    expect(fill.unfilledSlots).toEqual(['TE'])
    expect(fill.points).toBe(10)
  })

  /** 🛑 An unknown slot consumed by nobody would understate the total by a whole roster spot. */
  it('reports an unknown slot instead of skipping it quietly', () => {
    const fill = fillLineup([p('x', 'RB', 10)], ['RB', 'WEIRD_SLOT'])
    expect(fill.unknownSlots).toEqual(['WEIRD_SLOT'])
  })

  /*
   * Assignments are reported in the DECLARED slot order even though the fill runs restrictive-first,
   * so a reader can print the lineup the way the league lays it out.
   */
  it('reports who took which slot, in declared order', () => {
    const fill = fillLineup(
      [p('rb1', 'RB', 30), p('rb2', 'RB', 5), p('wr1', 'WR', 20), p('wr2', 'WR', 19)],
      ['FLEX', 'RB', 'WR', 'BN'],
    )
    expect(fill.assignments).toEqual([
      { slot: 'FLEX', playerId: 'wr2' },
      { slot: 'RB', playerId: 'rb1' },
      { slot: 'WR', playerId: 'wr1' },
    ])
    expect(fill.assignments.map((a) => a.playerId).sort()).toEqual([...fill.starterIds].sort())
  })

  it('never seats a bench or IR slot', () => {
    const fill = fillLineup([p('rb1', 'RB', 10), p('rb2', 'RB', 9)], ['RB', 'BN', 'IR'])
    expect(fill.starterIds).toEqual(['rb1'])
    expect(fill.points).toBe(10)
  })
})

describe('computeRosterImpact', () => {
  /*
   * NINE players against seven starting slots, so two sit on the bench and depth is observable.
   * The first version of this fixture had exactly as many players as slots -- every position had a
   * bench of zero, the depth assertions were vacuous, and two of them failed by reading a position
   * that was absent from the result entirely.
   */
  const roster = [
    p('qb1', 'QB', 20),
    p('rb1', 'RB', 15),
    p('rb2', 'RB', 12),
    p('rb3', 'RB', 6),
    p('rb4', 'RB', 4),
    p('wr1', 'WR', 14),
    p('wr2', 'WR', 11),
    p('wr3', 'WR', 3),
    p('te1', 'TE', 9),
  ]

  it('reports the starting-points delta of an upgrade', () => {
    const r = computeRosterImpact({
      roster,
      slots: SLOTS,
      incoming: [p('wr9', 'WR', 25)],
      outgoingPlayerIds: ['rb3'],
    })
    expect(r.blockedReason).toBeNull()
    // rb3 (6) was the FLEX; wr9 (25) replaces him there.
    expect(r.startingPointsDelta).toBe(19)
    expect(r.startingPointsAfter! - r.startingPointsBefore!).toBe(19)
  })

  it('reports a negative delta when the trade weakens the lineup', () => {
    const r = computeRosterImpact({
      roster,
      slots: SLOTS,
      incoming: [p('wr9', 'WR', 2)],
      outgoingPlayerIds: ['rb1'],
    })
    expect(r.startingPointsDelta).toBeLessThan(0)
  })

  /**
   * 🛑 THE REFUSAL THAT MATTERS MOST. If the thing being traded cannot be priced, the trade's
   * effect is unknowable and any delta would be fiction.
   */
  it('blocks when an incoming player has no projection', () => {
    const r = computeRosterImpact({
      roster,
      slots: SLOTS,
      incoming: [p('wr9', 'WR', null)],
      outgoingPlayerIds: ['rb3'],
    })
    expect(r.startingPointsDelta).toBeNull()
    expect(r.blockedReason).toMatch(/no projection/i)
  })

  it('blocks when an outgoing player has no projection', () => {
    const r = computeRosterImpact({
      roster: [...roster, p('rbX', 'RB', null)],
      slots: SLOTS,
      incoming: [p('wr9', 'WR', 10)],
      outgoingPlayerIds: ['rbX'],
    })
    expect(r.blockedReason).toMatch(/no projection/i)
  })

  /**
   * ⚠ A BENCH PLAYER NOBODY PROJECTS IS DISCLOSED, NOT BLOCKING. He changes the answer only if he
   * would have started, and the count lets a reader judge that.
   */
  it('discloses an unpriced bench player without blocking', () => {
    const r = computeRosterImpact({
      roster: [...roster, p('deep', 'WR', null)],
      slots: SLOTS,
      incoming: [p('wr9', 'WR', 25)],
      outgoingPlayerIds: ['rb3'],
    })
    expect(r.blockedReason).toBeNull()
    expect(r.unpricedExcluded).toBe(1)
  })

  /**
   * 🛑 A ROSTER THAT DOES NOT CONTAIN THE OUTGOING PLAYER MEANS THE TWO SIDES DISAGREE. Computing
   * anyway leaves him in the "after" lineup and understates the loss — a wrong number that looks
   * exactly like a right one.
   */
  it('blocks when an outgoing player is not on the roster', () => {
    const r = computeRosterImpact({
      roster,
      slots: SLOTS,
      incoming: [p('wr9', 'WR', 25)],
      outgoingPlayerIds: ['nobody'],
    })
    expect(r.blockedReason).toMatch(/not on this roster/i)
  })

  it('blocks on an unknown slot rather than under-counting the lineup', () => {
    const r = computeRosterImpact({
      roster,
      slots: ['QB', 'MYSTERY'],
      incoming: [],
      outgoingPlayerIds: [],
    })
    expect(r.blockedReason).toMatch(/MYSTERY/)
  })

  it('reports depth lost at the position that gave a player up', () => {
    const r = computeRosterImpact({
      roster,
      slots: SLOTS,
      incoming: [p('wr9', 'WR', 25)],
      outgoingPlayerIds: ['rb2'],
    })
    const rb = r.depth.find((d) => d.position === 'RB')!
    /*
     * 🛑 THE BENCH COUNT DOES NOT MOVE HERE, AND THAT IS THE POINT. rb3 slides out of FLEX into the
     * vacated RB slot, so the spare-body count is unchanged — while the roster genuinely holds one
     * fewer RB. An earlier version of this module reported only the bench and would have said "no
     * depth lost" about a trade that cost a body.
     */
    expect(rb.rosteredDelta).toBe(-1)
    expect(rb.benchBefore).toBe(rb.benchAfter)

    // And the position that gained one says so.
    const wr = r.depth.find((d) => d.position === 'WR')!
    expect(wr.rosteredDelta).toBe(1)
  })

  /** ⚠ Replacement level is the best BENCH player — what an injury actually falls back to. */
  it('reports replacement level from the bench, not from the starters', () => {
    const r = computeRosterImpact({
      roster,
      slots: SLOTS,
      incoming: [],
      outgoingPlayerIds: [],
    })
    const rb = r.replacement.find((x) => x.position === 'RB')!
    // rb1(15), rb2(12) fill RB/RB and rb3(6) takes FLEX, so rb4(4) is the best RB left on the bench.
    expect(rb.before).toBe(4)
    const qb = r.replacement.find((x) => x.position === 'QB')!
    // Only one QB, and he starts -- so there is nothing to fall back to, and that is NULL not 0.
    expect(qb.before).toBeNull()
  })

  it('a trade that touches nothing moves nothing', () => {
    const r = computeRosterImpact({ roster, slots: SLOTS, incoming: [], outgoingPlayerIds: [] })
    expect(r.startingPointsDelta).toBe(0)
    expect(r.blockedReason).toBeNull()
  })
})
