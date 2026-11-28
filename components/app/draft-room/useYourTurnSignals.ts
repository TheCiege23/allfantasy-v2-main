'use client'

import { useEffect, useRef } from 'react'

/**
 * "It's your turn" outside the room's own pixels: the browser tab title, a chime, and — when the
 * tab is in the background and the manager already allowed it — a system notification.
 *
 * In-room signals already exist (YoureUpAlert, the top bar's "You're up in N", push/SMS from
 * DraftNotificationService). What was missing is the case Yahoo managers described — "I missed at
 * least three picks, not even knowing it was my turn": the room is in another tab, or the phone is
 * face-down, and nothing in the browser changes.
 *
 *   - Title: "⏰ YOU'RE ON THE CLOCK" while on the clock, "(Up in N)" for the three picks before.
 *     Restored to the page's own title the moment neither applies, and on leaving the room.
 *   - Chime: once per turn, when the clock reaches this manager. Muted by the same switch as the
 *     countdown beeps (`af:draft-timer-mute`), so one setting silences the room.
 *   - Notification: only if permission is ALREADY granted (asking needs a gesture, and an
 *     unprompted permission dialog in the middle of a draft is its own annoyance).
 */

export function yourTurnTitle(base: string, onClock: boolean, picksUntil: number | null): string {
  if (onClock) return `⏰ YOU'RE ON THE CLOCK · ${base}`
  if (picksUntil != null && picksUntil >= 1 && picksUntil <= 3) return `(Up in ${picksUntil}) ${base}`
  return base
}

const MUTE_KEY = 'af:draft-timer-mute'

function muted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function playChime() {
  try {
    type AudioCtor = new () => AudioContext
    const w = window as Window & { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }
    const Ctor = w.AudioContext ?? w.webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    // Two rising notes — distinct from the countdown's single beeps.
    ;[
      { f: 660, at: 0 },
      { f: 990, at: 0.16 },
    ].forEach(({ f, at }) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g)
      g.connect(ctx.destination)
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.28)
      o.start(ctx.currentTime + at)
      o.stop(ctx.currentTime + at + 0.3)
    })
    window.setTimeout(() => {
      try {
        void ctx.close()
      } catch {
        /* ignore */
      }
    }, 800)
  } catch {
    /* Autoplay blocked before any gesture — silent failure is correct. */
  }
}

function notify(pickLabel: string | null) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (!document.hidden) return
    new Notification("You're on the clock", { body: pickLabel ? `Pick ${pickLabel} is yours.` : 'Your pick is up.', tag: 'af-draft-on-clock' })
  } catch {
    /* ignore */
  }
}

export function useYourTurnSignals({
  active,
  onClock,
  picksUntil,
  pickLabel,
}: {
  /** The draft is running and this viewer holds a seat (not auto-drafting, not an auction). */
  active: boolean
  onClock: boolean
  picksUntil: number | null
  pickLabel: string | null
}) {
  const baseTitle = useRef<string | null>(null)
  const announcedFor = useRef<string | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (baseTitle.current == null) baseTitle.current = document.title
    const want = () => (active ? yourTurnTitle(baseTitle.current ?? '', onClock, picksUntil) : baseTitle.current ?? '')
    document.title = want()
    /*
     * ⚠ THE PAGE RESETS ITS OWN TITLE AFTER THIS RUNS. Measured in the room: the title was set once,
     * then replaced by the route's metadata title without going through `document.title` (Next
     * rewrites the <title> node as metadata streams in). So keep watching: an outside change is the
     * page's new base title, and ours is put back on top of it.
     */
    if (!active || typeof MutationObserver === 'undefined') return
    const obs = new MutationObserver(() => {
      const now = document.title
      if (now === want()) return
      if (!now.startsWith('⏰ ') && !/^\(Up in \d\) /.test(now)) baseTitle.current = now
      document.title = want()
    })
    obs.observe(document.head, { subtree: true, childList: true, characterData: true })
    return () => obs.disconnect()
  }, [active, onClock, picksUntil])

  useEffect(
    () => () => {
      if (baseTitle.current != null && typeof document !== 'undefined') document.title = baseTitle.current
    },
    [],
  )

  useEffect(() => {
    if (!active || !onClock) {
      if (!onClock) announcedFor.current = null
      return
    }
    const key = pickLabel ?? 'on-clock'
    if (announcedFor.current === key) return
    announcedFor.current = key
    if (!muted()) playChime()
    notify(pickLabel)
  }, [active, onClock, pickLabel])
}
