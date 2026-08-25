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

  /*
   * ⚠ RENDERS NOTHING, ON PURPOSE. THE SYNC ABOVE STILL RUNS.
   *
   * This used to float a pill over the bottom of every authenticated page —
   * "Device clock may differ from official server time". It sat above the
   * content on every screen, competed with the chat launcher for the same
   * corner, and asked the reader to do nothing: every deadline on the site is
   * already computed from server time, which is exactly what the notice said.
   *
   * The POST that records device time is the part that earns its keep, and it
   * is untouched — the skew is still measured and still available to anything
   * that needs it. What is gone is telling the user about a discrepancy they
   * cannot act on and that we have already handled for them.
   *
   * `notice` is deliberately still computed rather than deleted: it is the
   * signal a future surface would use to say something USEFUL, like "this
   * deadline is shown in league time, not yours".
   */
  void notice
  return null
}
