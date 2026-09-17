import { describe, expect, it } from 'vitest'

import { computeRosterImpact } from '@/lib/decision-os/trade/rosterImpact'
import {
  lineupImpactDirection,
  lineupImpactLine,
  summarizeRosterImpact,
} from '@/lib/decision-os/trade/rosterImpactSummary'

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN']

const roster = [
  { playerId: 'qb1', position: 'QB', projectedPoints: 20 },
  { playerId: 'rb1', position: 'RB', projectedPoints: 15 },
  { playerId: 'rb2', position: 'RB', projectedPoints: 11 },
  { playerId: 'rb3', position: 'RB', projectedPoints: 6 },
  { playerId: 'wr1', position: 'WR', projectedPoints: 14 },
  { playerId: 'wr2', position: 'WR', projectedPoints: 9 },
  { playerId: 'te1', position: 'TE', projectedPoints: 7 },
]

function impact(args: Parameters<typeof computeRosterImpact>[0]) {
  return { ...computeRosterImpact(args), unit: 'league_points_week' as const, week: 3 }
}

describe('summarizeRosterImpact', () => {
  it('keeps "not asked for" and "asked for, not produced" apart', () => {
    expect(summarizeRosterImpact(undefined)).toBeUndefined()
    expect(summarizeRosterImpact(null)).toBeNull()
  })

  it('keeps only the positions whose rostered count moves', () => {
    // RB out, WR in: RB count -1, WR count +1, QB/TE untouched.
    const s = summarizeRosterImpact(
      impact({
        roster,
        slots: SLOTS,
        incoming: [{ playerId: 'wrX', position: 'WR', projectedPoints: 13 }],
        outgoingPlayerIds: ['rb2'],
      }),
    )!
    expect(s.depthChanges).toEqual([
      { position: 'RB', rosteredBefore: 3, rosteredAfter: 2 },
      { position: 'WR', rosteredBefore: 2, rosteredAfter: 3 },
    ])
    expect(s.unit).toBe('league_points_week')
    expect(s.week).toBe(3)
    // Lineup before: QB20 RB15 RB11 WR14 WR9 TE7 FLEX(rb3 6) = 82
    // After: QB20 RB15 RB6 WR14 WR13 TE7 FLEX(wr2 9) = 84
    expect(s.startingPointsBefore).toBe(82)
    expect(s.startingPointsAfter).toBe(84)
    expect(s.startingPointsDelta).toBe(2)
  })

  it('passes a blocked reason through and carries no depth rows', () => {
    const s = summarizeRosterImpact(
      impact({
        roster,
        slots: SLOTS,
        incoming: [{ playerId: 'mystery', position: 'WR', projectedPoints: null }],
        outgoingPlayerIds: ['rb2'],
      }),
    )!
    expect(s.startingPointsDelta).toBeNull()
    expect(s.blockedReason).toMatch(/no projection/)
    expect(s.depthChanges).toEqual([])
  })
})

describe('lineupImpactLine', () => {
  const base = {
    unit: 'league_points_week' as const,
    week: 3 as number | null,
    startingPointsBefore: 80,
    startingPointsAfter: 83.24,
    startingPointsDelta: 3.24,
    blockedReason: null,
    unpricedExcluded: 0,
    depthChanges: [] as Array<{ position: string; rosteredBefore: number; rosteredAfter: number }>,
  }

  it('says nothing when impact was never requested', () => {
    expect(lineupImpactLine(undefined)).toBeNull()
  })

  it('still says something when impact was requested and could not be produced', () => {
    // Silence here would read as "no effect", which is a claim we cannot make.
    expect(lineupImpactLine(null)).toMatch(/unavailable/)
  })

  /*
   * 🛑 THE WEEK AND THE RULES ARE IN THE SENTENCE. The number is one week under the league's own
   * scoring; the line used to say "per game", which was a full-PPR season rate in every league.
   */
  it("states a gain for the named week, under the league's scoring", () => {
    expect(lineupImpactLine(base)).toBe("Your projected week 3 starting lineup gains 3.2 pts under your league's scoring.")
    expect(lineupImpactLine(base)).not.toMatch(/per game/)
  })

  it('still reads sensibly if a week was never known', () => {
    expect(lineupImpactLine({ ...base, week: null })).toBe(
      "Your projected starting lineup gains 3.2 pts under your league's scoring.",
    )
  })

  it('states a loss without a double sign', () => {
    const line = lineupImpactLine({ ...base, startingPointsAfter: 78, startingPointsDelta: -2 })
    expect(line).toBe("Your projected week 3 starting lineup loses 2.0 pts under your league's scoring.")
  })

  it('does not render rounding noise as a signed verdict', () => {
    const line = lineupImpactLine({ ...base, startingPointsDelta: 0.01 })
    expect(line).toMatch(/^No change to your projected week 3 starting lineup/)
    expect(line).not.toMatch(/\+0|0\.0/)
  })

  it('names depth changes with a real minus sign and discloses unprojected players', () => {
    const line = lineupImpactLine({
      ...base,
      unpricedExcluded: 2,
      depthChanges: [
        { position: 'RB', rosteredBefore: 3, rosteredAfter: 2 },
        { position: 'WR', rosteredBefore: 2, rosteredAfter: 3 },
      ],
    })
    expect(line).toBe(
      "Your projected week 3 starting lineup gains 3.2 pts under your league's scoring · roster RB −1, WR +1. 2 unprojected players not counted.",
    )
  })

  it('renders the blocked reason verbatim rather than a number', () => {
    const line = lineupImpactLine({
      ...base,
      startingPointsBefore: null,
      startingPointsAfter: null,
      startingPointsDelta: null,
      blockedReason: '1 traded player(s) have no projection under this league\'s scoring, so the lineup effect cannot be computed',
    })
    expect(line).toMatch(/^Lineup effect not computed: 1 traded player/)
    expect(line).not.toMatch(/pts under/)
  })
})

describe('lineupImpactDirection', () => {
  const s = (delta: number | null, blockedReason: string | null = null) => ({
    unit: 'league_points_week' as const,
    week: 3,
    startingPointsBefore: null,
    startingPointsAfter: null,
    startingPointsDelta: delta,
    blockedReason,
    unpricedExcluded: 0,
    depthChanges: [],
  })

  it('classifies every case, including the ones with no honest number', () => {
    expect(lineupImpactDirection(s(1.5))).toBe('up')
    expect(lineupImpactDirection(s(-1.5))).toBe('down')
    expect(lineupImpactDirection(s(0.02))).toBe('flat')
    expect(lineupImpactDirection(s(null))).toBe('unknown')
    expect(lineupImpactDirection(s(4, 'blocked'))).toBe('unknown')
    expect(lineupImpactDirection(null)).toBe('unknown')
    expect(lineupImpactDirection(undefined)).toBe('unknown')
  })
})
