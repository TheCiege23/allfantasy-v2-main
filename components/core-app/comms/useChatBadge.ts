'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The chat bubble's number, kept current between page loads.
 *
 * The page renders the badge once from `getChatBadge` and hands it down as props. On its own that
 * number only moved on navigation, so a message that arrived while someone sat on one screen never
 * showed. This re-reads `/api/chat/unread` (the same `getChatBadge`, no-store):
 *   - every minute while the tab is visible and the drawer is closed,
 *   - when the tab becomes visible again,
 *   - right after the drawer closes — reading a conversation is what clears it.
 *
 * ⚠ THE PROPS STILL WIN WHEN THEY CHANGE. A navigation re-renders the page with a fresh server count;
 * that replaces whatever the last poll said rather than fighting it.
 *
 * ⚠ A FAILED READ KEEPS THE LAST NUMBER. An empty badge after a network blip would read as "all
 * caught up", which is a claim the client cannot make. A 401 stops polling: a signed-out page has
 * nothing to count.
 */

export const CHAT_BADGE_POLL_MS = 60_000

export type ChatBadgeCounts = { unread: number; mentions: number }

function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null
}

/** `/api/chat/unread`'s body → the two numbers the bubble shows. Null when it isn't that shape. */
export function readChatBadge(body: unknown): ChatBadgeCounts | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { total?: unknown; mentions?: unknown }
  const unread = count(b.total)
  const mentions = count(b.mentions)
  if (unread == null || mentions == null) return null
  return { unread, mentions }
}

export function useChatBadge(initialUnread: number, initialMentions: number, drawerOpen: boolean): ChatBadgeCounts {
  const [counts, setCounts] = useState<ChatBadgeCounts>({ unread: initialUnread, mentions: initialMentions })
  const stopped = useRef(false)
  const wasOpen = useRef(drawerOpen)

  useEffect(() => {
    setCounts({ unread: initialUnread, mentions: initialMentions })
  }, [initialUnread, initialMentions])

  const refresh = useCallback(async () => {
    if (stopped.current) return
    try {
      const res = await fetch('/api/chat/unread', { cache: 'no-store' })
      if (res.status === 401) {
        stopped.current = true
        return
      }
      if (!res.ok) return
      const next = readChatBadge(await res.json())
      if (next) setCounts(next)
    } catch {
      /* keep the last number */
    }
  }, [])

  useEffect(() => {
    if (wasOpen.current && !drawerOpen) void refresh()
    wasOpen.current = drawerOpen
  }, [drawerOpen, refresh])

  useEffect(() => {
    if (drawerOpen) return
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const id = window.setInterval(tick, CHAT_BADGE_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [drawerOpen, refresh])

  return counts
}
