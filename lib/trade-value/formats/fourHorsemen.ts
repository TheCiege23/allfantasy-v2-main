/**
 * Four Horsemen — the first per-format value model, and the reference implementation.
 *
 * Built from the league's actual rulebook rather than from a category label. PURE.
 *
 * ── WHAT THE SHARED ENGINE ALREADY HANDLES, AND THIS MUST NOT RE-APPLY ──────────────────────
 * `LeagueShape` and the overall-pick curve already price six of the eleven breakages the rulebook
 * audit found. Re-applying any of them here would double-count:
 *
 *   4 teams                     → shape.teams, feeding demandMultiplier
 *   4 QB / 4 RB / 6 WR / 4 TE   → shape.dedicatedStarters
 *   10 FLEX                     → shape.flexGroups, split across RB/WR/TE
 *   80-man rosters              → shape.rosterSize / benchSlots
 *   10-round rookie draft       → pickValueByOverall, keyed on overall pick number
 *   trade deadline week 13      → shape.deadlineWeek
 *
 * This module handles only what remains: the parts of the rulebook no generic shape can express.
 *
 * ── WHAT THIS ADDS ──────────────────────────────────────────────────────────────────────────
 *   1. The trade deadline as LEGALITY, not a discount (rules §9: closed weeks 13–17).
 *   2. The 20 free stash slots (10 taxi + 10 IR) making a young player cheap to hold.
 *   3. The Eliminator side pot — floor-vs-ceiling — but ONLY when real strike state is supplied.
 *
 * ── 🛑 WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────
 * The league's scoring is largely inexpressible by this engine — −1 per incompletion, +0.5 per
 * completion, first downs, 40+ yard bonuses, yardage thresholds. The incompletion penalty alone
 * reinvents quarterback value: a 40-attempt, 60%-completion QB loses ~16 points a game to
 * incompletions and gains ~12 for completions, a −4 swing that full-PPR scoring puts at zero.
 *
 * This model does NOT attempt a correction for that. It cannot: the projection reaching it was
 * built under `ppr`, and inventing a QB discount here would be a guess stacked on a mismeasurement.
 * The honest fix is offensive component scoring in the projection engine (plan step 3.2), and
 * until that lands this model says nothing about it rather than pretending.
 */

import type { FormatAdjustment, FormatValueInput, FormatValueModel, TradeLegality } from './types'
import { isPastTradeDeadline, stashCapacity } from '../leagueShape'

/** Rules §9: "Trades are prohibited from after 13 through 17." */
export const FOUR_HORSEMEN_DEADLINE_WEEK = 13

/**
 * Rules §4: taxi is "for players with 3 years or less experience".
 *
 * ⚠ The rulebook also says players must be placed on taxi BEFORE the regular season starts, so
 * mid-season this is a claim about NEXT year's flexibility rather than this week's. That is why
 * the bonus below is small and framed as optionality, not as a discount on a roster spot.
 */
export const TAXI_MAX_EXPERIENCE = 3

/**
 * How much a free stash slot is worth, as a multiplier on a taxi-eligible young player.
 *
 * ⚠ THIS IS A JUDGEMENT, NOT A MEASUREMENT, AND IT IS SMALL ON PURPOSE. Nothing in this codebase
 * has measured what stash capacity is worth, and the honest size of an unmeasured effect is a
 * nudge. It is stated as a named constant so it can be argued with and replaced by a measurement
 * rather than buried in an expression.
 */
export const STASH_OPTIONALITY_BONUS = 1.05

/**
 * Eliminator strike thresholds. Rules §7: lowest weekly scorer takes a strike; four strikes and
 * your scores stop counting and you are out of the $50 side pot.
 */
export const ELIMINATOR_STRIKES_TO_ELIMINATION = 4

/** Team state this model understands. Absent members simply switch the relevant effect off. */
export interface FourHorsemenTeamState {
  /** Eliminator strikes accrued. 0–4. */
  eliminatorStrikes?: number | null
  /** True once the team is out of the Eliminator — its scores no longer count toward that pot. */
  eliminatorEliminated?: boolean | null
  /** Whether league dues are paid for the season of any future pick being traded (rules §9). */
  duesPaidThroughSeason?: number | null
}

function readState(input: FormatValueInput): FourHorsemenTeamState | null {
  const s = input.teamState
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null
  return s as FourHorsemenTeamState
}

/**
 * Floor-over-ceiling weight from Eliminator strikes.
 *
 * A manager on three strikes is one bad week from losing the side pot, and for them a safe floor
 * is worth more than a boom/bust ceiling — the opposite of what the championship rewards. That is
 * a genuine second value axis running beside the first, which is why the Eliminator is called out
 * separately in the rulebook rather than folded into the standings.
 *
 * ⚠ RETURNS NULL WITH NO STRIKE DATA, WHICH IS THE COMMON CASE. Guessing a strike count would
 * apply a real adjustment on invented state. No strikes supplied ⇒ this model has no opinion.
 *
 * ⚠ AND IT DOES NOT MOVE PRICE, ONLY PREFERENCE. Strikes say which KIND of player this manager
 * should want, not that any player is worth more in absolute terms — so the multiplier is 1.0 and
 * the payload is the reason. A consumer that wants to re-rank on floor can read the sentence; one
 * that wants a price is correctly told nothing changed.
 */
function eliminatorPressure(state: FourHorsemenTeamState | null): FormatAdjustment | null {
  if (!state) return null
  if (state.eliminatorEliminated === true) {
    return {
      multiplier: 1.0,
      reason:
        'This team is out of the Eliminator, so its weekly scores no longer count toward that ' +
        'side pot. Weekly floor stops mattering; only the championship does.',
    }
  }
  const strikes = state.eliminatorStrikes
  if (strikes == null || !Number.isFinite(strikes) || strikes <= 0) return null

  const remaining = ELIMINATOR_STRIKES_TO_ELIMINATION - strikes
  if (remaining <= 0) return null
  if (remaining === 1) {
    return {
      multiplier: 1.0,
      reason:
        `Three Eliminator strikes — one more low week and this team is out of the $50 side pot. ` +
        `A safe weekly floor is worth more than a boom/bust ceiling right now, which is the ` +
        `opposite of what the championship rewards.`,
    }
  }
  return {
    multiplier: 1.0,
    reason:
      `${strikes} Eliminator strike${strikes === 1 ? '' : 's'} — ${remaining} from elimination. ` +
      `Weekly floor is starting to matter alongside season totals.`,
  }
}

export const fourHorsemenModel: FormatValueModel = {
  formatId: 'four_horsemen',
  label: 'Four Horsemen',

  adjust(input: FormatValueInput): FormatAdjustment | null {
    const state = readState(input)

    /*
     * Stash optionality. 10 taxi + 10 IR is 20 free slots on an 80-man roster, so holding a young
     * player costs this manager nothing — where in a 15-man redraft roster it costs a contributor.
     * Applied only to a taxi-ELIGIBLE player, because that is what the rule actually grants.
     */
    const stash = stashCapacity(input.shape)
    const exp = input.experience
    const taxiEligible = exp != null && Number.isFinite(exp) && exp <= TAXI_MAX_EXPERIENCE
    if (stash != null && stash >= 10 && taxiEligible) {
      return {
        multiplier: STASH_OPTIONALITY_BONUS,
        reason:
          `${stash} free taxi/IR slots and ${input.shape.benchSlots ?? '—'} bench spots mean ` +
          `holding a ${exp}-year player costs this roster nothing. Cheap to stash, so worth ` +
          `slightly more here than in a league where he occupies a contributor's seat.`,
      }
    }

    // The Eliminator has no price effect, but its reason is worth surfacing when state exists.
    return eliminatorPressure(state)
  },

  /**
   * Rules §9, two separate prohibitions, both legality rather than valuation.
   *
   * ⚠ THE DEADLINE IS READ FROM THE SHAPE, NOT FROM THE CONSTANT. `FOUR_HORSEMEN_DEADLINE_WEEK`
   * documents what the rulebook says; the shape carries what the league is actually configured
   * with. If they disagree the configuration wins, because that is what will enforce it — and a
   * model that trusted its own constant would tell a manager a trade is legal while the platform
   * refuses it.
   */
  canTrade(input: FormatValueInput): TradeLegality {
    if (isPastTradeDeadline(input.shape, input.currentWeek)) {
      return {
        ok: false,
        reason:
          `Trades are closed after week ${input.shape.deadlineWeek} in this league (rules §9: ` +
          `"Trades are prohibited from after 13 through 17"). They reopen the day after the ` +
          `championship game.`,
      }
    }
    return { ok: true }
  },
}
