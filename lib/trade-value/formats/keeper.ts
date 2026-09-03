/**
 * Keeper — the fourth per-format value model, and the first that prices a CONTRACT.
 *
 * ── 🛑 A KEEPER'S MARKET VALUE IS NOT HIS TRADE VALUE ───────────────────────────────────────
 * `lib/trade-intel/leagueFormatRules.ts` states the whole problem in its own header: what you
 * acquire is not the player, it is the player MINUS what he costs to keep. A receiver kept at a
 * 2nd is a worse asset than the same receiver kept at a 7th, and on every value chart in the world
 * those are the same player. That gap is the game in a keeper league and nothing priced it.
 *
 * `keeperSurplus` already computes it — `marketValue − pickPrice(costRound)` — so this model is an
 * adapter, not new arithmetic. The pick price comes from `pickValueByOverall`, which is
 * league-size aware, because a 3rd in a 4-team league and a 3rd in a 32-team league are different
 * assets and the round number alone cannot tell them apart.
 *
 * ── 🛑 THE MULTIPLIER IS FLOORED AT ZERO, AND THE REASON CARRIES THE TRUTH ──────────────────
 * Surplus is genuinely negative for a player who costs more to keep than he is worth — that is the
 * case a manager is most likely to trade for without noticing, and `keeperSurplus` calls it out.
 * But a NEGATIVE multiplier would make `fitAdjustedValue` return a negative price, and there is no
 * such thing on a 0–10000 scale.
 *
 * So the multiplier floors at 0 and the sentence says what the number cannot: how far underwater
 * the contract is. Clamping silently would hide the most useful thing this model knows.
 *
 * ── WHAT IT DOES NOT CLAIM ─────────────────────────────────────────────────────────────────
 * The surplus is the value of ACQUIRING him, not of rostering him this season — he still scores
 * points either way. Treat the fit as "what the contract is worth", which is exactly why it is
 * reported beside the base rather than folded into it.
 */

import { keeperSurplus } from '@/lib/trade-intel/leagueFormatRules'
import { FIRST_ROUND_IN_MARKET_UNITS, pickValueByOverall } from '@/lib/pick-curve'
import type { FormatAdjustment, FormatValueInput, FormatValueModel } from './types'

/**
 * What this model needs to know about the asset itself.
 *
 * ⚠ `costRound` IS NOT STORED ANYWHERE TODAY. Censused 2026-09-03: the schema carries league-level
 * `keeperCount`, `keeperCostSystem` ('round_based') and `keeperRoundPenalty`, but no per-player
 * keeper price. It is DERIVABLE — `RedraftDraftPick.round` minus the penalty — and that derivation
 * belongs to whatever assembles the trade, not here. This model prices a cost it is given and
 * stays silent when it is given none.
 */
interface KeeperAssetState {
  /** The round he would cost to keep next season. */
  costRound?: unknown
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

export const keeperModel: FormatValueModel = {
  formatId: 'keeper',
  label: 'Keeper',

  adjust(input: FormatValueInput): FormatAdjustment | null {
    const state = input.assetState
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null

    const costRound = num((state as KeeperAssetState).costRound)
    if (costRound == null || costRound < 1) return null
    if (!(input.base > 0)) return null

    /*
     * ⚠ SIZE-CONVERTED, NOT ROUND-KEYED. `pickValueByOverall` takes the overall pick number, so a
     * 3rd-round pick is priced by where it actually falls in THIS league. Keying on the round
     * alone assumed every league had 12 teams, which the pick-curve module records as wrong in
     * both directions — a 4-team 3rd is overall #9, a 32-team 2nd is really a 12-team 3rd.
     */
    const teams = input.shape.teams
    const surplus = keeperSurplus({
      marketValue: input.base,
      costRound,
      /*
       * ⚠ `FIRST_ROUND_IN_MARKET_UNITS` IS THE MODULE'S OWN ANCHOR, NOT A NUMBER I CHOSE. The
       * curve is a share-of-first-round; it needs whatever a 1.01 is worth on the scale being
       * compared against. `input.base` is a market value on the 0–10000 convention, so the pick
       * has to be priced on that same convention or the subtraction is unit-mixing — the family of
       * error this whole audit began with.
       */
      pickPrice: (round) =>
        pickValueByOverall({ teams, round, slot: null, firstRoundValue: FIRST_ROUND_IN_MARKET_UNITS }),
    })
    if (!surplus) return null

    const ratio = surplus.surplus / input.base

    /*
     * Floored at 0 — see the header. A negative surplus is real information and it lives in the
     * sentence, because the multiplier cannot express it without producing a negative price.
     */
    const multiplier = Math.max(0, ratio)

    return {
      multiplier,
      reason:
        surplus.surplus >= 0
          ? `${surplus.basis} Acquiring him is worth about ${Math.round(ratio * 100)}% of his market value once the pick he costs you is taken out.`
          : `${surplus.basis} The contract is underwater, so the acquisition is worth nothing on its own — he still scores points, but you are paying above his value for the right to hold him.`,
    }
  },
}
