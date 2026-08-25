import { describe, expect, it } from 'vitest'

import { starterNeedsFromSlots } from '@/lib/core-app/slotEligibility'
import { buildTeamProfile } from '@/lib/trade-value/teamProfile'

/**
 * Roster need, read from the league instead of assumed.
 *
 * Two hardcoded tables answered this question and did not agree with each other —
 * `trade-value/teamProfile` said WR 2, `engine/team-context-adjustment` said WR 3 — and both
 * described a standard redraft league. In superflex that makes the position which decides the
 * format invisible, and in an IDP league the entire defence is invisible.
 */

const STANDARD = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN']
const SUPERFLEX = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN']
const IDP = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'LB', 'LB', 'DL', 'DB', 'IDP_FLEX', 'BN']

const base = {
  rosterId: 'r1',
  wins: 6,
  losses: 6,
  pointsFor: 1000,
  leagueSize: 12,
}

describe('starterNeedsFromSlots', () => {
  it('reads a standard league off its own slots', () => {
    const s = starterNeedsFromSlots(STANDARD)
    expect(s.needs).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 })
    expect(s.flex).toBe(1)
    expect(s.superflex).toBe(false)
  })

  it('counts flex without pretending to know which position fills it', () => {
    /*
     * A flex is a requirement without an address. Splitting it across positions would invent a
     * per-position number the roster never asked for — which is what the hardcoded tables were
     * effectively doing by baking a guess into WR.
     */
    const s = starterNeedsFromSlots(['QB', 'FLEX', 'FLEX', 'WRRB_FLEX'])
    expect(s.flex).toBe(3)
    expect(s.needs.RB).toBeUndefined()
    expect(s.needs.WR).toBeUndefined()
  })

  it('recognises superflex, and a second dedicated QB slot as the same thing', () => {
    expect(starterNeedsFromSlots(SUPERFLEX).superflex).toBe(true)
    expect(starterNeedsFromSlots(['QB', 'QB', 'RB', 'WR']).superflex).toBe(true)
    expect(starterNeedsFromSlots(STANDARD).superflex).toBe(false)
  })

  it('collapses specific defensive slots onto the group that fills them', () => {
    const s = starterNeedsFromSlots(['DE', 'DT', 'CB', 'S', 'LB', 'LB'])
    expect(s.needs).toEqual({ DL: 2, DB: 2, LB: 2 })
  })

  it('survives absent or unrecognised slots rather than throwing', () => {
    expect(starterNeedsFromSlots(null).flex).toBe(0)
    expect(starterNeedsFromSlots(['', 'NOT_A_SLOT', 'BN']).needs).toEqual({})
  })
})

describe('buildTeamProfile — the need is the league’s, not a default', () => {
  it('flags a one-QB roster as weak in superflex, which the hardcoded table never did', () => {
    /*
     * THE DEFECT. One quarterback satisfies the standard assumption of QB: 1, so a superflex
     * team was reported healthy at the position that decides its format.
     */
    const positions = ['QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE']

    const assumed = buildTeamProfile({ ...base, positions })
    expect(assumed.weakPositions).not.toContain('QB')

    const actual = buildTeamProfile({ ...base, positions, rosterSlots: SUPERFLEX })
    expect(actual.weakPositions).toContain('QB')
    expect(actual.depthIssues).toBe(true)
  })

  it('sees a defensive hole that the offensive-only table could not', () => {
    const positions = ['QB', 'RB', 'WR', 'TE', 'LB']
    const assumed = buildTeamProfile({ ...base, positions })
    // The offensive-only table sees thin RB and WR rooms and nothing else — the defence is
    // simply not a category it has.
    expect(assumed.weakPositions).not.toContain('LB')
    expect(assumed.weakPositions).not.toContain('DL')
    expect(assumed.weakPositions).not.toContain('DB')

    const actual = buildTeamProfile({ ...base, positions, rosterSlots: IDP })
    // Two LB slots with one linebacker, and nothing at all on the line or in the secondary.
    expect(actual.weakPositions).toEqual(expect.arrayContaining(['LB', 'DL', 'DB']))
  })

  it('does not invent a need the league never stated', () => {
    // No kicker slot in this league, so an empty kicker room is not a hole.
    const noKicker = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN']
    const p = buildTeamProfile({
      ...base,
      positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'],
      rosterSlots: noKicker,
    })
    expect(p.weakPositions).toEqual([])
  })

  it('is byte-identical to the old behaviour when no slots are supplied', () => {
    /*
     * Three callers do not pass slots yet. Their numbers must not move underneath them.
     */
    const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE']
    const p = buildTeamProfile({ ...base, positions })
    expect(p.weakPositions).toEqual([])
    expect(p.depthIssues).toBe(false)

    // One WR against the assumed need of two is weak, as it always was.
    const thin = buildTeamProfile({ ...base, positions: ['QB', 'WR'] })
    expect(thin.weakPositions).toEqual(['RB', 'WR', 'TE'])
  })

  it('still reports genuine strength, measured against the real requirement', () => {
    const stacked = buildTeamProfile({
      ...base,
      positions: ['QB', 'QB', 'QB', 'QB', 'RB', 'WR', 'TE'],
      rosterSlots: SUPERFLEX,
    })
    // Four quarterbacks against a need of two is a surplus, not a hole.
    expect(stacked.strongPositions).toContain('QB')
    expect(stacked.weakPositions).not.toContain('QB')
  })
})
