// @vitest-environment node
/**
 * 🛑 THE DIMENSION THAT EXPRESSES "THIS FILLS YOUR BIGGEST HOLE" SCORED A REAL HOLE BELOW NO HOLE.
 *
 * `computeNeedFit` read `normalize(gap, 500, 8000) * 0.6`. But a slot gap is a shortfall against one
 * full replacement starter, and a league median sits near 3,000 — so every real gap landed in the
 * bottom fifth of a scale built for 8,000 and came out near zero, while the `else` branch handed a
 * flat 20 to a position with no identified need at all.
 *
 * Measured on a 12-team fixture whose league median is 3,000: a genuine 1,000-point hole scored 5
 * and a 1,500-point hole scored 10, against 20 for a position that was perfectly fine. Identifying
 * a need made the candidate who fills it look FOUR TIMES WORSE than if the need had not been found.
 *
 * ⚠ AND IT IS WHY NO WAIVER ANSWER COULD SAY "ADD". The usable range was 5..34 on a dimension
 * weighted a quarter of the composite, so the need signal moved the final score by about three
 * points — in the wrong direction. "Add" needs 45. Before this fix a 2,600-value back filling the
 * weakest slot in the lineup scored 30 and read "Monitor"; on the rebuild goal no value whatsoever
 * could reach "Add", so three of the six labels were unreachable.
 *
 * The fix changes no threshold. It scales the gap against the LEAGUE'S OWN MEDIAN — which is what
 * the gap is a shortfall of — and starts a measured need at the categorical constant this same
 * function already uses for `ctx.needs` membership, because a computed slot gap is the stronger
 * evidence of the two.
 */
import { describe, expect, it } from 'vitest'

import { suggestWaiverPickups } from '@/lib/waiver-ai-engine/suggest'
import { computeTeamNeeds } from '@/lib/waiver-engine/team-needs'
import type { WaiverAIServiceInput } from '@/lib/waiver-ai-engine'

const P = (id: string, position: string, value: number, slot: 'starter' | 'bench' = 'starter') => ({
  id, name: id, position, team: 'DAL', slot, age: 26, value,
})

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN']

/** Every rival identical, so the league median at every position is exactly `median`. */
const rivals = (median: number) =>
  Array.from({ length: 11 }, (_, i) => ({
    players: [
      P(`r${i}-qb`, 'QB', median), P(`r${i}-rb`, 'RB', median), P(`r${i}-rb2`, 'RB', median),
      P(`r${i}-wr`, 'WR', median), P(`r${i}-wr2`, 'WR', median), P(`r${i}-te`, 'TE', median),
      P(`r${i}-flex`, 'WR', median),
    ],
  }))

/**
 * My lineup at league par except the second back, who is worth `rb2`.
 *
 * ⚠ ONE HOLE ONLY, DELIBERATELY. A second weak slot changes which need ranks first, and the rank
 * multiplier would then move the number for a reason this test is not about.
 */
function scenario(rb2: number, candidatePosition: string, candidateValue = 2500, median = 3000) {
  const roster = [
    P('my-qb', 'QB', median), P('my-rb1', 'RB', median), P('my-rb2', 'RB', rb2),
    P('my-wr1', 'WR', median), P('my-wr2', 'WR', median), P('my-te', 'TE', median),
    P('my-flex', 'WR', median), P('bench', 'RB', 500, 'bench'),
  ]
  const allLeagueRosters = [{ players: roster }, ...rivals(median)]
  const input = {
    sport: 'NFL',
    leagueId: 'L',
    leagueSettings: { numTeams: 12, isSF: false, isTEP: false, isDynasty: false, faabBudget: 100, faabRemaining: 60 },
    roster,
    rosterPositions: SLOTS,
    allLeagueRosters,
    currentWeek: 5,
    goal: 'win-now',
    maxResults: 5,
    availablePlayers: [{ id: 'wire', name: 'Wire', position: candidatePosition, team: 'SEA', age: 26, value: candidateValue }],
    teamNeeds: computeTeamNeeds(roster, SLOTS, allLeagueRosters, 5),
  } as unknown as WaiverAIServiceInput
  const top = suggestWaiverPickups(input).suggestions[0]
  return { needFit: top?.dimensions.needFit ?? -1, composite: top?.compositeScore ?? -1, recommendation: top?.recommendation }
}

/** A position with no weak slot — the `else` branch, and the bar the measured branch must clear. */
const NO_NEED = scenario(3000, 'TE').needFit

describe('🛑 a measured need outranks no need at all', () => {
  it('🛑 the inversion is gone — a real hole beats a position that is fine', () => {
    /* These two scored 5 and 10 against 20 before the fix. That is the whole bug. */
    expect(scenario(2000, 'RB').needFit).toBeGreaterThan(NO_NEED)
    expect(scenario(1500, 'RB').needFit).toBeGreaterThan(NO_NEED)
  })

  it('a position with no identified need is unchanged, so this is not blanket inflation', () => {
    expect(NO_NEED).toBe(20)
  })

  it('the score rises as the hole widens', () => {
    const small = scenario(2000, 'RB').needFit
    const mid = scenario(1500, 'RB').needFit
    const big = scenario(1000, 'RB').needFit
    expect(small).toBeLessThan(mid)
    expect(mid).toBeLessThan(big)
  })

  it('⚠ the scale is the LEAGUE’s own median, not a constant', () => {
    /*
     * The same 1,500-point shortfall is most of a replacement in a shallow league and half of one in
     * a rich league, so it must not score the same. The old constant 8,000 made both negligible.
     */
    const shallow = scenario(500, 'RB', 2500, 2000).needFit
    const rich = scenario(3500, 'RB', 2500, 5000).needFit
    /*
     * ⚠ A MARGIN, NOT JUST AN ORDERING. Under the old constant scale both sides computed the same
     * slot score and this still passed, by a point or two of unrelated depth bonus — an assertion
     * that goes green against the very bug it names is not evidence.
     */
    expect(shallow - rich).toBeGreaterThanOrEqual(20)
  })
})

describe('🛑 and so the answer can finally be “Add”', () => {
  it('🛑 a realistic wire player who fills the weakest slot is an Add, not a Monitor', () => {
    /*
     * 2,600 against a 3,000 median is an ordinary waiver pickup, not a superstar. Before the fix
     * this read "Monitor" on every goal, and "Add" required roughly 5,000 on win-now and 8,000 on
     * balanced — values a real wire does not hold.
     */
    const r = scenario(700, 'RB', 2600)
    expect(r.composite).toBeGreaterThanOrEqual(45)
    expect(['Add', 'Strong Add', 'Must Add']).toContain(r.recommendation)
  })

  it('⚠ and the same player at a position I do not need still reads Monitor', () => {
    /* The label has to discriminate, or making it reachable would just make it meaningless. */
    const r = scenario(3000, 'TE', 2600)
    expect(r.recommendation).toBe('Monitor')
  })
})
