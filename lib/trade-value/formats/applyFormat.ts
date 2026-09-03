/**
 * The consumer for the format registry. PURE.
 *
 * ── 🛑 WHY THIS DOES NOT MULTIPLY THE BASE VALUE ────────────────────────────────────────────
 * User's decision, recorded in the audit plan as V5: format, need and injury effects are a
 * SEPARATE "fit" number shown beside the base, never folded into it.
 *
 * The reason is comparability. Base value is market-objective, so two managers in different
 * leagues looking at the same player see the same number and can argue about it. The moment a
 * format multiplier is baked in, that stops being true — and worse, it stops being VISIBLE:
 * a manager sees 6,900 instead of 6,552 with nothing saying which rule moved it or by how much.
 *
 * So `applyFormatFit` returns the adjustment as data. Nothing here mutates a price.
 *
 * ── AND WHY LEGALITY IS SEPARATE FROM VALUE ─────────────────────────────────────────────────
 * "This is worth less to you" and "you cannot trade this right now" are different answers, and a
 * manager needs both. Folding a closed trade window into a discount would produce a player worth
 * 20% less who is in fact worth exactly the same and simply untradeable until week 18.
 */

import { formatModelForLeague } from './registry'
import type { FormatAdjustment, FormatValueInput, TradeLegality } from './types'
import type { LeagueShape } from '../leagueShape'

/**
 * The format's opinion on one asset, as data.
 *
 * Every field is optional-by-absence rather than defaulted: `fit` null means the format had no
 * opinion, which a consumer must render differently from a multiplier of 1.0 meaning "looked, no
 * change".
 */
export interface FormatFit {
  /**
   * Which model spoke. Null when the league's format has no VALUE model — every canonical format
   * except the Four Horsemen fixture today.
   *
   * ⚠ "No value model" is not "unmodelled". `lib/trade-intel/` already carries per-format context
   * and risk logic for most of these; what none of it does is move a number. See the registry
   * header, which previously claimed the stronger thing and was wrong.
   */
  formatId: string | null
  label: string | null
  /** The adjustment, or null when the model had nothing to say about this asset. */
  fit: FormatAdjustment | null
  /** Trade legality under this format's own rules. Null when the model does not gate trades. */
  legality: TradeLegality | null
}

export interface ApplyFormatFitInput {
  /** The league's format id — `TradeValueContext.leagueType`, or a league-specific id. */
  formatId: string | null | undefined
  /**
   * Concept alias tags, and the reason this field exists at all.
   *
   * 🛑 FOUR FORMATS ARE UNREACHABLE WITHOUT IT. `normalizeConcept.ts` flattens `pirate_vampire`
   * and `royal` onto `dynasty`, and `king_of_the_hill` and `idp` onto `redraft`, preserving the
   * original ONLY here. So a pirate league arrives with `formatId === 'dynasty'`, and a resolver
   * reading `formatId` alone finds a dynasty model — or nothing — for a league that is neither.
   *
   * Passing the tags through is what makes a future pirate model reachable rather than dead code.
   */
  aliasTags?: string[] | null
  /** Fallbacks `readFormatRules` uses when neither id resolves: keeper and dynasty inference. */
  isDynasty?: boolean | null
  keeperCount?: number | null
  base: number
  position: string | null | undefined
  age?: number | null
  experience?: number | null
  shape: LeagueShape | null | undefined
  currentWeek?: number | null
  teamState?: unknown
  /**
   * Per-ASSET format state — a keeper's cost round, a zombie weapon's points.
   *
   * 🛑 THIS PARAMETER EXISTS BECAUSE THE MODELS ARE DEAD WITHOUT IT, and it was very nearly
   * omitted. `assetState` was added to `FormatValueInput`, both models were written against it,
   * and every test passed — because the tests call the models directly. Nothing on the real path
   * would ever have supplied one, so keeper and zombie would have returned null forever while
   * looking correct. Same shape as `rescoreKickerForLeague`, which sat with zero consumers under a
   * comment claiming it ran.
   */
  assetState?: unknown
}

/**
 * Ask the format model about one asset. Returns null when there is nothing to ask.
 *
 * ⚠ REQUIRES A `LeagueShape`. Every model reasons from the league's real structure, and a model
 * given no shape would be reasoning from nothing — so this returns null rather than inventing a
 * default league, the same refusal `buildLeagueShape` itself makes.
 */
export function applyFormatFit(input: ApplyFormatFitInput): FormatFit | null {
  const model = formatModelForLeague({
    leagueType: input.formatId,
    aliasTags: input.aliasTags,
    isDynasty: input.isDynasty,
    keeperCount: input.keeperCount,
  })
  if (!model) return null
  if (!input.shape) return null

  const modelInput: FormatValueInput = {
    base: input.base,
    position: input.position,
    age: input.age ?? null,
    experience: input.experience ?? null,
    shape: input.shape,
    currentWeek: input.currentWeek ?? null,
    teamState: input.teamState,
    assetState: input.assetState,
  }

  /*
   * Both calls are guarded. A format model is ordinary code and a throw from one must not take
   * down a trade valuation — the asset still has a base value, which is the whole point of
   * keeping the fit separate.
   */
  let fit: FormatAdjustment | null = null
  try {
    fit = model.adjust(modelInput)
  } catch {
    fit = null
  }

  let legality: TradeLegality | null = null
  try {
    legality = model.canTrade ? model.canTrade(modelInput) : null
  } catch {
    legality = null
  }

  return { formatId: model.formatId, label: model.label, fit, legality }
}

/**
 * The fit-adjusted value, for a consumer that explicitly wants one number.
 *
 * ⚠ THIS IS NOT WHAT THE SNAPSHOT STORES, AND MUST NOT BECOME IT. It exists for a UI that has
 * already shown the base and the adjustment separately and wants to render the combination — the
 * "both, user toggles" shape. A caller reaching for this INSTEAD of showing the two numbers is
 * re-introducing exactly the invisibility the split was chosen to avoid.
 */
export function fitAdjustedValue(base: number, fit: FormatFit | null): number {
  const m = fit?.fit?.multiplier
  if (m == null || !Number.isFinite(m)) return base
  return Math.round(base * m)
}
