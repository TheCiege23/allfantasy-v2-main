/**
 * CanonicalValue — the one shape every valuation producer emits.
 *
 * PURE. No prisma, no fetch, no clock. Safe to import anywhere, including from a producer that
 * has not yet moved behind the feed.
 *
 * ── WHY ONE SHAPE (D3) ──────────────────────────────────────────────────────────────────────
 * Four systems price players today and none of them agree on a shape:
 *
 *   offense/market  PlayerValueSnapshot, fantasycalc-db, trade-value/valueEngine   GLOBAL
 *   IDP             idp-projections/{idpValuation,idpTradeValues,leagueIdpVorp}    LEAGUE
 *   kicker          kicker-values/leagueKickerValue                                LEAGUE
 *   college/devy    devy/devyValueBoard, trade-intel/devyTradeValue                GLOBAL
 *
 * Decision OS should never learn there were four. It reads `CanonicalValue`, and the four
 * adapters translate. Nothing here computes a price; this file is a contract and a set of
 * refusals.
 *
 * ── 🛑 THE UNIT IS LOAD-BEARING, NOT DOCUMENTATION (D15) ────────────────────────────────────
 * Devy points and market units are DIFFERENT CURRENCIES. `lib/devy/devyValueBoard.ts` prices the
 * devy board on a curve that "compares devy assets to each other and converts to nothing else",
 * and `lib/devy/devyMarketBridge.ts` REFUSES to grade a trade spanning both scales because
 * grading it would mean inventing a conversion and not saying so.
 *
 * A single `value: number` field spanning both would perform that invented conversion by default,
 * silently, in every consumer that adds two numbers. So `unit` is required, and
 * {@link sumCanonicalValues} refuses on a mix unless the league has explicitly set a bridge —
 * in which case the result carries the caveat. The refusal is enforced by a test, not by
 * discipline: a field nothing checks is a comment.
 *
 * ── D17: EVERY SPORT, AND "NO PRODUCER" IS AN ANSWER ────────────────────────────────────────
 * The producer matrix is permanently sparse. FantasyCalc prices NFL only. IDP is
 * `['NFL','NCAAF']`. Kickers exist only in football. Devy covers NCAAF today and NCAAB is paired
 * for C2C but unpriced. So a value lookup has FOUR outcomes and collapsing them into `null` is
 * how a sport silently looks broken — see {@link ValueLookup}.
 */

import type { DevyBridge } from '@/lib/devy/devyMarketBridge'
import { devyPointsToMarketUnits, DEVY_BRIDGE_CAVEAT } from '@/lib/devy/devyMarketBridge'

/**
 * The currency a `value` is denominated in.
 *
 * ⚠ NOT AN OPEN STRING. Adding a member is a deliberate act that forces every `switch` over this
 * union to be revisited, which is the point — a third currency that slips in as a string would
 * be summed against the other two on its first day.
 */
export type ValueUnit = 'market_units' | 'devy_points'

/** How the number was arrived at. Determines which unit is legitimate, and how to read it. */
export type ValueBasis =
  /** A traded market price (FantasyCalc et al). market_units. */
  | 'market'
  /** Value over replacement under a league's own scoring. market_units. */
  | 'vorp'
  /** Kicker pricing from measured share-at-rank. market_units. */
  | 'share_at_rank'
  /** Devy board position priced on the devy-points curve. devy_points. */
  | 'devy_model'

/**
 * Whether the number is the same for everyone, or derived from one league's rules.
 *
 * ⚠ THIS IS NOT COSMETIC — IT DECIDES CACHEABILITY. A `global` value is one row for the whole
 * app; a `league` value must never be served to a different league. IDP and kicker values are
 * league-scoped BY CONSTRUCTION (`resolveLeagueIdpScoring`, `resolveLeagueKickerValue`), which is
 * why D4 stores canonical and rescores at read rather than storing a row per league.
 */
export type ValueScope = 'global' | 'league'

/** Which unit each basis is allowed to produce. Enforced by {@link isCoherentValue}. */
export const BASIS_UNIT: Readonly<Record<ValueBasis, ValueUnit>> = {
  market: 'market_units',
  vorp: 'market_units',
  share_at_rank: 'market_units',
  devy_model: 'devy_points',
}

export interface CanonicalValue {
  /**
   * `PlayerIdentityMap.id` — the internal spine (D13).
   *
   * ⚠ NOT `sleeperId`. Measured on production 2026-08-31 across 81,338 registry rows: `sleeperId`
   * covers 94.4% of NFL and **0.0% of the other six sports**, while `rollingInsightsId` covers
   * 100% of six of seven. A contract keyed on sleeperId works perfectly in NFL testing and
   * returns nothing everywhere else.
   */
  playerId: string
  /** Which id space the producer actually had, kept so a bad join is auditable rather than silent. */
  idSpace: string
  /** The id in that space, verbatim. */
  sourceId: string

  /** REQUIRED (D17). Never defaulted — the feed partitions on it. */
  sport: string

  value: number
  /** REQUIRED (D15). See the header. */
  unit: ValueUnit
  basis: ValueBasis
  scope: ValueScope
  /** Present only when `scope === 'league'`. A league value with no league is not addressable. */
  leagueId?: string | null

  positionRank?: number | null
  overallRank?: number | null

  /**
   * How much to trust the number, 0..1. Null = the producer does not express confidence.
   *
   * ⚠ NEVER ZERO-AS-UNKNOWN. `PlayerValueSnapshot.marketStdDev` is the natural input for market
   * values — high deviation means the market disagrees with itself — and a zero there would read
   * as perfect agreement.
   */
  confidence?: number | null
  /** Observations behind it. Null = not sample-based. `tradeFrequency` is the market analogue. */
  sampleSize?: number | null

  asOf: string
  /** The module that produced it, for provenance. */
  sourceModule: string
}

/** A value is coherent when its unit matches what its basis is allowed to emit. */
export function isCoherentValue(v: CanonicalValue): boolean {
  if (!Number.isFinite(v.value)) return false
  if (BASIS_UNIT[v.basis] !== v.unit) return false
  if (v.scope === 'league' && !v.leagueId) return false
  if (v.confidence != null && (v.confidence < 0 || v.confidence > 1)) return false
  return true
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Lookup outcomes — D8's no-fact rule needs the REASON, not just the absence.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The four honest answers to "what is this player worth".
 *
 * 🛑 COLLAPSING THESE INTO `null` IS THE BUG THIS TYPE EXISTS TO PREVENT. "NHL has no valuation
 * model" and "we have a model and it returned nothing for this player" and "the identity did not
 * resolve" are three different sentences for a user, and D8 requires Chimmy to say which.
 */
export type ValueLookup =
  | { status: 'ok'; value: CanonicalValue }
  /** No producer exists for this sport+basis, and none is planned. Not a gap — a fact. */
  | { status: 'no_producer'; sport: string; basis: ValueBasis; detail: string }
  /** A producer exists and has not produced this yet (cold, unscheduled, out of window). */
  | { status: 'not_computed'; sport: string; basis: ValueBasis; detail: string }
  /** The player could not be resolved onto the canonical spine. See §2.10 — NCAAF is where this bites. */
  | { status: 'unresolved_identity'; idSpace: string; sourceId: string; detail: string }

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Arithmetic — the only place a unit mix can be reconciled, and it refuses by default.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type SumResult =
  | {
      ok: true
      total: number
      unit: ValueUnit
      /** True when devy points were converted through a league's stated rate. */
      bridged: boolean
      /** Carries DEVY_BRIDGE_CAVEAT whenever `bridged`. Never empty in that case. */
      caveats: string[]
    }
  | {
      ok: false
      reason: 'mixed_units_no_bridge' | 'incoherent_value' | 'empty'
      detail: string
      units?: ValueUnit[]
    }

/**
 * Sum values, refusing rather than inventing a conversion.
 *
 * Behaviour, in order:
 *   - empty input            → refuse. A total of 0 for "nothing" prices an empty side as worthless.
 *   - any incoherent value   → refuse. A unit that does not match its basis is a producer bug.
 *   - all one unit           → sum, no caveat.
 *   - mixed, no bridge       → REFUSE. This is the default and the important case.
 *   - mixed, bridge supplied → convert devy_points via the league's stated rate, and attach
 *                              DEVY_BRIDGE_CAVEAT so the result can never be presented as market-backed.
 *
 * ⚠ The bridge is a LEAGUE SETTING and never inferred — `devyMarketBridge.ts` exists precisely to
 * keep that true, because nothing prices college players and no rate has ever been observed.
 */
export function sumCanonicalValues(
  values: readonly CanonicalValue[],
  bridge?: DevyBridge | null,
): SumResult {
  if (values.length === 0) {
    return { ok: false, reason: 'empty', detail: 'No values supplied; refusing to report a total of 0.' }
  }
  for (const v of values) {
    if (!isCoherentValue(v)) {
      return {
        ok: false,
        reason: 'incoherent_value',
        detail: `${v.sourceModule} emitted ${v.basis} in ${v.unit} for ${v.playerId}; ${v.basis} must be ${BASIS_UNIT[v.basis]}.`,
      }
    }
  }

  const units = [...new Set(values.map((v) => v.unit))]
  if (units.length === 1) {
    return { ok: true, total: values.reduce((s, v) => s + v.value, 0), unit: units[0]!, bridged: false, caveats: [] }
  }

  if (!bridge) {
    return {
      ok: false,
      reason: 'mixed_units_no_bridge',
      units,
      detail:
        'These values are in different currencies and this league has set no exchange rate. ' +
        'Nothing prices college players, so no rate has ever been measured — a total here would ' +
        'be an invented conversion presented as a number.',
    }
  }

  let total = 0
  for (const v of values) {
    if (v.unit === 'market_units') {
      total += v.value
      continue
    }
    const converted = devyPointsToMarketUnits(v.value, bridge)
    // Null in, null out is the bridge's own contract; a failed conversion must not become 0.
    if (converted == null) {
      return {
        ok: false,
        reason: 'incoherent_value',
        detail: `Could not convert ${v.value} devy points for ${v.playerId}; refusing rather than counting it as zero.`,
      }
    }
    total += converted
  }
  return { ok: true, total, unit: 'market_units', bridged: true, caveats: [DEVY_BRIDGE_CAVEAT] }
}
