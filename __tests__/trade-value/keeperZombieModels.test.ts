/**
 * Keeper and Zombie — the two models that needed a decision before they could exist.
 *
 * Keeper is the first per-ASSET fact in the registry (what a contract costs), and Zombie is the
 * first points→value conversion. Both decisions are pinned here, because both are the kind that
 * look arbitrary later and were not.
 */

import { describe, expect, it } from 'vitest'
import { buildLeagueShape } from '@/lib/trade-value/leagueShape'
import { keeperModel } from '@/lib/trade-value/formats/keeper'
import { zombieModel } from '@/lib/trade-value/formats/zombie'
import { formatModelFor, formatModelForLeague } from '@/lib/trade-value/formats/registry'
import { FIRST_ROUND_IN_MARKET_UNITS, pickValueByOverall } from '@/lib/pick-curve'
import { PROJ_TO_VALUE } from '@/lib/trade-value/valueEngine'

const shape = (teams = 12) =>
  buildLeagueShape({
    teams,
    starterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
    rosterSize: 16,
  })!

/* ────────────────────────────── KEEPER ────────────────────────────── */

describe('keeper — a contract, not a player', () => {
  const base = { base: 5000, position: 'WR', shape: shape() } as const
  const adjust = (costRound: number, over: Record<string, unknown> = {}) =>
    keeperModel.adjust({ ...base, ...over, assetState: { costRound } })

  it('resolves by leagueType and by keeperCount on a redraft league', () => {
    expect(formatModelFor('keeper')).toBe(keeperModel)
    /*
     * `readFormatRules` folds `redraft + keeperCount > 0` into the keeper concept — real format
     * knowledge the registry defers to rather than re-deriving.
     */
    expect(formatModelForLeague({ leagueType: 'redraft', keeperCount: 3 })).toBe(keeperModel)
  })

  it('🛑 a CHEAPER keeper is worth more than the same player at a dearer price', () => {
    // The whole point: identical player, two contracts, two values. No chart distinguishes them.
    const cheap = adjust(12)!.multiplier
    const dear = adjust(2)!.multiplier
    expect(cheap).toBeGreaterThan(dear)
  })

  it('is (market − pickPrice) / market, computed by hand', () => {
    const cost = pickValueByOverall({
      teams: 12, round: 5, slot: null, firstRoundValue: FIRST_ROUND_IN_MARKET_UNITS,
    })
    expect(adjust(5)!.multiplier).toBeCloseTo((5000 - cost) / 5000, 10)
  })

  it('🛑 prices the round by LEAGUE SIZE, not by the round number', () => {
    /*
     * A 3rd in a 4-team league is overall #9; a 3rd in a 32-team league is overall #67. Keying on
     * the round alone assumed 12 teams for everyone, which `lib/pick-curve.ts` records as wrong in
     * both directions.
     */
    const small = keeperModel.adjust({ ...base, shape: shape(4), assetState: { costRound: 3 } })!
    const large = keeperModel.adjust({ ...base, shape: shape(32), assetState: { costRound: 3 } })!
    expect(small.multiplier).not.toBe(large.multiplier)
    // The 4-team 3rd is an earlier overall pick, so it costs more and leaves less surplus.
    expect(small.multiplier).toBeLessThan(large.multiplier)
  })

  it('🛑 floors at zero when the contract is underwater, and SAYS SO', () => {
    /*
     * A negative surplus is real — he costs more to keep than he is worth, which is exactly the
     * case a manager trades for without noticing. But a negative multiplier makes
     * `fitAdjustedValue` return a negative price, and there is no such thing on a 0–10000 scale.
     * So the floor is in the number and the truth is in the sentence.
     */
    const cheapPlayer = { ...base, base: 60 }
    const a = keeperModel.adjust({ ...cheapPlayer, assetState: { costRound: 1 } })!
    expect(a.multiplier).toBe(0)
    expect(a.reason).toMatch(/underwater/i)
    expect(a.reason).toMatch(/above his value/i)
  })

  it('says nothing without a cost round — it does not guess a contract', () => {
    /*
     * ⚠ `costRound` is NOT STORED anywhere today (censused 2026-09-03: only league-level
     * keeperCount / keeperCostSystem / keeperRoundPenalty exist). It is derivable from
     * `RedraftDraftPick.round`, and that derivation belongs to whoever assembles the trade.
     */
    expect(keeperModel.adjust({ ...base })).toBeNull()
    expect(keeperModel.adjust({ ...base, assetState: {} })).toBeNull()
    expect(keeperModel.adjust({ ...base, assetState: { costRound: 0 } })).toBeNull()
  })

  it('says nothing when the player has no market value to net against', () => {
    expect(keeperModel.adjust({ ...base, base: 0, assetState: { costRound: 5 } })).toBeNull()
  })

  it('survives a malformed assetState rather than throwing', () => {
    for (const s of ['5', 42, [], null, { costRound: 'x' }, { costRound: NaN }]) {
      expect(() => keeperModel.adjust({ ...base, assetState: s })).not.toThrow()
      expect(keeperModel.adjust({ ...base, assetState: s })).toBeNull()
    }
  })
})

/* ────────────────────────────── ZOMBIE ────────────────────────────── */

describe('zombie — the top-two rule means a weapon has no intrinsic price', () => {
  const base = { base: 5000, position: 'WR', shape: shape() } as const
  const adjust = (held: number[], incoming: number, weeks = 10) =>
    zombieModel.adjust({
      ...base,
      teamState: { heldWeapons: held, weeksRemaining: weeks },
      assetState: { weaponPoints: incoming },
    })

  it('resolves by leagueType', () => {
    expect(formatModelFor('zombie')).toBe(zombieModel)
  })

  it('🛑 the SAME weapon is worth everything to one roster and nothing to another', () => {
    /*
     * `weaponAcquisitionValue` states it: only your top two count. A knife is worth 4 a week to a
     * manager holding nothing and EXACTLY ZERO to one already holding a gun and a bow. A model
     * that priced weapons by tier would be wrong in the most common case.
     */
    const toEmpty = adjust([], 4)!
    const toStocked = adjust([20, 12], 4)!
    expect(toEmpty.multiplier).toBeGreaterThan(1)
    expect(toStocked.multiplier).toBe(1)
    expect(toStocked.reason).toMatch(/adds nothing to this trade/i)
  })

  it('🛑 converts WEEKLY → SEASON → value, not weekly × 26', () => {
    /*
     * Multiplying a per-week rate by PROJ_TO_VALUE directly treats "+4 every week" as "+4 all
     * season" — the 17× error in a new costume, understating the weapon by the weeks remaining.
     */
    const weeks = 10
    const a = adjust([], 4, weeks)!
    const expected = 1 + (4 * weeks * PROJ_TO_VALUE) / 5000
    expect(a.multiplier).toBeCloseTo(expected, 10)

    // And explicitly NOT the one-step version, which would be ~26x smaller in effect.
    const oneStep = 1 + (4 * PROJ_TO_VALUE) / 5000
    expect(a.multiplier).not.toBeCloseTo(oneStep, 6)
  })

  it('scales with the weeks left — a weapon in week 15 is worth less than in week 3', () => {
    expect(adjust([], 4, 12)!.multiplier).toBeGreaterThan(adjust([], 4, 2)!.multiplier)
  })

  it('prices only the IMPROVEMENT to the top pair, not the face value', () => {
    // Holding [10, 2], a 6-point weapon replaces the 2 → improvement is 4, not 6.
    const a = adjust([10, 2], 6, 10)!
    const expected = 1 + (4 * 10 * PROJ_TO_VALUE) / 5000
    expect(a.multiplier).toBeCloseTo(expected, 10)
  })

  it('🛑 an EMPTY held list is a real state; ABSENT is not', () => {
    /*
     * "This manager holds nothing" means the weapon is worth full face value. "We do not know what
     * they hold" cannot be priced at all. Collapsing them would invent the most favourable case.
     */
    expect(adjust([], 4)).not.toBeNull()
    expect(zombieModel.adjust({
      ...base, teamState: { weeksRemaining: 10 }, assetState: { weaponPoints: 4 },
    })).toBeNull()
  })

  it('says nothing without weeks remaining, or without a weapon', () => {
    expect(zombieModel.adjust({
      ...base, teamState: { heldWeapons: [] }, assetState: { weaponPoints: 4 },
    })).toBeNull()
    expect(zombieModel.adjust({
      ...base, teamState: { heldWeapons: [], weeksRemaining: 10 }, assetState: {},
    })).toBeNull()
  })

  it('declares the weapon asset kind without pretending the plumbing exists', () => {
    /*
     * `AssetValueSnapshot.kind` is a fixed union with no weapon member, so nothing constructs one
     * today. Declaring it states what the format needs rather than implying it is wired.
     */
    expect(zombieModel.extraAssetKinds).toContain('weapon')
  })

  it('survives malformed state rather than throwing', () => {
    for (const t of ['x', 42, [], null, { heldWeapons: 'no', weeksRemaining: 10 }, { heldWeapons: [1, 'x'], weeksRemaining: 10 }]) {
      expect(() => zombieModel.adjust({ ...base, teamState: t, assetState: { weaponPoints: 4 } })).not.toThrow()
      expect(zombieModel.adjust({ ...base, teamState: t, assetState: { weaponPoints: 4 } })).toBeNull()
    }
  })
})
