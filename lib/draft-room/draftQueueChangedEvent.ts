/**
 * "Your draft queue changed on the server" — fired in the page when a Chimmy queue card is confirmed,
 * so an open draft room reloads its queue at once.
 *
 * 🛑 WITHOUT IT THE ROOM WOULD UNDO THE CHANGE. The room keeps the queue in client state and saves the
 * WHOLE list on every drag (`handleQueueSave`), and it re-reads the queue only on load, resync and its
 * own actions. A queue Chimmy saved would sit unseen until the user's next drag — which would then
 * save the room's stale copy over it, with no conflict and nothing on screen.
 *
 * Client-safe: no imports.
 */
export const DRAFT_QUEUE_CHANGED_EVENT = 'allfantasy:draft-queue-changed'

export type DraftQueueChangedDetail = { leagueId: string }

export function emitDraftQueueChanged(leagueId: string): void {
  if (typeof window === 'undefined' || !leagueId) return
  window.dispatchEvent(new CustomEvent<DraftQueueChangedDetail>(DRAFT_QUEUE_CHANGED_EVENT, { detail: { leagueId } }))
}
