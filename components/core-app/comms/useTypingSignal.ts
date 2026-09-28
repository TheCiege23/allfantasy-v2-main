'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Tell the room you are typing — from the drawer, which until now only ever
 * LISTENED. DMs could show "Sam is typing…" but nobody in the drawer ever sent
 * it, so the note only appeared for people typing on other surfaces.
 *
 * ⚠ THROTTLED, NOT PER KEYSTROKE. The store behind `/typing` keeps a row alive
 * for a few seconds; re-announcing inside `REANNOUNCE_MS` adds a write and says
 * nothing new. One "started" per window, one "stopped" when the box empties or
 * the message goes, and a best-effort "stopped" on the way out.
 *
 * ⚠ FAILS SILENTLY. A lost typing ping is a missing hint, never an error the
 * writer should see — the message itself is what matters.
 */

export const REANNOUNCE_MS = 3000

export function typingUrl(threadId: string): string {
  return `/api/shared/chat/threads/${encodeURIComponent(threadId)}/typing`
}

export function useTypingSignal(threadId: string | null | undefined) {
  const lastSentAt = useRef(0)
  const announced = useRef(false)
  const current = useRef(threadId)

  const send = useCallback((id: string, isTyping: boolean) => {
    try {
      void fetch(typingUrl(id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping }),
        keepalive: !isTyping,
      }).catch(() => {})
    } catch {
      /* fetch can throw synchronously in odd environments; a hint is not worth it. */
    }
  }, [])

  /* A new conversation starts clean; the cleanup tells the old one we stopped. */
  useEffect(() => {
    current.current = threadId
    announced.current = false
    lastSentAt.current = 0
    return () => {
      if (threadId && announced.current) send(threadId, false)
      announced.current = false
    }
  }, [threadId, send])

  return useCallback(
    (typing: boolean) => {
      const id = current.current
      if (!id) return
      if (!typing) {
        if (!announced.current) return
        announced.current = false
        lastSentAt.current = 0
        send(id, false)
        return
      }
      const now = Date.now()
      if (announced.current && now - lastSentAt.current < REANNOUNCE_MS) return
      announced.current = true
      lastSentAt.current = now
      send(id, true)
    },
    [send],
  )
}
