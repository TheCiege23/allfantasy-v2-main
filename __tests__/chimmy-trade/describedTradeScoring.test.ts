/**
 * Chimmy's described-trade evaluator — how it decides a league's scarcity context.
 *
 * 🛑 THE BUG THIS PINS. `scoringContextFor` used to answer "is this 2QB?" with
 * `scoring.includes('2qb')` — a substring match on a free-text label. A league was 2QB if and only
 * if somebody had typed that exact string. Measured against eleven plausible spellings it missed
 * five, and each miss priced that league's quarterbacks at 0.85 instead of ~1.53.
 *
 * Roster slots cannot be misspelled, so they now win whenever they exist. The label path survives
 * only as a fallback for leagues that carry no slots.
 */

import { describe, expect, it } from 'vitest'
import { scoringContextFor, type DescribedTradeLeague } from '@/lib/chimmy-trade/describedTradeEvaluator'

const STANDARD_12 = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']
const TWO_QB = ['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']
const FOUR_QB = ['QB', 'QB', 'QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']

const league = (over: Partial<DescribedTradeLeague> = {}): DescribedTradeLeague => ({
  scoring: null,
  leagueVariant: null,
  ...over,
})

describe('slots win over the label', () => {
  it('reads 2QB from roster slots even when the label says nothing', () => {
    const ctx = scoringContextFor(league({
      scoring: 'Two QB Dynasty', // the label path MISSES this spelling entirely
      starters: TWO_QB,
      teamCount: 12,
    }))
    expect(ctx.shape).toBeTruthy()
    expect(ctx.shape!.dedicatedStarters.QB).toBe(2)
    // The boolean is deliberately left unset — the shape is the single description.
    expect(ctx.is2QB).toBeUndefined()
  })

  it('distinguishes a 4-QB league from a 2-QB one, which the boolean never could', () => {
    const two = scoringContextFor(league({ starters: TWO_QB, teamCount: 12 }))
    const four = scoringContextFor(league({ starters: FOUR_QB, teamCount: 12 }))
    expect(two.shape!.dedicatedStarters.QB).toBe(2)
    expect(four.shape!.dedicatedStarters.QB).toBe(4)
  })

  it('carries the real team count, so a 4-team and a 32-team league differ', () => {
    const small = scoringContextFor(league({ starters: STANDARD_12, teamCount: 4 }))
    const big = scoringContextFor(league({ starters: STANDARD_12, teamCount: 32 }))
    expect(small.shape!.teams).toBe(4)
    expect(big.shape!.teams).toBe(32)
  })

  it('prefers real scoring settings over the label', () => {
    const ctx = scoringContextFor(league({
      scoring: 'Standard',                       // label says standard…
      settings: { rec: 1, bonus_rec_te: 0.75 },  // …settings say full PPR + TEP
      starters: STANDARD_12,
      teamCount: 12,
    }))
    expect(ctx.scoringFormat).toBe('ppr')
    expect(ctx.tePremium).toBe(0.75)
  })

  it('lets the label fill a scoring fact the settings blob omits', () => {
    // Slots present (so shape wins for structure) but no scoring_settings at all.
    const ctx = scoringContextFor(league({
      scoring: '2026 32-Team Dynasty PPR TEP',
      starters: STANDARD_12,
      teamCount: 32,
      settings: null,
    }))
    expect(ctx.shape!.teams).toBe(32)
    expect(ctx.scoringFormat).toBe('ppr')  // from the label
    expect(ctx.tePremium).toBe(0.5)        // from the label's "TEP"
  })
})

describe('the label fallback, when there are no slots', () => {
  it('still detects the canonical spellings', () => {
    expect(scoringContextFor(league({ scoring: 'superflex_ppr' })).isSuperflex).toBe(true)
    expect(scoringContextFor(league({ scoring: 'ppr_2qb' })).is2QB).toBe(true)
    expect(scoringContextFor(league({ scoring: 'half_ppr' })).scoringFormat).toBe('half_ppr')
  })

  /**
   * REGRESSION GUARD, and it documents a KNOWN limitation rather than asserting correctness.
   * These spellings are missed by the label path. They are only reachable now when a league has
   * no roster slots at all, which is the honest floor — not something to fix by adding spellings.
   */
  it('still misses the spellings it always missed — which is why slots take priority', () => {
    for (const label of ['Two QB Dynasty', 'TWO-QB', 'QB2 Required', '2-QB', 'startTwoQb']) {
      expect(scoringContextFor(league({ scoring: label })).is2QB).toBe(false)
    }
  })

  it('is used when slots exist but the team count does not', () => {
    // A shape needs both; without a team count there is no leaguewide demand to compute.
    const ctx = scoringContextFor(league({ scoring: 'superflex', starters: STANDARD_12, teamCount: null }))
    expect(ctx.shape).toBeUndefined()
    expect(ctx.isSuperflex).toBe(true)
  })

  it('is used when the starters field is not a string array', () => {
    for (const starters of [null, undefined, 'QB,RB', 42, {}]) {
      const ctx = scoringContextFor(league({ scoring: 'ppr', starters, teamCount: 12 }))
      expect(ctx.shape).toBeUndefined()
      expect(ctx.scoringFormat).toBe('ppr')
    }
  })

  it('degrades to standard for a league with no information at all', () => {
    const ctx = scoringContextFor(league())
    expect(ctx.isSuperflex).toBe(false)
    expect(ctx.is2QB).toBe(false)
    expect(ctx.scoringFormat).toBe('standard')
  })
})
