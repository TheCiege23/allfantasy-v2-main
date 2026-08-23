'use client'

import { useOptionalSession } from '@/components/auth/useOptionalSession'
import { useEffect, useState } from 'react'

const SESSION_POST_THROTTLE_MS = 10 * 60_000
const STORAGE_KEY = 'af-time-engine-device-sync-at'

/**
 * Captures browser IANA timezone + local clock (ISO), POSTs to server on a throttle.
 * Server compares to UTC for skew; official logic always uses server time + account timezone.
 * Shows a single non-intrusive notice when the API reports a mismatch.
 */
export function TimeEngineClientSync() {
  const { status } = useOptionalSession()
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'authenticated' || typeof window === 'undefined') return

    const run = async () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const iso = new Date().toISOString()

        const lastRaw = sessionStorage.getItem(STORAGE_KEY)
        const last = lastRaw ? parseInt(lastRaw, 10) : 0
        const shouldPost = !last || Date.now() - last > SESSION_POST_THROTTLE_MS

        if (shouldPost && tz) {
          const post = await fetch('/api/user/time-context', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ deviceTimezone: tz, deviceLocalIso: iso }),
          })
          if (post.ok) {
            sessionStorage.setItem(STORAGE_KEY, String(Date.now()))
          }
        }

        const get = await fetch('/api/user/time-context', { credentials: 'same-origin', cache: 'no-store' })
        if (!get.ok) return
        const data = (await get.json()) as {
          context?: { warnings?: string[]; timeMismatchFlag?: boolean }
        }
        const w = data.context?.warnings
        if (Array.isArray(w) && w.length > 0) {
          setNotice(w.slice(0, 2).join(' '))
        } else {
          setNotice(null)
        }
      } catch {
        setNotice(null)
      }
    }

    void run()
  }, [status])

  if (!notice) return null

  return (
    /*
     * ⚠ TOKENS, NOT HARDCODED DARK — AND THE OLD CLASSES MADE THIS NOTICE
     * INVISIBLE IN LIGHT MODE.
     *
     * It was `bg-[#0a1228]/95 text-amber-100/95`: a dark navy panel with pale
     * amber text, which reads correctly only on a dark background. app/globals.css
     * carries a light-mode rescue layer for exactly these hardcoded classes, and
     * `bg-[#0a1228]` is in its selector list — but the block that selector lands
     * in sets `background-color` and `background-image` only, with NO `color`
     * (unlike the `bg-slate-*` block above it, which does). So in light mode the
     * background was rescued to white and the amber text was left where it was.
     *
     * Measured on /settings with data-mode="light": text rgb(254,243,200) on a
     * white panel — a contrast ratio of 1.10:1, against the 4.5:1 WCAG AA needs.
     * The notice was rendering and was, in practice, unreadable. It is a
     * timezone correctness warning, so a reader silently missing it is the whole
     * failure.
     *
     * Reading the tokens directly also takes this element OUT of the rescue
     * layer's reach — it no longer carries a class that layer matches, so there
     * is nothing left to half-rescue. Same fix, same reason, as the
     * ClientOnlyAuthPage fallback.
     */
    <div
      role="status"
      className="pointer-events-none fixed bottom-16 left-1/2 z-[60] max-w-md -translate-x-1/2 rounded-lg border px-3 py-2 text-center text-[11px] leading-snug shadow-lg backdrop-blur-sm md:bottom-6"
      style={{
        background: 'var(--panel)',
        color: 'var(--text)',
        borderColor: 'var(--warn)',
      }}
    >
      {notice}
    </div>
  )
}
