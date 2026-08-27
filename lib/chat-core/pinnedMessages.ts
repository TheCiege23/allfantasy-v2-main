/**
 * PINS, WHICH ARE CHAT ROWS WEARING A DIFFERENT HAT.
 *
 * ⚠ A PIN IS NOT A COLUMN — it is a `type: 'pin'` message whose body is the JSON
 * `{ messageId, snippet }`. That is why the transcript has to filter them out
 * and why reading one means parsing a body rather than reading a field. The
 * snippet is captured AT PIN TIME, so it is what the message said when it was
 * pinned; if the original is later edited the board keeps the older wording.
 * That is the storage's behaviour, not a decision made here, and it is worth
 * knowing before trusting a pinned quote.
 */

export type PinnedRef = {
  /** The id of the pin row itself — what unpin takes. */
  pinId: string
  /** The message that was pinned. May no longer exist. */
  messageId: string
  snippet: string
  pinnedBy: string
  pinnedAt: string
}

type RawPin = {
  id?: unknown
  body?: unknown
  senderName?: unknown
  createdAt?: unknown
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Turn the `/pinned` payload into something renderable.
 *
 * A row whose body will not parse is skipped rather than shown blank: a pin is
 * a claim that something was worth keeping, and an empty one makes that claim
 * about nothing.
 */
export function readPinnedRefs(rows: unknown): PinnedRef[] {
  if (!Array.isArray(rows)) return []

  const out: PinnedRef[] = []
  for (const row of rows as RawPin[]) {
    if (!isRecord(row)) continue
    const pinId = typeof row.id === 'string' ? row.id : ''
    if (!pinId) continue

    let parsed: unknown = null
    if (typeof row.body === 'string') {
      try {
        parsed = JSON.parse(row.body)
      } catch {
        continue
      }
    } else if (isRecord(row.body)) {
      parsed = row.body
    }
    if (!isRecord(parsed)) continue

    const messageId = typeof parsed.messageId === 'string' ? parsed.messageId : ''
    const snippet = typeof parsed.snippet === 'string' ? parsed.snippet.trim() : ''
    if (!messageId || !snippet) continue

    out.push({
      pinId,
      messageId,
      snippet,
      pinnedBy: typeof row.senderName === 'string' && row.senderName ? row.senderName : 'Someone',
      pinnedAt: typeof row.createdAt === 'string' ? row.createdAt : '',
    })
  }

  /* Most recently pinned first — a board is read from the top. */
  out.sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt))
  return out
}
