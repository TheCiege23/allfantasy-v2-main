/**
 * The exchange rate between devy points and market units — set by a commissioner, never inferred.
 *
 * 🛑 THIS DOES NOT MEASURE ANYTHING, AND THAT IS THE ENTIRE DESIGN. `lib/trade-intel/
 * devyOutlook.ts` establishes that nothing prices college players: no vendor sells a devy
 * market, and P(reaches the NFL) has never been observed here. A trade spanning both scales is
 * therefore refused rather than graded, because grading it would mean inventing a conversion
 * and not saying so.
 *
 * ⚠ THE OBSERVATION SET WAS EMPTY, AND THE REASON HAS SINCE BEEN FIXED. Measured on production
 * 2026-08-30, `DevyPlayer` held 1,721 rows of which ZERO had `graduatedToNFL = true` and ZERO
 * carried a `draftYear` — 335 players draft-eligible in 2026 and none left the pool — because
 * `classifyDraftStatus` in lib/devy-classification.ts, the sole writer of both, had no caller.
 *
 * ✅ It has one now: `app/api/cron/import-players` runs it as the `devyDraftStatus` phase behind
 * a 20h cadence gate (`ad514a334`). So the series has started accumulating rather than being
 * structurally impossible, and the honest way to earn a real rate — watching what devy assets
 * turn out to be worth once they reach the NFL — is now open where it was closed.
 *
 * 🛑 THAT DOES NOT MAKE THE BRIDGE OBSOLETE, AND WILL NOT FOR YEARS. One draft class is not a
 * fitted rate; it is one point. Until there are enough graduated cohorts to fit against, a
 * commissioner-stated exchange rate is still the only alternative to refusing forever, and every
 * converted value still carries `DEVY_BRIDGE_CAVEAT`.
 *
 * ⚠ AND DO NOT RE-DERIVE THE OLD CLAIM FROM THIS COMMENT. The "has no caller" sentence above was
 * quoted verbatim into a planning document on 2026-08-31 and recorded there as a measured fact,
 * by a reader who did not grep. It was already stale. If you need to know whether a writer runs,
 * check the callers — not a comment about them, including this one.
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

/**
 * Where the rate lives: `League.settings.devy_league_config.devyMarketUnitsPerDevyPoint`.
 *
 * ⚠ NESTED INSIDE THE DEVY CONFIG, NOT AT THE TOP OF `settings`, BECAUSE THAT IS WHERE THE
 * COMMISSIONER UI WRITES. `DevyLeagueSettingsHub` PATCHes `devyLeagueConfig`, which
 * `execute-league-settings-patch` stores verbatim under `devy_league_config`. A rate read from
 * the top level would be an orphan key that nothing in the product can set — reachable only by
 * editing the database by hand, which is the same "surface pointed at a table nothing writes"
 * failure this stack keeps finding.
 *
 * ONE LOCATION ONLY. A fallback to the top level would mean two places to look and two ways for
 * a league to disagree with itself about its own house rule.
 */
export const DEVY_BRIDGE_CONFIG_KEY = 'devy_league_config' as const
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
  const cfg = bag[DEVY_BRIDGE_CONFIG_KEY]
  const raw =
    cfg && typeof cfg === 'object' && !Array.isArray(cfg)
      ? (cfg as Record<string, unknown>)[DEVY_BRIDGE_SETTING_KEY]
      : undefined

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
