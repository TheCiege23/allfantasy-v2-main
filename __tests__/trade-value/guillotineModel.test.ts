/**
 * Guillotine — the first format model built on rules the repo already encoded.
 *
 * The multiplier under test is derived in `lib/trade-intel/guillotine.ts`: under an even chance
 * of being chopped, expected weeks alive is (T−1)/2, so a trade with T of S teams left is worth
 * (T−1)/(S−1) of its week-one value. Every expectation below is that fraction computed by hand,
 * NOT read back from the function — a test that calls the implementation to build its own
 * expectation cannot fail.
 */

import { describe, expect, it } from 'vitest'
import { buildLeagueShape } from '@/lib/trade-value/leagueShape'
import { guillotineModel } from '@/lib/trade-value/formats/guillotine'
import { formatModelFor, formatModelForLeague } from '@/lib/trade-value/formats/registry'

const shape = (teams: number, deadlineWeek: number | null = null) =>
  buildLeagueShape({
    teams,
    starterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
    rosterSize: 16,
    deadlineWeek,
  })!

const base = { base: 5000, position: 'WR' } as const

describe('registry', () => {
  it('resolves guillotine by leagueType', () => {
    expect(formatModelFor('guillotine')).toBe(guillotineModel)
    expect(formatModelForLeague({ leagueType: 'guillotine' })).toBe(guillotineModel)
  })

  it('resolves it through readFormatRules when leagueType is absent', () => {
    // `readFormatRules` maps the concept; the registry must reach it by that route too.
    expect(formatModelForLeague({ aliasTags: ['guillotine'] })).toBe(guillotineModel)
  })
})

describe('the horizon multiplier', () => {
  it('is exactly 1.0 in week one — a full field discounts nothing', () => {
    const a = guillotineModel.adjust({
      ...base, shape: shape(18), teamState: { teamsRemaining: 18, startingTeams: 18 },
    })!
    expect(a.multiplier).toBe(1)
  })

  it('is (T−1)/(S−1), computed by hand rather than read back', () => {
    // 18-team league, 10 alive: 9/17 = 0.5294117…
    const a = guillotineModel.adjust({
      ...base, shape: shape(18), teamState: { teamsRemaining: 10, startingTeams: 18 },
    })!
    expect(a.multiplier).toBeCloseTo(9 / 17, 10)

    // Down to the last two: 1/17.
    const b = guillotineModel.adjust({
      ...base, shape: shape(18), teamState: { teamsRemaining: 2, startingTeams: 18 },
    })!
    expect(b.multiplier).toBeCloseTo(1 / 17, 10)
  })

  it('decays monotonically as the field shrinks', () => {
    const at = (t: number) =>
      guillotineModel.adjust({
        ...base, shape: shape(12), teamState: { teamsRemaining: t, startingTeams: 12 },
      })!.multiplier
    const series = [12, 10, 8, 6, 4, 2].map(at)
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeLessThan(series[i - 1])
    expect(series[0]).toBe(1)
  })

  it('carries the reason, and the reason names the arithmetic', () => {
    const a = guillotineModel.adjust({
      ...base, shape: shape(18), teamState: { teamsRemaining: 10, startingTeams: 18 },
    })!
    expect(a.reason).toMatch(/10 of 18/)
    expect(a.reason).toMatch(/53%/)
  })
})

describe('🛑 it refuses rather than guesses when the field size is ambiguous', () => {
  /*
   * A guillotine league's shape may be built from CONFIGURED teams (the starting field) or from
   * LIVE rosters (the surviving field), and those diverge the moment anyone is chopped. When
   * `shape.teams` equals `teamsRemaining` the two readings are indistinguishable — week one of a
   * full field, or week ten of a shrunk one — and they imply wildly different multipliers.
   */
  it('says nothing when shape.teams equals teamsRemaining and no startingTeams is stated', () => {
    expect(guillotineModel.adjust({
      ...base, shape: shape(10), teamState: { teamsRemaining: 10 },
    })).toBeNull()
  })

  it('uses shape.teams only when it is unambiguously the larger, starting field', () => {
    const a = guillotineModel.adjust({
      ...base, shape: shape(18), teamState: { teamsRemaining: 10 },
    })!
    expect(a.multiplier).toBeCloseTo(9 / 17, 10)
  })

  it('ignores a stated startingTeams that is below the surviving count', () => {
    // Contradictory input: more teams alive than ever started. Falls back to the shape, which is
    // larger and therefore usable.
    const a = guillotineModel.adjust({
      ...base, shape: shape(18), teamState: { teamsRemaining: 10, startingTeams: 4 },
    })!
    expect(a.multiplier).toBeCloseTo(9 / 17, 10)
  })

  it('says nothing without state at all — it does not invent a week', () => {
    expect(guillotineModel.adjust({ ...base, shape: shape(18) })).toBeNull()
    expect(guillotineModel.adjust({ ...base, shape: shape(18), teamState: {} })).toBeNull()
  })

  it('survives a malformed teamState rather than throwing', () => {
    for (const s of ['ten', 42, [], null, { teamsRemaining: 'x' }, { teamsRemaining: NaN }]) {
      expect(() => guillotineModel.adjust({ ...base, shape: shape(18), teamState: s }))
        .not.toThrow()
      expect(guillotineModel.adjust({ ...base, shape: shape(18), teamState: s })).toBeNull()
    }
  })
})

describe('elimination and legality', () => {
  const alive = { teamsRemaining: 10, startingTeams: 18 }
  const dead = { teamsRemaining: 10, startingTeams: 18, eliminated: true }

  it('a chopped team cannot trade, and the refusal names why', () => {
    const r = guillotineModel.canTrade!({ ...base, shape: shape(18), teamState: dead })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/chopped/i)
    expect(r.reason).toMatch(/waivers/i)
  })

  it('🛑 elimination does NOT discount the player — it removes the trade', () => {
    /*
     * The asset is worth what the market says; what changed is that this manager has no roster.
     * Returning a multiplier here would report a cheaper player rather than an impossible deal.
     */
    expect(guillotineModel.adjust({ ...base, shape: shape(18), teamState: dead })).toBeNull()
  })

  it('reads the deadline from the SHAPE, not from a constant', () => {
    const s = shape(18, 11)
    expect(guillotineModel.canTrade!({ ...base, shape: s, teamState: alive, currentWeek: 11 }).ok)
      .toBe(true)
    const closed = guillotineModel.canTrade!({
      ...base, shape: s, teamState: alive, currentWeek: 12,
    })
    expect(closed.ok).toBe(false)
    expect(closed.reason).toMatch(/week 11/)
    // There is no offseason in this format, so the note must not promise one.
    expect(closed.reason).toMatch(/does not reopen/i)
  })

  it('does not assume closed when the deadline or week is unknown', () => {
    expect(guillotineModel.canTrade!({ ...base, shape: shape(18), teamState: alive }).ok).toBe(true)
    expect(guillotineModel.canTrade!({
      ...base, shape: shape(18, 11), teamState: alive, currentWeek: null,
    }).ok).toBe(true)
  })
})

describe('does not double-count what the shared engine already prices', () => {
  it('🛑 the multiplier depends on the FIELD, not on slots or roster depth', () => {
    /*
     * `LeagueShape` already prices team count as starter demand and roster size as bench depth.
     * This model prices TIME REMAINING, which is a different fact. Two leagues with the same
     * survival state and very different rosters must get the same horizon multiplier — if roster
     * shape moved it, the same fact would be priced twice.
     */
    const deep = buildLeagueShape({
      teams: 18, starterSlots: ['QB', 'RB', 'WR', 'TE', 'FLEX'], rosterSize: 40,
    })!
    const shallow = buildLeagueShape({
      teams: 18, starterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      rosterSize: 14,
    })!
    const state = { teamsRemaining: 10, startingTeams: 18 }
    const a = guillotineModel.adjust({ ...base, shape: deep, teamState: state })!
    const b = guillotineModel.adjust({ ...base, shape: shallow, teamState: state })!
    expect(a.multiplier).toBe(b.multiplier)
  })

  it('is independent of the asset — position and base do not move it', () => {
    const state = { teamsRemaining: 6, startingTeams: 12 }
    const m = (position: string, value: number) =>
      guillotineModel.adjust({ base: value, position, shape: shape(12), teamState: state })!.multiplier
    expect(m('QB', 9000)).toBe(m('K', 200))
  })
})
