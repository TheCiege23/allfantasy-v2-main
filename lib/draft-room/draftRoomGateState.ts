/**
 * Single derived gate state for the live draft room so panels stay consistent with roster policy + session.
 */

import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'

export type DraftRoomTimerMode = 'live' | 'paused' | 'blocked'

type DraftRoomGateState = {
  rosterConfigurationIncomplete: boolean
  rosterConfigurationMessage?: string
  canDraft: boolean
  canNominate: boolean
  canBid: boolean
  timerMode: DraftRoomTimerMode
}

const DEFAULT_INCOMPLETE_MSG =
  'Roster configuration is incomplete. The commissioner must save roster slots before drafting.'

/**
 * Combine roster gate + snake/auction affordances + timer display policy.
 * Pass booleans already computed for “would be allowed if roster were complete”.
 */
export function deriveDraftRoomGateState(args: {
  session: DraftSessionSnapshot | null
  rosterConfigurationIncomplete: boolean
  rosterConfigurationMessage?: string | null
  /** Snake/linear: on-clock and UI rules satisfied */
  snakeCanDraft: boolean
  /** Auction: user may nominate */
  auctionCanNominate: boolean
  /** Auction: user may bid on current nomination */
  auctionCanBid: boolean
}): DraftRoomGateState {
  const blocked = Boolean(args.rosterConfigurationIncomplete)
  const msg =
    blocked
      ? (args.rosterConfigurationMessage?.trim() || DEFAULT_INCOMPLETE_MSG)
      : undefined

  const st = args.session?.status
  const timerStatus = args.session?.timer?.status ?? 'none'

  let timerMode: DraftRoomTimerMode = 'live'
  if (blocked) {
    timerMode = 'blocked'
  } else if (st === 'paused' || timerStatus === 'paused') {
    timerMode = 'paused'
  } else {
    timerMode = 'live'
  }

  return {
    rosterConfigurationIncomplete: blocked,
    rosterConfigurationMessage: msg,
    canDraft: !blocked && args.snakeCanDraft,
    canNominate: !blocked && args.auctionCanNominate,
    canBid: !blocked && args.auctionCanBid,
    timerMode,
  }
}
