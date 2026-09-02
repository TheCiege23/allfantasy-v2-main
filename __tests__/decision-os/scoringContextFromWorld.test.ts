/**
 * CanonicalWorld → ScoringContext, and the memo wiring that consumes it.
 *
 * 🛑 THE POINT OF THIS FILE. `buildTradeValueSnapshot` has accepted a `scoring` argument since
 * slice 16 and NEITHER canonicalMemo call site passed it, so the Decision OS path — live in
 * production — priced every league as standard 1-QB redraft. These tests pin the wire shut.
 */

import { describe, expect, it } from 'vitest'
import {
  scoringContextFromCanonicalWorld,
  scoringContextFromWorld,
  scoringFormatFromRec,
} from '@/lib/decision-os/trade/scoringContextFromWorld'

const STANDARD_12 = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']
const SUPERFLEX_12 = [...STANDARD_12, 'SUPER_FLEX']
const FOUR_HORSEMEN = [
  ...Array(4).fill('QB'), ...Array(4).fill('RB'), ...Array(6).fill('WR'),
  ...Array(4).fill('TE'), ...Array(10).fill('FLEX'),
]

describe('scoringFormatFromRec — banded, not exact-matched', () => {
  it('maps the three common settings where they obviously belong', () => {
    expect(scoringFormatFromRec(0)).toBe('standard')
    expect(scoringFormatFromRec(0.5)).toBe('half_ppr')
    expect(scoringFormatFromRec(1)).toBe('ppr')
  })

  it('handles the in-between settings real leagues actually run', () => {
    // An exact `=== 0.5` test would have dropped every one of these.
    expect(scoringFormatFromRec(0.4)).toBe('half_ppr')
    expect(scoringFormatFromRec(0.75)).toBe('ppr')
    expect(scoringFormatFromRec(0.1)).toBe('standard')
  })

  it('returns null for an absent setting rather than assuming standard', () => {
    // "We do not know" and "this league scores no PPR" are different claims.
    expect(scoringFormatFromRec(null)).toBeNull()
  })
})

describe('scoringContextFromWorld', () => {
  it('returns null when the world knows nothing useful', () => {
    expect(scoringContextFromWorld({ teams: 12, starterSlots: null })).toBeNull()
    expect(scoringContextFromWorld({ teams: 0, starterSlots: null, scoringSettings: {} })).toBeNull()
  })

  it('builds a shape from real roster settings', () => {
    const ctx = scoringContextFromWorld({
      teams: 4,
      starterSlots: FOUR_HORSEMEN,
      rosterSize: 80,
      irSlots: 10,
      taxiSlots: 10,
      deadlineWeek: 13,
      scoringSettings: { rec: 1, bonus_rec_te: 0.75 },
    })!
    expect(ctx).not.toBeNull()
    expect(ctx.shape!.teams).toBe(4)
    expect(ctx.shape!.dedicatedStarters.QB).toBe(4)
    expect(ctx.shape!.taxiSlots).toBe(10)
    expect(ctx.shape!.deadlineWeek).toBe(13)
    expect(ctx.scoringFormat).toBe('ppr')
    expect(ctx.tePremium).toBe(0.75)
  })

  it('reads TE premium from bonus_rec_te, which is NOT rec', () => {
    const ctx = scoringContextFromWorld({
      teams: 12, starterSlots: STANDARD_12, scoringSettings: { rec: 1, bonus_rec_te: 0.5 },
    })!
    expect(ctx.scoringFormat).toBe('ppr')
    expect(ctx.tePremium).toBe(0.5)
  })

  it('treats a zero or missing TE premium as absent, not as a real 0', () => {
    const zero = scoringContextFromWorld({
      teams: 12, starterSlots: STANDARD_12, scoringSettings: { rec: 1, bonus_rec_te: 0 },
    })!
    expect(zero.tePremium).toBeNull()
    const missing = scoringContextFromWorld({
      teams: 12, starterSlots: STANDARD_12, scoringSettings: { rec: 1 },
    })!
    expect(missing.tePremium).toBeNull()
  })

  it('leaves the booleans unset when a shape exists — one description, not two', () => {
    const ctx = scoringContextFromWorld({ teams: 12, starterSlots: SUPERFLEX_12 })!
    expect(ctx.isSuperflex).toBeUndefined()
    expect(ctx.is2QB).toBeUndefined()
    // The superflex fact still travels — via the shape, which is strictly more informative.
    expect(ctx.shape!.superflexSlots).toBe(1)
  })

  it('survives a garbage scoringSettings blob without throwing', () => {
    for (const blob of [null, undefined, 'ppr', 42, [], { rec: 'lots' }]) {
      const ctx = scoringContextFromWorld({ teams: 12, starterSlots: STANDARD_12, scoringSettings: blob })
      expect(ctx).not.toBeNull()
      expect(ctx!.scoringFormat).toBeNull()
      expect(ctx!.tePremium).toBeNull()
    }
  })
})

describe('scoringContextFromCanonicalWorld — the shape the memo actually passes', () => {
  const worldLike = (over: Record<string, unknown> = {}) => ({
    teams: Array.from({ length: 12 }, (_, i) => ({ teamId: `t${i}` })),
    league: {
      scoringSettings: { rec: 1 },
      rosterSettings: { starterSlots: STANDARD_12, rosterSize: 15, irSlots: null, taxiSlots: null },
      tradeSettings: { deadlineWeek: 12 },
      ...over,
    },
  })

  it('derives team count from world.teams.length', () => {
    const ctx = scoringContextFromCanonicalWorld(worldLike())!
    expect(ctx.shape!.teams).toBe(12)
  })

  it('degrades honestly when rosterSettings is missing entirely', () => {
    const ctx = scoringContextFromCanonicalWorld(worldLike({ rosterSettings: null }))
    // No shape, but the PPR setting still travels.
    expect(ctx!.shape).toBeNull()
    expect(ctx!.scoringFormat).toBe('ppr')
  })

  it('a 32-team world produces a 32-team shape', () => {
    const w = worldLike()
    const big = { ...w, teams: Array.from({ length: 32 }, (_, i) => ({ teamId: `t${i}` })) }
    expect(scoringContextFromCanonicalWorld(big)!.shape!.teams).toBe(32)
  })
})

describe('POSITIVE CONTROL — the wire is not passing null', () => {
  /**
   * The byte-identity test between the E.2 and E.3 memo paths would pass trivially if BOTH sides
   * received `null`. This asserts the context is genuinely populated for a realistic world, so
   * that identity is meaningful rather than vacuous.
   */
  it('a realistic world yields a populated context, not null', () => {
    const ctx = scoringContextFromCanonicalWorld({
      teams: Array.from({ length: 12 }, () => ({})),
      league: {
        scoringSettings: { rec: 1, bonus_rec_te: 0.5 },
        rosterSettings: { starterSlots: SUPERFLEX_12, rosterSize: 16, irSlots: 2, taxiSlots: 4 },
        tradeSettings: { deadlineWeek: 12 },
      },
    })
    expect(ctx).not.toBeNull()
    expect(ctx!.shape).not.toBeNull()
    expect(ctx!.shape!.superflexSlots).toBe(1)
    expect(ctx!.scoringFormat).toBe('ppr')
    expect(ctx!.tePremium).toBe(0.5)
  })

  it('a superflex world and a standard world produce DIFFERENT contexts', () => {
    const mk = (slots: string[]) =>
      scoringContextFromCanonicalWorld({
        teams: Array.from({ length: 12 }, () => ({})),
        league: {
          scoringSettings: { rec: 1 },
          rosterSettings: { starterSlots: slots, rosterSize: 16, irSlots: null, taxiSlots: null },
          tradeSettings: { deadlineWeek: null },
        },
      })!
    expect(mk(SUPERFLEX_12).shape!.superflexSlots).toBe(1)
    expect(mk(STANDARD_12).shape!.superflexSlots).toBe(0)
  })
})
