/**
 * The exchange rate between devy points and market units — set by a commissioner, never inferred.
 *
 * 🛑 THIS DOES NOT MEASURE ANYTHING, AND THAT IS THE ENTIRE DESIGN. `lib/trade-intel/
 * devyOutlook.ts` establishes that nothing prices college players: no vendor sells a devy
 * market, and P(reaches the NFL) has never been observed here. A trade spanning both scales is
 * therefore refused rather than graded, because grading it would mean inventing a conversion
 * and not saying so.
 *
 * ⚠ AND THE OBSERVATION SET IS EMPTY, NOT MERELY SMALL — measured on production 2026-08-30.
 * The honest way to earn this number is to watch what devy assets turn out to be worth once
 * they reach the NFL. That cannot be done today: `DevyPlayer` holds 1,721 rows of which ZERO
 * have `graduatedToNFL = true` and ZERO carry a `draftYear`, because `classifyDraftStatus` in
 * lib/devy-classification.ts — the sole writer of both — has no caller. 335 players were
 * draft-eligible in 2026 and none left the pool. Until that runs there is nothing to fit a
 * rate to, so the choice is between refusing forever and letting the league state its own
 * exchange rate explicitly.
 *
 * This module is the second option, built so it cannot be mistaken for the first:
 *
 *   - ABSENT BY DEFAULT. No setting means no bridge, and the mixed-scale refusal stands exactly
 *     as it did. Nothing about an existing league changes.
 *   - IT IS THE COMMISSIONER'S NUMBER, AND EVERY OUTPUT SAYS SO. A converted value carries
 *     `DEVY_BRIDGE_CAVEAT` wherever it is rendered. A grade that looks like the market-backed
 *     ones, with no note attached, is the exact failure the refusal exists to prevent.
 *   - BOUNDED, so a typo cannot silently reprice a league's whole devy board.
 *
 * Pure: no prisma, no fetch, no clock.
 */

import { DEVY_FIRST_PICK_VALUE } from '@/lib/trade-intel/devyTradeValue'

/** Where the rate lives on `League.settings`. JSON, so no migration is involved. */
export const DEVY_BRIDGE_SETTING_KEY = 'devyMarketUnitsPerDevyPoint' as const

/**
 * How far the rate may sit either side of sanity, and why these two numbers.
 *
 * The top devy asset is `DEVY_FIRST_PICK_VALUE` (1,000) devy points, and market units run
 * 0–10,000 with the best player in the game at the ceiling. So:
 *
 *   rate 10   puts the top devy prospect level with the most valuable NFL asset in existence
 *   rate 0.1  puts him at 100, below a deep bench flier, so the whole devy board rounds to noise
 *
 * Neither end is a defensible league setting; both are what a misplaced decimal produces. The
 * bound is a typo guard, NOT a claim that anything inside it is correct — every value in the
 * range is equally unmeasured.
 */
export const DEVY_BRIDGE_MIN = 0.1
export const DEVY_BRIDGE_MAX = 10

/**
 * The sentence that must travel with any converted number.
 *
 * 🛑 RENDER THIS WHEREVER A CONVERTED VALUE IS SHOWN. It is not a footnote — it is the
 * difference between a grade the manager can weigh and one that quietly claims a measurement
 * nobody made.
 */
export const DEVY_BRIDGE_CAVEAT =
  'This trade crosses two scales. The college side was converted using an exchange rate your ' +
  'commissioner set, not a measured market price — nothing prices college players, so no such ' +
  'rate has ever been observed. Treat the comparison as your league’s house rule rather than ' +
  'as a valuation.'

export type DevyBridgeRefusal = {
  ok: false
  /** `unset` is the normal case and is not an error. */
  reason: 'unset' | 'not_a_number' | 'out_of_range'
  detail: string
}

export type DevyBridge = {
  ok: true
  /** Market units per one devy point. */
  marketUnitsPerDevyPoint: number
  /** Always `league-setting`. There is deliberately no other source. */
  source: 'league-setting'
  caveat: string
}

export type DevyBridgeOutcome = DevyBridge | DevyBridgeRefusal

const UNSET: DevyBridgeRefusal = {
  ok: false,
  reason: 'unset',
  detail:
    'No devy exchange rate is set for this league, so a trade spanning college and NFL assets ' +
    'is reported as ungradeable rather than converted.',
}

/**
 * Read the rate off a league's settings blob.
 *
 * ⚠ ACCEPTS A STRING AS WELL AS A NUMBER. Settings arrive from forms and from imported
 * platform payloads, and `"3.5"` is what a text input produces. Refusing it would make the
 * setting silently inert for the commissioner who typed it correctly — the failure mode this
 * whole module is trying to avoid. An empty string is `unset`, not a zero.
 */
export function resolveDevyBridge(settings: unknown): DevyBridgeOutcome {
  const bag = (settings ?? {}) as Record<string, unknown>
  const raw = bag[DEVY_BRIDGE_SETTING_KEY]

  if (raw == null || raw === '') return UNSET

  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  if (!Number.isFinite(n)) {
    return {
      ok: false,
      reason: 'not_a_number',
      detail: `The devy exchange rate on this league is not a number (${JSON.stringify(raw)}), so it is ignored and the trade is reported as ungradeable.`,
    }
  }

  if (n < DEVY_BRIDGE_MIN || n > DEVY_BRIDGE_MAX) {
    return {
      ok: false,
      reason: 'out_of_range',
      detail:
        `The devy exchange rate on this league is ${n}, outside the accepted range of ` +
        `${DEVY_BRIDGE_MIN}–${DEVY_BRIDGE_MAX}. At ${DEVY_BRIDGE_MAX} the top devy prospect ` +
        `would price level with the most valuable NFL asset in existence, and at ` +
        `${DEVY_BRIDGE_MIN} the entire devy board rounds to noise — so it is ignored rather ` +
        'than applied.',
    }
  }

  return {
    ok: true,
    marketUnitsPerDevyPoint: n,
    source: 'league-setting',
    caveat: DEVY_BRIDGE_CAVEAT,
  }
}

/**
 * Convert devy points into market units at the league's rate.
 *
 * ⚠ NULL IN, NULL OUT — never 0. An unranked devy asset has no value in devy points, and
 * converting that absence into a zero would price him as the worst asset in the trade, which
 * is the failure `devyAssetValue` already refuses at the other end of the pipe.
 */
export function devyPointsToMarketUnits(
  devyPoints: number | null,
  bridge: DevyBridge,
): number | null {
  if (devyPoints == null || !Number.isFinite(devyPoints)) return null
  return Math.round(devyPoints * bridge.marketUnitsPerDevyPoint)
}

/**
 * What the league's rate implies for the top of the devy board, in market units.
 *
 * Offered so a commissioner setting the number can see what it does before saving it: a rate is
 * an abstraction, and "your best prospect is now worth 3,500" is the thing he can actually
 * judge.
 */
export function topDevyAssetAtRate(bridge: DevyBridge): number {
  return Math.round(DEVY_FIRST_PICK_VALUE * bridge.marketUnitsPerDevyPoint)
}
