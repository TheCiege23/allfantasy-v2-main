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

import { formatModelFor } from './registry'
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
  /** Which model spoke. Null when the league's format has no model — 16 of 16 coded formats today. */
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
  base: number
  position: string | null | undefined
  age?: number | null
  experience?: number | null
  shape: LeagueShape | null | undefined
  currentWeek?: number | null
  teamState?: unknown
}

/**
 * Ask the format model about one asset. Returns null when there is nothing to ask.
 *
 * ⚠ REQUIRES A `LeagueShape`. Every model reasons from the league's real structure, and a model
 * given no shape would be reasoning from nothing — so this returns null rather than inventing a
 * default league, the same refusal `buildLeagueShape` itself makes.
 */
export function applyFormatFit(input: ApplyFormatFitInput): FormatFit | null {
  const model = formatModelFor(input.formatId)
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
