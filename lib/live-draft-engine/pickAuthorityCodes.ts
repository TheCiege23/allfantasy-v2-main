/**
 * Pick authority error codes (Commit M).
 *
 * Stable identifiers attached to every refusal returned by the canonical
 * pick-write path (`PickSubmissionService.submitPick` and the routes that
 * wrap it). The codes let the client render a precise inline error
 * (instead of redirecting / generic 400) and make race-vs-validation
 * distinctions auditable.
 *
 * Mapping convention (route -> HTTP status):
 *   DRAFT_PICK_NOT_LIVE          → 400  (draft not in progress)
 *   DRAFT_PICK_NOT_ON_CLOCK      → 403  (this roster is not on the clock,
 *                                       and caller is not commissioner)
 *   DRAFT_PICK_DUPLICATE_PLAYER  → 400  (player already drafted)
 *   DRAFT_PICK_STALE_OVERALL     → 409  (client expectedOverall != server
 *                                       picksCount + 1; refresh and retry)
 *   DRAFT_PICK_RACE_RETRY        → 409  (transaction detected concurrent
 *                                       commit; retry safe)
 *   DRAFT_PICK_OFFLINE_DRAFT     → 409  (an automatic pick in an offline draft,
 *                                       where the commissioner enters every pick)
 *
 * Stale-overall and race-retry are both 409 because the client recovery is
 * the same: refresh session snapshot and resubmit with the new
 * `expectedOverall`. The Commit J in-place session-mismatch handler can
 * key off these codes without redirecting.
 */

export const DRAFT_PICK_NOT_LIVE = 'DRAFT_PICK_NOT_LIVE' as const
export const DRAFT_PICK_NOT_ON_CLOCK = 'DRAFT_PICK_NOT_ON_CLOCK' as const
export const DRAFT_PICK_DUPLICATE_PLAYER = 'DRAFT_PICK_DUPLICATE_PLAYER' as const
export const DRAFT_PICK_STALE_OVERALL = 'DRAFT_PICK_STALE_OVERALL' as const
export const DRAFT_PICK_RACE_RETRY = 'DRAFT_PICK_RACE_RETRY' as const
export const DRAFT_PICK_INVALID_PAYLOAD = 'DRAFT_PICK_INVALID_PAYLOAD' as const
export const DRAFT_PICK_OFFLINE_DRAFT = 'DRAFT_PICK_OFFLINE_DRAFT' as const

export type PickAuthorityCode =
  | typeof DRAFT_PICK_NOT_LIVE
  | typeof DRAFT_PICK_NOT_ON_CLOCK
  | typeof DRAFT_PICK_DUPLICATE_PLAYER
  | typeof DRAFT_PICK_STALE_OVERALL
  | typeof DRAFT_PICK_RACE_RETRY
  | typeof DRAFT_PICK_INVALID_PAYLOAD
  | typeof DRAFT_PICK_OFFLINE_DRAFT

/**
 * HTTP status mapping for the route layer. Keep in lockstep with the
 * mapping table in this file's header so the contract stays readable.
 */
export function httpStatusForPickAuthorityCode(code: PickAuthorityCode): number {
  switch (code) {
    case DRAFT_PICK_NOT_ON_CLOCK:
      return 403
    case DRAFT_PICK_STALE_OVERALL:
    case DRAFT_PICK_RACE_RETRY:
    case DRAFT_PICK_OFFLINE_DRAFT:
      return 409
    case DRAFT_PICK_NOT_LIVE:
    case DRAFT_PICK_DUPLICATE_PLAYER:
    default:
      return 400
  }
}
