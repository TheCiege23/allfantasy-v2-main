/**
 * Guillotine — the second per-format value model, and the first built on rules this repo already
 * encoded rather than on a rulebook the user had to supply.
 *
 * ── 🛑 THE MULTIPLIER IS NOT INVENTED HERE, AND THAT IS THE WHOLE POINT ─────────────────────
 * `lib/trade-intel/guillotine.ts` already derives it. Under an even chance of being chopped, a
 * team's expected remaining weeks alive is exactly (T−1)/2, so a trade made with T teams left is
 * worth (T−1)/(S−1) of what the same trade was worth in week one with S teams. That is a
 * geometric fact about the format, not a tuned constant, and it is SELF-RELATIVE — measured
 * against week one of this same league, so it needs no cross-format baseline to mean something.
 *
 * ⚠ THAT SELF-RELATIVE PROPERTY IS WHY GUILLOTINE COULD BE BUILT AND TOURNAMENT COULD NOT.
 * `bracketHorizon` produces expected GAMES (2 − 2^−(R−1), never reaching 2). Turning games into a
 * multiplier needs a denominator — games in a full season? — and nothing in the repo states one.
 * Picking 2/17 would be inventing the number that decides the answer, so tournament has no model
 * here until somebody chooses that denominator deliberately. See the audit doc.
 *
 * ── WHAT THIS MODEL DELIBERATELY DOES NOT PRICE ────────────────────────────────────────────
 * The format's other two documented consequences are real and are NOT expressed as a multiplier:
 *
 *   · FAAB is the acquisition market, not a tiebreaker. That is an asset-kind question — what a
 *     dollar is worth — not a discount on a player, and pricing it here would answer the wrong one.
 *   · Floor beats ceiling, inverting normal advice. That changes WHICH player you want, not what
 *     any player is worth, exactly like the Four Horsemen Eliminator. A model that turned a
 *     preference into a price would silently reprice the whole board.
 *
 * Both are reported by `lib/trade-intel/guillotine.ts` as prose, which is the right shape for them.
 */

import { guillotineHorizon } from '@/lib/trade-intel/guillotine'
import type { FormatAdjustment, FormatValueInput, FormatValueModel, TradeLegality } from './types'

/**
 * What this model needs to know about the league's live state.
 *
 * ⚠ Narrowed here rather than in `FormatValueInput`, so no other format model depends on it.
 */
interface GuillotineTeamState {
  /** Teams still alive, including this one. */
  teamsRemaining?: unknown
  /** Teams the league started with. Falls back to `shape.teams` — see `readState`. */
  startingTeams?: unknown
  /** Whether THIS team has already been chopped. */
  eliminated?: unknown
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * Read the live state, or null when it is not usable.
 *
 * 🛑 `startingTeams` FALLS BACK TO `shape.teams` ONLY WHEN THAT IS NOT ALREADY THE SHRUNK COUNT.
 * A guillotine league's shape may be built from configured teams (the starting field) or from
 * live rosters (the surviving field), and the two diverge the moment anyone is chopped. If
 * `shape.teams` is below `teamsRemaining` it is plainly the wrong number; if it EQUALS
 * `teamsRemaining` mid-season it is ambiguous — it could be a full field in week one or a shrunk
 * one later — and the multiplier would come out at exactly 1.0 either way, which is the honest
 * answer for week one and a badly wrong one for week ten.
 *
 * So an explicit `startingTeams` is preferred, and the fallback is used only when it cannot
 * mislead. Returning null costs a note; guessing costs a price.
 */
function readState(
  teamState: unknown,
  shapeTeams: number,
): { teamsRemaining: number; startingTeams: number; eliminated: boolean } | null {
  if (!teamState || typeof teamState !== 'object' || Array.isArray(teamState)) return null
  const s = teamState as GuillotineTeamState

  const teamsRemaining = num(s.teamsRemaining)
  if (teamsRemaining == null || teamsRemaining < 1) return null

  const stated = num(s.startingTeams)
  let startingTeams: number
  if (stated != null && stated >= teamsRemaining) {
    startingTeams = stated
  } else if (shapeTeams > teamsRemaining) {
    startingTeams = shapeTeams
  } else {
    /*
     * Ambiguous or contradictory: shape.teams is at or below the surviving count, so it cannot be
     * distinguished from the shrunk field. No opinion rather than a fabricated one.
     */
    return null
  }

  return { teamsRemaining, startingTeams, eliminated: s.eliminated === true }
}

export const guillotineModel: FormatValueModel = {
  formatId: 'guillotine',
  label: 'Guillotine',

  adjust(input: FormatValueInput): FormatAdjustment | null {
    const state = readState(input.teamState, input.shape.teams)
    if (!state) return null

    /*
     * An eliminated team's roster is already on waivers — there is nothing to value and nothing
     * to trade. Reported through `canTrade` instead, so the asset keeps an honest market price.
     */
    if (state.eliminated) return null

    const horizon = guillotineHorizon({
      teamsRemaining: state.teamsRemaining,
      startingTeams: state.startingTeams,
    })
    if (!horizon) return null

    /*
     * ⚠ THE MULTIPLIER APPLIES TO EVERY ASSET EQUALLY, SO IT CANCELS OUT OF THE FAIRNESS RATIO —
     * and that is correct, not a limitation. Time remaining changes what a trade is worth TO YOU;
     * it does not make one side of an even swap better than the other. The grade is computed from
     * base value alone, which is what keeps these two questions apart.
     */
    return { multiplier: horizon.tradeValueMultiplier, reason: horizon.basis }
  },

  canTrade(input: FormatValueInput): TradeLegality {
    const state = readState(input.teamState, input.shape.teams)

    if (state?.eliminated) {
      return {
        ok: false,
        reason:
          'This team has been chopped — its whole roster went to waivers, so there is nothing left to trade.',
      }
    }

    /*
     * The deadline comes from the SHAPE, never from a constant in this file. The shape carries
     * what the league is configured with; a model trusting its own number would tell a manager a
     * trade is legal while the platform refuses it. Same rule as Four Horsemen.
     */
    const deadline = input.shape.deadlineWeek
    const week = input.currentWeek
    if (deadline != null && week != null && week > deadline) {
      return {
        ok: false,
        reason: `Trades closed after week ${deadline}. There is no offseason here — the format ends with one team standing, so this does not reopen.`,
      }
    }

    return { ok: true }
  },
}
