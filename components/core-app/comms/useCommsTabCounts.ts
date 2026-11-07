'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommsTab } from './CommsDrawer'

/**
 * Unread counts for the drawer's tabs (owner's approved design, 2026-11-05: "League 4", "DMs 2"), so
 * you can see where something is waiting before tapping through five tabs to find it.
 *
 * Reads the bubble's own `/api/chat/unread` (getChatBadge) — one source, so a tab can never say 3 while
 * the bubble says 0. League is `league`, Chimmy is `chimmy`, and DMs / Huddle are `byThreadType`'s two
 * halves. Discord has no count: AllFantasy does not read that server.
 *
 * Read when the drawer opens, again on every tab switch (opening a tab is what clears it: league chat
 * moves its read marker, Chimmy POSTs `scope: 'chimmy'`, a thread moves `lastReadAt`), and every 30s
 * while the drawer is open and the page is visible.
 *
 * ⚠ A FAILED READ KEEPS THE LAST NUMBERS — the same rule as useChatBadge: zeroes after a network blip
 * would claim "all caught up". A 401 stops: a signed-out page has nothing to count.
 */

export const COMMS_TAB_COUNTS_POLL_MS = 30_000

export type CommsTabCounts = Partial<Record<CommsTab, number>> & {
  /** `league` per league id — the expanded desktop view's league list. Zero-count leagues are absent. */
  byLeague?: Record<string, number>
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

function readByLeague(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [id, n] of Object.entries(v as Record<string, unknown>)) if (count(n) > 0) out[id] = count(n)
  return out
}

/** `/api/chat/unread`'s body → a count per tab (and per league). Null when it isn't that shape. */
export function readCommsTabCounts(body: unknown): CommsTabCounts | null {
  if (!body || typeof body !== 'object') return null
  const b = body as {
    league?: unknown
    chimmy?: unknown
    byThreadType?: { dm?: unknown; group?: unknown } | null
    byLeague?: unknown
  }
  if (typeof b.league !== 'number' && typeof b.chimmy !== 'number') return null
  return {
    league: count(b.league),
    chimmy: count(b.chimmy),
    dms: count(b.byThreadType?.dm),
    huddle: count(b.byThreadType?.group),
    byLeague: readByLeague(b.byLeague),
  }
}

/** What a tab badge says: nothing at zero, and "99+" past 99 so the label never outgrows the tab. */
export function tabBadgeText(n: number | undefined): string | null {
  if (!n || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

/**
 * Called by the chat bubble (CommsDock), which hands the result to the drawer — the drawer itself
 * makes no request for opening. `tab` is the drawer's open tab, reported back through `onTabChange`.
 */
export function useCommsTabCounts(open: boolean, tab: CommsTab | null): CommsTabCounts {
  const [counts, setCounts] = useState<CommsTabCounts>({})
  const stopped = useRef(false)

  const refresh = useCallback(async () => {
    if (stopped.current) return
    try {
      const res = await fetch('/api/chat/unread', { cache: 'no-store' })
      if (res.status === 401) {
        stopped.current = true
        return
      }
      if (!res.ok) return
      const next = readCommsTabCounts(await res.json())
      if (next) setCounts(next)
    } catch {
      /* keep the last numbers */
    }
  }, [])

  /* Waits for the drawer to say which tab is open (it does on mount), so opening is one read, not two. */
  useEffect(() => {
    if (open && tab) void refresh()
  }, [open, tab, refresh])

  useEffect(() => {
    if (!open) return
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const id = window.setInterval(tick, COMMS_TAB_COUNTS_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [open, refresh])

  return counts
}
