/**
 * Zombie — the fifth per-format value model, and the first to price an asset kind that is not a
 * player at all.
 *
 * ── 🛑 THE POINTS→VALUE CONVERSION, AND WHY IT IS TWO STEPS RATHER THAN ONE ─────────────────
 * `lib/trade-intel/zombie.ts` prices weapons in POINTS PER WEEK. The value engine speaks a
 * 0–10000 scale anchored by `PROJ_TO_VALUE = 26`, which converts a REST-OF-SEASON point total.
 *
 * Multiplying a weekly rate by 26 directly is the 17× error in a new costume — it would treat "+4
 * points every week" as "+4 points all season" and understate the weapon by roughly the number of
 * weeks left. So the conversion goes through the season total the engine actually expects:
 *
 *     value = pointsPerWeek × weeksRemaining × PROJ_TO_VALUE
 *
 * A knife worth +4/week with 10 weeks left is 40 season points, or ~1,040 on the value scale.
 * That is the same arithmetic the engine performs on a player's projection, applied to a weapon.
 *
 * ── 🛑 THE TOP-TWO RULE IS WHY A WEAPON HAS NO INTRINSIC PRICE ──────────────────────────────
 * `weaponAcquisitionValue` states it: only your best two weapons count, so a knife is worth 4 a
 * week to a manager holding nothing and EXACTLY ZERO to one already holding a gun and a bow. The
 * same item, two managers, and the honest price differs by all of it.
 *
 * That is why this reads the acquiring roster's held weapons from `teamState` and returns null
 * without them. A weapon priced by tier would be wrong in the most common case — a manager who
 * already has some.
 *
 * ── WHAT IT DOES NOT PRICE ─────────────────────────────────────────────────────────────────
 * "Zombie teams cannot trade" and "there are no waivers, only free agents" are counterparty and
 * replacement-level facts. They change WHO you can deal with and how cheap depth is, not what a
 * weapon is worth to your top two, and `lib/trade-intel/zombie.ts` reports both as prose.
 */

import { weaponAcquisitionValue } from '@/lib/trade-intel/zombie'
import { PROJ_TO_VALUE } from '../valueEngine'
import type { FormatAdjustment, FormatValueInput, FormatValueModel } from './types'

/**
 * The acquiring roster's zombie state.
 *
 * ⚠ `heldWeapons` MUST BE THE ACQUIRER'S, and `applyFormatFit` supplies the state of the roster
 * GIVING the asset up. A future caller wiring this for real has to pass the receiving side — the
 * top-two rule makes the answer depend entirely on who ends up holding it.
 */
interface ZombieTeamState {
  /** Weapons already held, as point values. */
  heldWeapons?: unknown
  /** Scoring periods left in the season. */
  weeksRemaining?: unknown
}

/** The weapon being acquired, in points per week. */
interface ZombieAssetState {
  weaponPoints?: unknown
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const numArray = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? (v as number[])
    : null

export const zombieModel: FormatValueModel = {
  formatId: 'zombie',
  label: 'Zombie Universe',

  /**
   * ⚠ THE EXTRA ASSET KIND IS DECLARED BUT NOT YET TRADEABLE END TO END. `AssetValueSnapshot.kind`
   * is a fixed union that does not include weapons, so nothing constructs one today. Declaring it
   * here states what the format needs rather than implying the plumbing exists.
   */
  extraAssetKinds: ['weapon'],

  adjust(input: FormatValueInput): FormatAdjustment | null {
    const team = input.teamState
    const asset = input.assetState
    if (!team || typeof team !== 'object' || Array.isArray(team)) return null
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return null

    const incoming = num((asset as ZombieAssetState).weaponPoints)
    const held = numArray((team as ZombieTeamState).heldWeapons)
    const weeks = num((team as ZombieTeamState).weeksRemaining)

    /*
     * All three are required and none is guessed. `held` in particular: an EMPTY array is a real
     * state ("this manager holds nothing", so the weapon is worth its full face value) and is
     * meaningfully different from absent ("we do not know what they hold"), which cannot be
     * priced at all. `numArray` returns null for absent and `[]` for empty, so the two stay apart.
     */
    if (incoming == null || held == null || weeks == null) return null
    if (weeks < 0 || !(input.base > 0)) return null

    const w = weaponAcquisitionValue({ held, incoming, weeksRemaining: weeks })

    /*
     * Two steps, per the header: weekly rate → season total → value scale. Collapsing them into
     * one multiplication by 26 is the unit error this whole audit began with.
     */
    const seasonPoints = w.pointsPerWeek * weeks
    const weaponValue = seasonPoints * PROJ_TO_VALUE

    return {
      multiplier: 1 + weaponValue / input.base,
      reason:
        w.pointsPerWeek === 0
          ? `${w.basis} It adds nothing to this trade for this roster.`
          : `${w.basis} On the AllFantasy scale that is about ${Math.round(weaponValue).toLocaleString()} of value — ${w.pointsPerWeek} points a week over ${weeks} week${weeks === 1 ? '' : 's'}, converted the same way a player's projection is.`,
    }
  },
}
