'use client'

import { ReadTicks } from './ThreadListRow'

type Receipt = {
  userId: string
  displayName: string | null
  username: string | null
  lastReadAt: string | null
}

type Msg = { id: string; senderUserId: string | null; createdAt: string }

/**
 * Who has read the last thing you said.
 *
 * ⚠ ONLY THE LAST MESSAGE YOU SENT. Marking every row would be a column of
 * noise down the side of the thread, and the only message anybody actually
 * wonders about is the most recent thing they said themselves.
 *
 * ⚠ SILENT WHEN IT DOES NOT KNOW. A member with no `lastReadAt` has never
 * opened the thread on a build that recorded it — that is absence of evidence,
 * not evidence they ignored you, and this is a room where people negotiate
 * trades. Nobody is ever listed as having NOT read something: until someone has, the line is a
 * single tick and "Sent" (✓), and it becomes ✓✓ "Seen by …" once they have.
 */
export function SeenBy({
  messages,
  receipts,
  viewerUserId,
}: {
  messages: Msg[]
  receipts: Receipt[]
  /** When absent, the last message with a sender is treated as the viewer's. */
  viewerUserId?: string | null
}) {
  if (messages.length === 0 || receipts.length === 0) return null

  const mine = viewerUserId
    ? [...messages].reverse().find((m) => m.senderUserId === viewerUserId)
    : [...messages].reverse().find((m) => m.senderUserId)
  if (!mine) return null

  const sentAt = new Date(mine.createdAt).getTime()
  if (!Number.isFinite(sentAt)) return null

  const seen = receipts.filter((r) => {
    if (r.userId === mine.senderUserId) return false
    if (!r.lastReadAt) return false
    const at = new Date(r.lastReadAt).getTime()
    return Number.isFinite(at) && at >= sentAt
  })

  /*
   * Nobody past it yet: one tick and "Sent". That is a fact about the message (it is saved and in
   * their thread), not a claim about the reader — nobody is named, and nothing says "unread".
   */
  if (seen.length === 0) {
    return (
      <p className="af-cm-seenby" data-seen="false">
        <ReadTicks seen={false} announce={false} />
        <span>Sent</span>
      </p>
    )
  }

  const names = seen.map((r) => r.displayName || r.username || 'Someone')
  const label =
    names.length <= 2
      ? `Seen by ${names.join(' and ')}`
      : `Seen by ${names.slice(0, 2).join(', ')} +${names.length - 2}`

  return (
    <p className="af-cm-seenby" data-seen="true">
      <ReadTicks seen announce={false} />
      <span>{label}</span>
    </p>
  )
}

export default SeenBy
