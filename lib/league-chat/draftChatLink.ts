/**
 * How league chat and the draft room point at each other. Pure — safe in client code.
 *
 * ⚠ ONE TABLE, TWO VIEWS, NO SCHEMA CHANGE. Every draft-room message is already a
 * `LeagueChatMessage`. What separates the two chats is `source`:
 *   - `source = null`    — a league chat message. The draft room writes these while the
 *                          commissioner's "live draft chat sync" is on during a live draft.
 *   - `source = 'draft'` — a draft-room message (sync off), or a pick announcement
 *                          (`type = 'draft_pick'`, always draft-only).
 *
 * So "linked" is decided by what each view reads, never by copying rows:
 *   - League chat folds the draft room's messages in — labelled — while a draft is live, and
 *     leaves the pick-by-pick feed in the draft room, where it belongs (40 picks would push
 *     every human message out of a 40-message window inside a few rounds).
 *   - The draft room can open the league's chat itself, and posts there go to the league.
 */

/** Draft statuses during which the room is worth opening from league chat. */
export const LIVE_DRAFT_STATUSES: ReadonlySet<string> = new Set(['in_progress', 'paused'])

/** Pick announcements stay in the draft room; league chat never shows them. */
export const DRAFT_ROOM_ONLY_TYPES: readonly string[] = ['draft_pick']

export type LeagueDraftLink = {
  /** True while the draft is running or paused mid-draft. */
  live: boolean
  status: string
  /** Where the live draft room lives for this league. */
  href: string
}

export function draftRoomHref(leagueId: string): string {
  return `/league/${encodeURIComponent(leagueId)}/draft`
}

/**
 * Whether league chat should include the draft room's messages.
 *
 * An explicit `includeDraft=1` / `=0` from the reader wins. With no preference, the draft
 * room is folded in exactly while a draft is live — the one time the two conversations are
 * about the same thing.
 */
export function resolveIncludeDraft(param: string | null | undefined, draftLive: boolean): boolean {
  if (param === '1') return true
  if (param === '0') return false
  return draftLive
}

/** A league chat row that came from the draft room (as opposed to one posted in league chat). */
export function isDraftRoomSource(source: unknown): boolean {
  return source === 'draft'
}
