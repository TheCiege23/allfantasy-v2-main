/**
 * Single source of truth for draft-room pick affordances (snake / linear).
 * Mirrors DraftRoomPageClient gate logic — keep in sync when changing pick rules.
 */

import type { CurrentOnTheClock, DraftSessionSnapshot } from '@/lib/live-draft-engine/types'
import type { buildDraftRoomCoreState } from '@/lib/live-draft-engine/draftRoomCoreState'

type DraftCore = ReturnType<typeof buildDraftRoomCoreState> | null

export type DraftPickActionDenialReason =
  | 'eligible'
  | 'roster_configuration_incomplete'
  | 'draft_not_in_progress'
  | 'draft_paused'
  | 'overnight_window_blocks_picks'
  | 'no_active_pick'
  | 'pick_in_flight'
  | 'not_your_pick'
  | 'draft_board_not_ready'

export type DraftPickActionState = {
  /**
   * Snake/linear: same boolean fed into `deriveDraftRoomGateState` as `snakeCanDraft`
   * (before roster-configuration gate; after that gate → `draftRoomState.canDraft`).
   */
  snakeCanDraftRaw: boolean
  /** Shorthand for `snakeCanDraftRaw` (pool/detail affordance when roster config is complete). */
  canPick: boolean
  /** Viewer’s roster matches current pick roster (normalized ids). */
  viewerOnClock: boolean
  viewerRosterId: string | null
  topBarOnClockRosterId: string | null
  currentOverall: number | null
  denialReason: DraftPickActionDenialReason
}

export function normalizeDraftRosterId(id: string | undefined | null): string {
  if (id == null) return ''
  return String(id).trim()
}

/**
 * Compute snake pick gate inputs aligned with the live draft session:
 * - Compare roster ids with trim so UUID/text mismatches from whitespace don’t hide the Draft action.
 * - Use {@link CurrentOnTheClock} roster for “on clock” — same source as the top bar pick pill.
 */
export function getDraftPickActionState(args: {
  session: DraftSessionSnapshot | null
  draftCore: DraftCore
  currentPick: CurrentOnTheClock | null
  currentUserRosterId: string | undefined | null
  overnightBlocksUserPicks: boolean
  pickSubmitting: boolean
  commissionerOfflinePick: boolean
}): DraftPickActionState {
  const viewerNorm = normalizeDraftRosterId(args.currentUserRosterId ?? null)
  const viewerRosterId = viewerNorm.length > 0 ? viewerNorm : null

  const cp = args.currentPick
  const clockRosterNorm = cp?.rosterId != null ? normalizeDraftRosterId(cp.rosterId) : ''
  const topBarOnClockRosterId = clockRosterNorm.length > 0 ? clockRosterNorm : null

  const viewerOnClock = Boolean(
    viewerRosterId &&
      args.session?.status === 'in_progress' &&
      cp &&
      cp.overall > 0 &&
      topBarOnClockRosterId &&
      topBarOnClockRosterId === viewerRosterId,
  )

  const dc = args.draftCore
  const snakeCanDraftRaw =
    args.session != null &&
    args.session.status === 'in_progress' &&
    !args.overnightBlocksUserPicks &&
    dc?.draftStarted === true &&
    (dc?.currentOverall ?? 0) > 0 &&
    args.pickSubmitting === false &&
    (args.commissionerOfflinePick || viewerOnClock)

  let denialReason: DraftPickActionDenialReason = 'eligible'
  if (!snakeCanDraftRaw) {
    if (!args.session || args.session.status === 'pre_draft' || args.session.status === 'completed') {
      denialReason = 'draft_not_in_progress'
    } else if (args.session.status === 'paused') {
      denialReason = 'draft_paused'
    } else if (args.overnightBlocksUserPicks) {
      denialReason = 'overnight_window_blocks_picks'
    } else if (args.pickSubmitting) {
      denialReason = 'pick_in_flight'
    } else if (!dc?.draftStarted || (dc?.currentOverall ?? 0) <= 0) {
      denialReason = 'no_active_pick'
    } else if (!args.commissionerOfflinePick && !viewerOnClock) {
      denialReason = 'not_your_pick'
    } else {
      denialReason = 'draft_board_not_ready'
    }
  }

  return {
    snakeCanDraftRaw,
    canPick: snakeCanDraftRaw,
    viewerOnClock,
    viewerRosterId,
    topBarOnClockRosterId,
    currentOverall: cp?.overall ?? null,
    denialReason,
  }
}
