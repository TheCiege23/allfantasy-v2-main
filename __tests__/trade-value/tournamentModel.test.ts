/**
 * Tournament — the third per-format value model.
 *
 * 🛑 THE POINT OF THIS FILE IS THE DENOMINATOR. Converting `bracketHorizon`'s expected games into
 * a multiplier needs one, and every external candidate is invented: "2/17 of a season player"
 * picks 17, "2/14" picks 14, and whichever you pick decides the answer. This model measures
 * against THIS bracket's own start instead, so nothing is chosen. Every expectation below is
 * computed by hand from 2 − 2^−(R−1), never read back from the implementation.
 */

import { describe, expect, it } from 'vitest'
import { buildLeagueShape } from '@/lib/trade-value/leagueShape'
import { tournamentModel } from '@/lib/trade-value/formats/tournament'
import { formatModelFor, formatModelForLeague } from '@/lib/trade-value/formats/registry'

const shape = buildLeagueShape({
  teams: 12,
  starterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
  rosterSize: 16,
})!

const base = { base: 5000, position: 'WR', shape } as const

/** Expected remaining games, by hand: 2 − 2^−(R−1). Never imported from the module under test. */
const games = (r: number) => 2 - Math.pow(2, -(r - 1))
/** `bracketHorizon` floors to 2dp DOWNWARD so a reported figure never overstates. */
const floored = (r: number) => Math.floor(games(r) * 100) / 100

describe('registry', () => {
  it('resolves tournament by leagueType and by concept', () => {
    expect(formatModelFor('tournament')).toBe(tournamentModel)
    expect(formatModelForLeague({ leagueType: 'tournament' })).toBe(tournamentModel)
  })
})

describe('🛑 the multiplier is self-relative — no invented denominator', () => {
  const adjust = (roundsRemaining: number, startingRounds: number) =>
    tournamentModel.adjust({ ...base, teamState: { roundsRemaining, startingRounds } })

  it('is exactly 1.0 before any round has been played', () => {
    for (const r of [3, 4, 7]) {
      expect(adjust(r, r)!.multiplier, `R=${r}`).toBe(1)
    }
  })

  it('is the ratio of expected games now to expected games at the start', () => {
    // 4-round bracket, 1 round left: 1.0 / 1.87 (both floored by the source module).
    const a = adjust(1, 4)!
    expect(a.multiplier).toBeCloseTo(floored(1) / floored(4), 10)

    // Sanity on the hand arithmetic itself: 2 − 2^−3 = 1.875 → floored 1.87.
    expect(floored(4)).toBe(1.87)
    expect(floored(1)).toBe(1)
  })

  it('decays monotonically as rounds are played', () => {
    const series = [7, 5, 3, 2, 1].map((r) => adjust(r, 7)!.multiplier)
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeLessThan(series[i - 1])
    expect(series[0]).toBe(1)
  })

  it('🛑 barely differs between a 4-round and a 7-round bracket — depth is nearly irrelevant', () => {
    /*
     * The finding `bracketHorizon` states in its own words: "Seven weeks of bracket is not seven
     * weeks of value." A model that made deep brackets meaningfully more valuable would be
     * asserting something the maths denies.
     */
    expect(floored(7)).toBe(1.98)
    expect(floored(4)).toBe(1.87)
    expect(Math.abs(floored(7) - floored(4))).toBeLessThan(0.15)
  })

  it('names the arithmetic in the reason, not just the number', () => {
    const a = adjust(1, 4)!
    expect(a.reason).toMatch(/1 of 4 rounds remain/)
    expect(a.reason).toMatch(/single elimination/i)
    expect(a.reason).toMatch(/%/)
  })
})

describe('🛑 it refuses rather than guessing the bracket', () => {
  it('says nothing without a starting round count', () => {
    /*
     * A 4-round and a 7-round bracket at the same `roundsRemaining` are genuinely different
     * positions. Inventing the start would invent the answer — the exact thing the self-relative
     * design exists to avoid.
     */
    expect(tournamentModel.adjust({ ...base, teamState: { roundsRemaining: 2 } })).toBeNull()
  })

  it('says nothing without state at all', () => {
    expect(tournamentModel.adjust({ ...base })).toBeNull()
    expect(tournamentModel.adjust({ ...base, teamState: {} })).toBeNull()
  })

  it('rejects impossible brackets rather than producing a number above 1', () => {
    // More rounds left than the bracket started with is contradictory input, not a 2x player.
    expect(tournamentModel.adjust({ ...base, teamState: { roundsRemaining: 5, startingRounds: 3 } })).toBeNull()
    expect(tournamentModel.adjust({ ...base, teamState: { roundsRemaining: 0, startingRounds: 4 } })).toBeNull()
  })

  it('survives a malformed teamState rather than throwing', () => {
    for (const s of ['four', 42, [], null, { roundsRemaining: 'x', startingRounds: 4 }, { roundsRemaining: NaN, startingRounds: 4 }]) {
      expect(() => tournamentModel.adjust({ ...base, teamState: s })).not.toThrow()
      expect(tournamentModel.adjust({ ...base, teamState: s })).toBeNull()
    }
  })
})

describe('🛑 trading is barred unless explicitly enabled', () => {
  const can = (tradesEnabled: unknown) =>
    tournamentModel.canTrade!({ ...base, teamState: { tradesEnabled } })

  it('refuses when trading is off, and names the rule', () => {
    const r = can(false)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/does not allow trades/i)
  })

  it('🛑 refuses when UNKNOWN — the opposite default from a deadline, deliberately', () => {
    /*
     * Most tournaments forbid trading outright, so reporting a tradeable asset in one whose rules
     * we have not read implies a deal that cannot happen. Contrast the deadline checks in the
     * other models, where an unknown week must NOT be assumed closed: a deadline is a date that
     * has probably not passed; a tournament trade rule is a setting that is probably off.
     */
    for (const unknown of [undefined, null, 'yes', 1]) {
      const r = can(unknown)
      expect(r.ok, String(unknown)).toBe(false)
      expect(r.reason).toMatch(/confirm with the commissioner/i)
    }
  })

  it('permits when explicitly enabled', () => {
    expect(can(true).ok).toBe(true)
  })

  it('refuses with no state at all rather than defaulting to permitted', () => {
    expect(tournamentModel.canTrade!({ ...base }).ok).toBe(false)
  })
})

describe('does not double-count what the shared engine already prices', () => {
  it('🛑 the multiplier ignores roster shape entirely', () => {
    /*
     * `LeagueShape` already prices team count and slots. This model prices TIME LEFT IN THE
     * BRACKET, a different fact. Two leagues in the same bracket position must agree.
     */
    const deep = buildLeagueShape({ teams: 12, starterSlots: ['QB', 'RB', 'WR'], rosterSize: 40 })!
    const shallow = buildLeagueShape({ teams: 12, starterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'], rosterSize: 14 })!
    const state = { roundsRemaining: 2, startingRounds: 5 }
    expect(tournamentModel.adjust({ ...base, shape: deep, teamState: state })!.multiplier)
      .toBe(tournamentModel.adjust({ ...base, shape: shallow, teamState: state })!.multiplier)
  })

  it('is independent of the asset — position and base do not move it', () => {
    const state = { roundsRemaining: 2, startingRounds: 5 }
    const m = (position: string, value: number) =>
      tournamentModel.adjust({ base: value, position, shape, teamState: state })!.multiplier
    expect(m('QB', 9000)).toBe(m('K', 200))
  })
})
