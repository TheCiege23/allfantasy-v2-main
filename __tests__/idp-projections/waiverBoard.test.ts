import { describe, expect, it } from 'vitest'

import { bestLineup, type Scored } from '@/lib/waivers/waiverBoard'

/**
 * The waiver board this replaces read nothing at all: `waiverRecommendationService` selects
 * columns that do not exist and a model that is not in the schema, so every query throws and
 * `analyzeRosterNeeds` returns the literal `["WR_depth","RB_depth","TE_upgrade"]` to every
 * manager in every league.
 */

const p = (sleeperId: string, position: string, points: number): Scored => ({
  sleeperId,
  name: sleeperId,
  position,
  team: null,
  points,
})

const STANDARD = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']

describe('bestLineup', () => {
  it('fills dedicated slots before flex', () => {
    /*
     * THE ORDERING BUG THIS PREVENTS. Walking slots in roster order lets FLEX take the best
     * running back first, leaving a real RB slot empty and understating every candidate measured
     * against that lineup. Sorting by how many positions can fill a slot puts dedicated ahead of
     * flex without a hardcoded list of which slots are flexes.
     */
    const roster = [
      p('qb', 'QB', 20),
      p('rb1', 'RB', 18),
      p('rb2', 'RB', 12),
      p('wr1', 'WR', 15),
      p('wr2', 'WR', 11),
      p('te', 'TE', 8),
      p('rb3', 'RB', 10),
    ]
    const { total, used } = bestLineup(roster, STANDARD)
    // Every dedicated slot filled, and the flex takes the best leftover (rb3, 10).
    expect(used.size).toBe(7)
    expect(total).toBe(94)
  })

  it('leaves a slot empty rather than filling it with an ineligible player', () => {
    // A roster with no tight end scores six slots, not seven — the TE slot stays unfilled
    // instead of being handed to a receiver.
    const roster = [p('qb', 'QB', 20), p('wr1', 'WR', 15)]
    const { total, used } = bestLineup(roster, ['QB', 'TE', 'WR'])
    expect(used.size).toBe(2)
    expect(total).toBe(35)
  })

  it('handles IDP slots off the league’s own list', () => {
    const roster = [p('lb1', 'LB', 14), p('lb2', 'LB', 9), p('db', 'CB', 7), p('dl', 'DE', 11)]
    const { total } = bestLineup(roster, ['LB', 'LB', 'DB', 'DL'])
    expect(total).toBe(41)
  })
})

describe('marginal gain — the reason this is not a "best available" list', () => {
  const roster = [
    p('qb', 'QB', 20),
    p('rb1', 'RB', 18),
    p('rb2', 'RB', 17),
    p('wr1', 'WR', 16),
    p('wr2', 'WR', 15),
    p('te', 'TE', 10),
    p('rb3', 'RB', 14),
  ]
  const base = bestLineup(roster, STANDARD).total

  it('values a big name at nothing when he would not crack the lineup', () => {
    /*
     * A 13-point running back behind three better ones adds zero. Ranking by raw projection puts
     * him near the top of the board; ranking by what he changes puts him off it.
     */
    const gain = bestLineup([...roster, p('fa', 'RB', 13)], STANDARD).total - base
    expect(gain).toBe(0)
  })

  it('values a modest player highly when he fills a genuine hole', () => {
    // The same 13 points at tight end, where the incumbent scores 10, is worth 3.
    const gain = bestLineup([...roster, p('fa', 'TE', 13)], STANDARD).total - base
    expect(gain).toBe(3)
  })

  it('counts a flex upgrade, not just a starter upgrade', () => {
    // Better than rb3 (the flex) but not than rb1/rb2 — worth the flex difference alone.
    const gain = bestLineup([...roster, p('fa', 'WR', 15.5)], STANDARD).total - base
    expect(gain).toBeCloseTo(1.5, 2)
  })

  it('identifies who the add pushes out of the lineup', () => {
    const before = bestLineup(roster, STANDARD)
    const after = bestLineup([...roster, p('fa', 'TE', 13)], STANDARD)
    const dropped = roster.filter((x) => before.used.has(x.sleeperId) && !after.used.has(x.sleeperId))
    expect(dropped.map((d) => d.sleeperId)).toEqual(['te'])
  })
})
