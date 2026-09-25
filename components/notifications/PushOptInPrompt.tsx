'use client'

/**
 * A one-tap "get this on your phone" ask, placed where the value was just shown (owner's call
 * 2026-09-25: "turn on phone alerts" — measured that day: 0 of 110 users had a push subscription).
 *
 * WHY ANOTHER SURFACE WHEN THE CARD EXISTS. The only thing that could subscribe a device was
 * `EnableWebPushCard`, on the notifications screen, in settings, and on the import-done page; the
 * game-day banner only links there. Nobody arrives at a settings screen wanting alerts — they want
 * them right after something useful happened. So this sits under Chimmy's answer, and one tap does
 * it.
 *
 * 🛑 IT IS A SECOND DOOR, NOT A SECOND FLOW. Permission, the service worker, the server round trip
 * and the rollback all stay in `useWebPushSubscription` — the one place allowed to call
 * `requestPermission` (pinned by __tests__/push-optin-reachable.test.ts). The key is fetched on
 * mount, before the tap, so the hook's permission request still runs inside the user's gesture —
 * iOS refuses one that follows an await.
 *
 * WHO NEVER SEES IT: anyone who has already answered (granted or denied — a denial is sticky and the
 * card explains how to undo it), a browser without push, a server without push keys, and anyone who
 * said "Not now" in the last two weeks. On an iPhone in a Safari tab, where push only exists for Home
 * Screen apps, it says that instead of offering a button that cannot work.
 */

import { useEffect, useState } from 'react'

import { useWebPushSubscription } from '@/lib/push-notifications/useWebPushSubscription'

export const PUSH_ASK_DISMISSED_KEY = 'af-push-ask-dismissed-at'
/** "Not now" means not now — it comes back after this long, like the game-day banner's week. */
export const PUSH_ASK_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

export function pushAskSnoozed(raw: string | null, now: number): boolean {
  const at = raw == null ? NaN : Number(raw)
  return Number.isFinite(at) && now - at < PUSH_ASK_SNOOZE_MS && at <= now
}

/** iPhone/iPad in a browser tab. iPadOS 13+ reports itself as a Mac, so touch points decide. */
export function needsHomeScreenForPush(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
  if (!ios) return false
  const standalone = (window.navigator as unknown as { standalone?: boolean }).standalone
  return standalone !== true && !window.matchMedia?.('(display-mode: standalone)')?.matches
}

const COPY = {
  chimmy: {
    ask: "Want this on your phone? I'll ping you before kickoff when a starter is out or your lineup needs a fix.",
    done: "You're set. This device gets my heads-ups before kickoff.",
  },
} as const

export function PushOptInPrompt({ variant = 'chimmy', className }: { variant?: keyof typeof COPY; className?: string }) {
  const [vapidKey, setVapidKey] = useState<string | null>(null)
  const [configured, setConfigured] = useState(false)
  const [homeScreen, setHomeScreen] = useState(false)
  const [snoozed, setSnoozed] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const { supported, permission, busy, error, subscribe } = useWebPushSubscription(vapidKey)

  useEffect(() => {
    let cancelled = false
    try {
      setSnoozed(pushAskSnoozed(window.localStorage.getItem(PUSH_ASK_DISMISSED_KEY), Date.now()))
    } catch {
      setSnoozed(false) // blocked storage: ask; worst case it asks again next time
    }
    setHomeScreen(needsHomeScreenForPush())
    void (async () => {
      try {
        const res = await fetch('/api/push/subscribe')
        const data = (await res.json()) as { configured?: boolean; vapidPublicKey?: string | null }
        if (cancelled) return
        setConfigured(Boolean(data.configured && data.vapidPublicKey))
        setVapidKey(data.vapidPublicKey ?? null)
      } catch {
        /* no key, no ask */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const dismiss = () => {
    setSnoozed(true)
    try {
      window.localStorage.setItem(PUSH_ASK_DISMISSED_KEY, String(Date.now()))
    } catch {
      /* it will ask again next load */
    }
  }

  const copy = COPY[variant]

  if (enabled) {
    return (
      <div className={['af-pushask', className].filter(Boolean).join(' ')} role="status" data-state="on">
        <p className="af-pushask-text">{copy.done}</p>
      </div>
    )
  }
  if (snoozed || !configured) return null

  if (!supported) {
    if (!homeScreen) return null
    return (
      <div className={['af-pushask', className].filter(Boolean).join(' ')} role="group" aria-label="Phone alerts">
        <p className="af-pushask-text">
          On iPhone, alerts need AllFantasy on your Home Screen: tap Share, then <strong>Add to Home Screen</strong>, and open
          it from there.
        </p>
        <div className="af-pushask-actions">
          <button type="button" className="af-pushask-later" onClick={dismiss}>
            Got it
          </button>
        </div>
      </div>
    )
  }
  // Already answered — unless it was answered just now with a refusal, which needs its explanation.
  if (permission !== 'default') {
    if (!error) return null
    return (
      <div className={['af-pushask', className].filter(Boolean).join(' ')} role="status">
        <p className="af-pushask-error">{error}</p>
      </div>
    )
  }

  return (
    <div className={['af-pushask', className].filter(Boolean).join(' ')} role="group" aria-label="Phone alerts">
      <p className="af-pushask-text">{copy.ask}</p>
      <div className="af-pushask-actions">
        <button
          type="button"
          className="af-pushask-go"
          disabled={busy}
          onClick={() =>
            void subscribe().then((ok) => {
              if (ok) setEnabled(true)
            })
          }
        >
          {busy ? 'Turning on…' : 'Turn on alerts'}
        </button>
        <button type="button" className="af-pushask-later" onClick={dismiss} disabled={busy}>
          Not now
        </button>
      </div>
      {error ? (
        <p className="af-pushask-error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default PushOptInPrompt
