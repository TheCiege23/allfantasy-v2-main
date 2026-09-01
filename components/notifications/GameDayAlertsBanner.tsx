'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * A dismissible nudge to turn on alerts, shown on game days only (spec item 18).
 *
 * 🛑 IT DOES NOT ASK FOR PERMISSION ITSELF — IT LINKS TO THE ONE PLACE THAT DOES.
 * `useWebPushSubscription` (via `EnableWebPushCard`) owns the entire permission flow:
 * the iOS home-screen precondition, the sticky-denied message, the server round trip and
 * the rollback when that fails. A banner with its own `requestPermission()` call would be
 * a second implementation of all of it, and the first one to drift would do so silently.
 * This is a signpost. The card is the door.
 *
 * ⚠ AND IT NEVER RENDERS FOR SOMEONE WHO HAS ALREADY DECIDED. `Notification.permission`
 * is read on mount; anything other than `default` — granted or denied — means the question
 * has been answered and re-asking is just noise. Denied in particular is sticky in every
 * major browser, so a nudge cannot fix it and the card says so properly.
 */

/** NFL game days, in local time: Thursday, Sunday, Monday. */
const GAME_DAYS = new Set([0, 1, 4])

/**
 * Dismissal is scoped to the WEEK, not forever.
 *
 * ⚠ A PERMANENT DISMISSAL IS THE WRONG DEFAULT HERE and a `localStorage` flag makes it the
 * easy one. Someone who waves this away in September has not opted out of ever being told
 * their starter is out; they have said "not right now". The key carries the year and week,
 * so it returns next week and stays quiet for the rest of this one.
 */
function weekKey(now: Date): string {
  const start = new Date(now.getFullYear(), 0, 1)
  const week = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000))
  return `af-gameday-alerts-dismissed-${now.getFullYear()}-${week}`
}

export function GameDayAlertsBanner() {
  const [show, setShow] = useState(false)
  const [storageKey, setStorageKey] = useState('')

  useEffect(() => {
    // Everything here is browser-only state, so it is computed after mount rather than
    // rendered on the server — a server guess would hydrate-mismatch on the first paint.
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (Notification.permission !== 'default') return

    const now = new Date()
    if (!GAME_DAYS.has(now.getDay())) return

    const key = weekKey(now)
    try {
      if (window.localStorage.getItem(key) === '1') return
    } catch {
      // Private mode or blocked storage: show it rather than crash. Worst case it reappears.
    }
    setStorageKey(key)
    setShow(true)
  }, [])

  if (!show) return null

  const dismiss = () => {
    setShow(false)
    try {
      if (storageKey) window.localStorage.setItem(storageKey, '1')
    } catch {
      // Nothing to do — it will simply reappear on the next load this week.
    }
  }

  return (
    <div className="af-gdb" role="status">
      <div className="af-gdb-body">
        <p className="af-gdb-title">Games today. Want your phone to tell you?</p>
        <p className="af-gdb-sub">
          Get a heads-up when a starter is ruled out before kickoff, with a replacement
          suggestion.
        </p>
      </div>
      <div className="af-gdb-actions">
        <Link href="/core/notifications" className="af-gdb-go" onClick={dismiss}>
          Turn on alerts
        </Link>
        <button type="button" className="af-gdb-dismiss" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  )
}

export default GameDayAlertsBanner
