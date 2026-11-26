/**
 * "Trade for this pick" on the draft board (owner's rule, 2026-11-26). PURE — the board, the trade panel
 * and the suggestions route all read the same two functions, so the button and the server never disagree.
 *
 * WHERE IT SHOWS: only in SLOW drafts — a pick clock of 5 minutes or longer (`DraftSession.timerSeconds`,
 * the commissioner's pick clock; there is no "slow draft" mode, see `pickClockPlanning.ts`) — and NEVER in
 * an auction (an auction has no pick tiles to trade for). In a fast draft there is no time to negotiate a
 * swap before the clock runs, so the action would mostly produce offers that expire unanswered.
 *
 * ON WHICH TILE: another team's UPCOMING pick, while the draft is live and the league allows pick trades
 * (`draft_pick_trade_enabled`). Not a pick already made, not the viewer's own pick, not a keeper-locked slot,
 * and not a pick its holder got by trade: the existing pick-trade panel offers a manager's picks in their own
 * draft slot only (`DraftPickTradePanel` → `validReceiveRounds`), so a traded pick could not be prefilled.
 */

export const TRADE_FOR_PICK_MIN_TIMER_SECONDS = 5 * 60

/** At most this many suggested offers are shown for a target pick. */
export const TRADE_FOR_PICK_MAX_SUGGESTIONS = 3

/** The draft-level half: does this draft offer "Trade for this pick" at all? */
export function tradeForPickDraftEligible(draft: {
  timerSeconds: number | null | undefined
  draftType: string | null | undefined
  status: string | null | undefined
  pickTradeEnabled: boolean | null | undefined
}): boolean {
  if (String(draft.draftType ?? '').toLowerCase() === 'auction') return false
  if (draft.status !== 'in_progress') return false
  if (draft.pickTradeEnabled === false) return false
  const t = draft.timerSeconds
  return typeof t === 'number' && Number.isFinite(t) && t >= TRADE_FOR_PICK_MIN_TIMER_SECONDS
}

/** The tile-level half: may the viewer ask for THIS pick? (Call only when the draft is eligible.) */
export function tradeForPickTileEligible(tile: {
  viewerRosterId: string | null | undefined
  ownerRosterId: string | null | undefined
  /** The roster whose own draft slot this pick is (slot order at `slot`). */
  slotRosterId: string | null | undefined
  /** The pick has a player (or a skip) on it. */
  made: boolean
  keeperLocked?: boolean
}): boolean {
  if (!tile.viewerRosterId || !tile.ownerRosterId) return false
  if (tile.made || tile.keeperLocked) return false
  if (tile.ownerRosterId === tile.viewerRosterId) return false
  return tile.slotRosterId != null && tile.slotRosterId === tile.ownerRosterId
}
