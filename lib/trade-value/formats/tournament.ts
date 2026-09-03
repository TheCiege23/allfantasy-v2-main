/**
 * Tournament — the third per-format value model.
 *
 * ── 🛑 THE DENOMINATOR IS SELF-RELATIVE, AND THAT WAS THE WHOLE BLOCKER ─────────────────────
 * `lib/trade-intel/tournament.ts` derives expected remaining games as **2 − 2^−(R−1)**: you are
 * guaranteed this round, then each further one at half the previous chance. It never reaches 2.
 *
 * Turning that into a multiplier needs a denominator, and the obvious candidates are all invented.
 * "Worth 2/17 of a season player" picks 17; "2/14" picks 14. Either number decides the answer and
 * neither is written down anywhere.
 *
 * So this uses the same shape guillotine does: measure against THIS bracket's own start.
 *
 *     multiplier = (2 − 2^−(R−1)) / (2 − 2^−(S−1))
 *
 * where R is rounds remaining and S is the rounds the bracket started with. Entering a 4-round
 * bracket you expect 1.875 games; at the final, 1.0 — a multiplier of 0.53. Nothing is invented,
 * and the number means "against what the same player was worth to you when the bracket began".
 *
 * ⚠ IT MOVES LESS THAN PEOPLE EXPECT, AND THAT IS THE FINDING, NOT A BUG. Across an entire
 * four-round bracket the value falls by 47%, and a SEVEN-round bracket starts at 1.98 expected
 * games against a four-round bracket's 1.875 — barely different. `bracketHorizon` says so in its
 * own words: "Seven weeks of bracket is not seven weeks of value." Depth is nearly irrelevant;
 * only how close you are to the end matters.
 *
 * ── WHAT IT DOES NOT PRICE ─────────────────────────────────────────────────────────────────
 * FAAB resets and the roster dissolving at the next redraft are reported as prose by the
 * trade-intel module. They change what you should DO, not what an asset is worth per game, and
 * folding them into a multiplier would double-count against the horizon already applied here.
 */

import { bracketHorizon, tradingPolicy } from '@/lib/trade-intel/tournament'
import type { FormatAdjustment, FormatValueInput, FormatValueModel, TradeLegality } from './types'

/**
 * Live tournament state. Narrowed here so no other format model depends on it.
 *
 * ⚠ `startingRounds` IS REQUIRED FOR A MULTIPLIER, and absent means no opinion rather than a
 * guessed bracket size. A 4-round and a 7-round bracket at the same `roundsRemaining` are
 * genuinely different positions, and inventing the start would invent the answer.
 */
interface TournamentTeamState {
  roundsRemaining?: unknown
  startingRounds?: unknown
  /** Whether the commissioner enabled trading. Null/absent means unknown, which is NOT "yes". */
  tradesEnabled?: unknown
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

function readState(teamState: unknown): TournamentTeamState | null {
  if (!teamState || typeof teamState !== 'object' || Array.isArray(teamState)) return null
  return teamState as TournamentTeamState
}

export const tournamentModel: FormatValueModel = {
  formatId: 'tournament',
  label: 'Tournament',

  adjust(input: FormatValueInput): FormatAdjustment | null {
    const s = readState(input.teamState)
    if (!s) return null

    const remaining = num(s.roundsRemaining)
    const start = num(s.startingRounds)
    if (remaining == null || start == null) return null
    if (remaining < 1 || start < 1 || remaining > start) return null

    const now = bracketHorizon({ roundsRemaining: remaining })
    const atStart = bracketHorizon({ roundsRemaining: start })
    if (!now || !atStart || atStart.expectedGames <= 0) return null

    const multiplier = now.expectedGames / atStart.expectedGames

    return {
      multiplier,
      reason:
        remaining === start
          ? `The bracket has not started losing rounds yet, so a trade is worth what it was worth at the outset — about ${now.expectedGames} more games either way.`
          : `${remaining} of ${start} rounds remain. Single elimination means you expect about ${now.expectedGames} more games against ${atStart.expectedGames} at the start, so a trade is worth roughly ${Math.round(multiplier * 100)}% of what the same trade was worth when the bracket began.`,
    }
  },

  canTrade(input: FormatValueInput): TradeLegality {
    const s = readState(input.teamState)
    /*
     * 🛑 UNKNOWN IS NOT PERMITTED, AND THAT IS `tradingPolicy`'s DECISION, NOT MINE. Most
     * tournaments forbid trading outright; reporting a tradeable asset in one that does not allow
     * it implies a deal that cannot happen. So `null` returns `permitted: false` with a reason
     * saying to confirm, rather than defaulting to yes.
     *
     * ⚠ Note this is the OPPOSITE default from the deadline checks in the other models, where an
     * unknown week means "do not assume closed". The asymmetry is deliberate: a deadline is a date
     * that has probably not passed, and a tournament trade rule is a setting that is probably off.
     */
    const enabled =
      typeof s?.tradesEnabled === 'boolean' ? s.tradesEnabled : null
    const policy = tradingPolicy({ tradesEnabled: enabled })
    return policy.permitted ? { ok: true } : { ok: false, reason: policy.basis }
  },
}
