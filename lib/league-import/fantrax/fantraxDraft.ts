/**
 * Fantrax draft results → the canonical `draft_picks` shape.
 *
 * 🛑 THE ENDPOINTS WERE CATALOGUED AND NEVER CALLED. `getDraftPicks` and
 * `getDraftResults` sat in `FANTRAX_ENDPOINTS` with no wrapper function while
 * every other entry had one, so `FantraxAdapter`'s coverage reported
 * `draftHistory` as "currently reflects traded draft-pick events when
 * available" — i.e. traded picks only, never an actual draft. A completed
 * 192-pick draft was one unwritten function away.
 *
 * Every claim below is measured against the committed fixtures
 * (`__tests__/fixtures/fantrax-draft-results.json`, `…-picks.json`, Cream Bowl),
 * not inferred.
 *
 * ── TWO THINGS THAT WILL BITE ────────────────────────────────────────────────
 *
 * 🛑 `pick` MEANS DIFFERENT THINGS IN THE TWO ENDPOINTS. `getDraftResults.pick`
 * is the OVERALL pick (1-192 in a 12-team, 16-round league);
 * `getDraftPicks.pick` is the pick WITHIN the round (1-12). Joining them on
 * `round + pick + teamId` returns ZERO matches — measured, 36 against 36 with no
 * overlap. Join on `round + pickInRound + teamId` and they are exactly equal.
 *
 * ⚠ `playerId` IS ABSENT, NOT NULL, ON AN UNMADE PICK. 156 of the fixture's 192
 * slots carry one; the other 36 simply lack the key. Those 36 are the same picks
 * `getDraftPicks.currentDraftPicks` reports as outstanding — verified as an exact
 * set match once the `pick`/`pickInRound` confusion above is accounted for.
 *
 * So a draft board is not a list of picks made: it is a list of SLOTS, and only
 * the filled ones are draft history.
 */
import type { FantraxDraftResults } from '@/lib/league-import/fantrax/fantraxApi'
import type { NormalizedDraftPick } from '@/lib/league-import/types'

export interface FantraxDraftSummary {
  picks: NormalizedDraftPick[]
  /** Slots in the board, filled or not. */
  slotCount: number
  /** Slots with a player — what becomes draft history. */
  madeCount: number
  /** Slots still outstanding. `slotCount - madeCount`, surfaced so coverage can say so. */
  outstandingCount: number
  /** Fantrax's own word for the draft's state ("completed"), or null. */
  draftState: string | null
}

/**
 * Map a draft board onto `NormalizedDraftPick[]`.
 *
 * ⚠ ONLY MADE PICKS ARE EMITTED, and that is forced by the canonical type rather
 * than chosen: `NormalizedDraftPick.source_player_id` is a required string. An
 * unmade slot has no player, and filling it with `''` or a placeholder would put
 * rows in draft history for picks that never happened — indistinguishable, to
 * every reader, from a real pick of an unknown player.
 *
 * The outstanding count is returned alongside so the caller can report the gap
 * honestly instead of the absence being invisible.
 */
export function mapFantraxDraftResults(
  results: FantraxDraftResults | null | undefined,
  options: { season?: number | null } = {},
): FantraxDraftSummary {
  const slots = Array.isArray(results?.picks) ? results!.picks : []
  const picks: NormalizedDraftPick[] = []

  for (const slot of slots) {
    /*
     * ⚠ `playerId` null means the slot is UNMADE — see the header. This is the
     * one branch that decides whether draft history is real or invented.
     */
    if (!slot.playerId) continue

    picks.push({
      round: slot.round,
      /*
       * ⚠ `pick` (OVERALL), NOT `pickInRound`. The canonical `pick_no` is the
       * overall selection number — Sleeper's `pick_no` is overall, and every
       * consumer treats it that way. Writing the in-round number here would make
       * every round look like it had twelve first-round picks.
       */
      pick_no: slot.pick,
      source_roster_id: slot.teamId,
      source_player_id: slot.playerId,
      ...(options.season != null ? { season: options.season } : {}),
    })
  }

  const madeCount = picks.length
  const slotCount = slots.length

  return {
    picks,
    slotCount,
    madeCount,
    outstandingCount: slotCount - madeCount,
    draftState: results?.draftState ?? null,
  }
}

/**
 * A coverage note describing what the draft import actually got.
 *
 * ⚠ DELIBERATELY DISTINGUISHES "NOT DRAFTED YET" FROM "PARTIALLY DRAFTED" FROM
 * "COMPLETE". The previous note said only that draft history "reflects traded
 * draft-pick events", which was true and told a reader nothing about whether
 * their league's draft came across.
 */
export function describeFantraxDraftCoverage(summary: FantraxDraftSummary): string {
  if (summary.slotCount === 0) return 'No Fantrax draft board was available for this league.'
  if (summary.madeCount === 0) {
    return `Fantrax reports a ${summary.slotCount}-slot draft board with no picks made yet.`
  }
  if (summary.outstandingCount > 0) {
    return `${summary.madeCount} of ${summary.slotCount} Fantrax draft slots have been picked; ${summary.outstandingCount} are still outstanding.`
  }
  return `All ${summary.madeCount} Fantrax draft picks were imported.`
}
