import { describe, expect, it } from 'vitest'

import { assessContention, postureNote } from '@/lib/trade-intel/contention'
import { pickInflationWarning, projectPickSlot } from '@/lib/trade-intel/pickOutlook'

/**
 * The scenario these exist for: week 10, a 3-7 manager sends Josh Allen out for
 * two flex starters, a backup quarterback and two future firsts. A grader that
 * prices the assets and stops tells that manager they lost. They did not — they
 * did the correct thing, and the firsts coming back are worth LESS than a chart
 * says because they come from the team that just got Josh Allen.
 */

function table(records: Array<[string, number, number]>) {
  return records.map(([teamId, wins, losses]) => ({ teamId, wins, losses, ties: 0 }))
}

/** 12 teams, best first: 9-1 down to 2-8. */
const STANDINGS = table([
  ['a', 9, 1],
  ['b', 8, 2],
  ['c', 7, 3],
  ['d', 7, 3],
  ['e', 6, 4],
  ['f', 6, 4],
  ['g', 5, 5],
  ['h', 5, 5],
  ['i', 4, 6],
  ['j', 3, 7],
  ['k', 3, 7],
  ['l', 2, 8],
])

describe('assessContention', () => {
  it('a 3-7 team in week 11 of a 14-week season is selling', () => {
    const s = assessContention({
      standings: STANDINGS,
      teamId: 'j',
      playoffSpots: 6,
      seasonWeeks: 14,
      currentWeek: 11,
    })!
    expect(s.posture).toBe('selling')
  })

  it('the 9-1 team is contending', () => {
    const s = assessContention({
      standings: STANDINGS,
      teamId: 'a',
      playoffSpots: 6,
      seasonWeeks: 14,
      currentWeek: 11,
    })!
    expect(s.posture).toBe('contending')
  })

  it('⚠ measures against the CUT LINE, not the team immediately above', () => {
    /*
     * You do not need to pass the team ahead of you — you need to pass whoever
     * holds the final spot. Team g is 5-5, one game behind the 6-4 team holding
     * the sixth seed, and that is the comparison that matters.
     */
    const s = assessContention({
      standings: STANDINGS,
      teamId: 'g',
      playoffSpots: 6,
      seasonWeeks: 14,
      currentWeek: 11,
    })!
    expect(s.gamesBackOfLine).toBe(1)
    expect(s.posture).toBe('bubble')
  })

  it('⚠ mathematically out is a FACT, and the strongest sell signal there is', () => {
    // 2-8 with three to play, four back of the line: winning out cannot get
    // there. This branch is arithmetic, not judgement.
    const s = assessContention({
      standings: STANDINGS,
      teamId: 'l',
      playoffSpots: 6,
      seasonWeeks: 13,
      currentWeek: 11,
    })!
    expect(s.posture).toBe('selling')
    expect(s.basis).toContain('cannot get there')
  })

  it('⚠ withholds a posture when the league never said how many teams qualify', () => {
    // Without a cut line nobody is on the bubble, and guessing six would invent
    // a playoff race for a league that may not have one.
    const s = assessContention({
      standings: STANDINGS,
      teamId: 'g',
      playoffSpots: null,
      seasonWeeks: 14,
      currentWeek: 11,
    })!
    expect(s.posture).toBe('unknown')
    expect(s.gamesBackOfLine).toBeNull()
  })
})

describe('postureNote', () => {
  const selling = assessContention({
    standings: STANDINGS,
    teamId: 'j',
    playoffSpots: 6,
    seasonWeeks: 14,
    currentWeek: 11,
  })!
  const bubble = assessContention({
    standings: STANDINGS,
    teamId: 'g',
    playoffSpots: 6,
    seasonWeeks: 14,
    currentWeek: 11,
  })!

  it('⚠ refuses to grade a correct rebuild as a loss', () => {
    /*
     * The 3-7 manager sending a quarterback out for picks is doing the right
     * thing. An engine that prices the assets and stops tells them otherwise.
     */
    const note = postureNote({ state: selling, futureLean: 1 })!
    expect(note).toContain('right shape of deal')
  })

  it('says buying is a mistake for a team already out', () => {
    expect(postureNote({ state: selling, futureLean: -1 })).toContain('already gone')
  })

  it('⚠ NAMES the bubble instead of resolving it', () => {
    /*
     * At 5-5 with the cut line one game away, either decision can end a season.
     * That is a genuine dilemma and confidently telling them to sell would be
     * inventing certainty nobody has.
     */
    const note = postureNote({ state: bubble, futureLean: 1 })!
    expect(note).toContain('no right answer')
  })

  it('says nothing when the deal does not lean either way', () => {
    expect(postureNote({ state: selling, futureLean: 0 })).toBeNull()
  })
})

describe('projectPickSlot: a first is not a first', () => {
  it('⚠ a pick from a contender lands late, not in the middle', () => {
    /*
     * The whole point. The team that just traded FOR Josh Allen is 3rd of 12;
     * their first is near the back of the round, and pricing it as a middle pick
     * hands them a discount on every pick they send out.
     */
    const p = projectPickSlot({
      season: 2027,
      round: 1,
      currentSeason: 2026,
      senderRank: 3,
      teamCount: 12,
    })
    expect(p.projectedSlot).toBeGreaterThan(6.5)
    expect(p.isRoundAverage).toBe(false)
    expect(p.basis).toContain('reverse-standings')
  })

  it('a pick from a bad team lands early', () => {
    const p = projectPickSlot({
      season: 2027,
      round: 1,
      currentSeason: 2026,
      senderRank: 11,
      teamCount: 12,
    })
    expect(p.projectedSlot).toBeLessThan(6.5)
  })

  it('⚠ the signal decays, and by the third year it IS the middle', () => {
    /*
     * Today's standings say a lot about next spring and very little about the
     * draft after that. Carrying full confidence three years out would be the
     * most confident wrong number in the product.
     */
    const near = projectPickSlot({
      season: 2027,
      round: 1,
      currentSeason: 2026,
      senderRank: 1,
      teamCount: 12,
    })
    const far = projectPickSlot({
      season: 2030,
      round: 1,
      currentSeason: 2026,
      senderRank: 1,
      teamCount: 12,
    })
    expect(near.standingWeight).toBeGreaterThan(far.standingWeight)
    expect(far.isRoundAverage).toBe(true)
    expect(far.projectedSlot).toBe(7)
  })

  it('⚠ an unidentified sender is priced as a middle pick and says so', () => {
    const p = projectPickSlot({
      season: 2027,
      round: 1,
      currentSeason: 2026,
      senderRank: null,
      teamCount: 12,
    })
    expect(p.isRoundAverage).toBe(true)
    expect(p.basis).toContain('cannot tell which team')
  })
})

describe('pickInflationWarning', () => {
  it('⚠ states the second-order effect rather than modelling it', () => {
    /*
     * A star arriving makes that team better, which pushes their pick later
     * still. How much later is not measurable from anything we hold, so the
     * honest move is direction plus a manager's judgement.
     */
    const w = pickInflationWarning({ senderIsAcquiringStar: true, season: 2027, round: 1 })!
    expect(w).toContain('lands later')
  })

  it('says nothing when the pick is unrelated to the star', () => {
    expect(pickInflationWarning({ senderIsAcquiringStar: false, season: 2027, round: 1 })).toBeNull()
  })
})
