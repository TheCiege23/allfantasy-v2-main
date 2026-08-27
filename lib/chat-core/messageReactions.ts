/**
 * READING THE REACTIONS ALREADY STORED ON A MESSAGE.
 *
 * ⚠ THE ENDPOINTS HAVE ALWAYS WORKED AND NOTHING EVER CALLED THEM. POST and
 * DELETE on `.../messages/[messageId]/reactions` are written, access-checked and
 * live; for a fantasy league they store into `LeagueChatMessage.metadata.reactions`.
 * No surface in the app has ever sent one or rendered one.
 *
 * ⚠ THE WIRE SHAPE CARRIES `userIds`, AND THE CLIENT MUST NOT SHOW THEM. The
 * stored entry is `{ emoji, count, userIds }` — the ids are how the server knows
 * who has already reacted. All this needs from them is whether the viewer is in
 * the list; the ids themselves never reach the UI.
 *
 * Parsing is defensive because the source is a JSON metadata blob that several
 * writers touch, and a malformed entry must cost one chip rather than the row.
 */

export type StoredReaction = { emoji: string; count: number; userIds: string[] }

export type ViewerReaction = {
  emoji: string
  /** Derived from `userIds`, not from the stored `count`, which can drift. */
  count: number
  /** Whether the viewer has already reacted with this emoji. */
  mine: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Pull reactions off a message's metadata, from the viewer's point of view.
 *
 * `count` is recomputed from the id list rather than trusted: the stored
 * `count` is written by a read-modify-write and two people reacting at the same
 * moment can leave it disagreeing with the ids underneath it. The ids are the
 * record of what happened; the number is a summary of them.
 */
export function readReactions(
  metadata: unknown,
  viewerUserId: string | null | undefined,
): ViewerReaction[] {
  if (!isRecord(metadata)) return []
  const raw = metadata.reactions
  if (!Array.isArray(raw)) return []

  const out: ViewerReaction[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const emoji = typeof entry.emoji === 'string' ? entry.emoji.trim() : ''
    if (!emoji) continue

    const userIds = Array.isArray(entry.userIds)
      ? entry.userIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : []

    /*
     * An entry with no ids left is a reaction that was removed. The server
     * already filters these out on write; a stale row must not render a chip
     * showing zero.
     */
    if (userIds.length === 0) continue

    out.push({
      emoji,
      count: userIds.length,
      mine: Boolean(viewerUserId) && userIds.includes(viewerUserId as string),
    })
  }
  return out
}

/**
 * The list as it should look the instant the viewer taps, before the server has
 * answered. Kept separate from the render so the optimistic state and the state
 * that comes back from a refetch are the same shape.
 */
export function toggleReactionLocally(
  reactions: ViewerReaction[],
  emoji: string,
): ViewerReaction[] {
  const existing = reactions.find((r) => r.emoji === emoji)

  if (!existing) {
    return [...reactions, { emoji, count: 1, mine: true }]
  }

  if (existing.mine) {
    const count = existing.count - 1
    /* Dropping to zero removes the chip, matching what the server stores. */
    if (count <= 0) return reactions.filter((r) => r.emoji !== emoji)
    return reactions.map((r) => (r.emoji === emoji ? { ...r, count, mine: false } : r))
  }

  return reactions.map((r) =>
    r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r,
  )
}

/** The quick-pick set. Deliberately short — a full picker belongs in the composer. */
export const QUICK_REACTIONS = ['👍', '😂', '🔥', '😱', '💀', '🏆'] as const
