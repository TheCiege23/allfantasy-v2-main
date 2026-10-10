'use client'

import { useEffect, useRef, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { isIosSafariWithoutStandalone } from '@/components/notifications/EnableWebPushCard'
import { useWebPushSubscription } from '@/lib/push-notifications/useWebPushSubscription'
import { pushAskCopy, type PushAskPlacement } from '@/lib/core-app/pushAskCopy'

/**
 * Ask for push at a moment of intent (2026-10-10). Measured in production that morning: of the 42
 * managers with a team this season, TWO could receive a push (both through the iPhone app), while
 * the injury alert — the one people actually read, 50% — is built to buzz a phone. The only ask was a
 * game-day banner linking to Settings. This asks where the value is obvious: right after "Alert me",
 * and on the "My players" home.
 *
 * ⚠ THE PERMISSION FLOW IS `useWebPushSubscription`'s, NOT A SECOND ONE. It is the same hook
 * EnableWebPushCard uses (iOS precondition, server round trip, rollback); this only decides WHEN to
 * offer it and keeps the offer small.
 *
 * Never shown to someone who already decided (granted and subscribed, or denied — a denial cannot be
 * re-asked from script and nagging does not fix it), never inside the iPhone app (it has native push;
 * `data-hide-in-ios-app`), and "Not now" quiets this placement for the week. iPhone Safari cannot
 * take web push outside a Home Screen app, so there it says how, instead of offering a button that
 * cannot work.
 *
 * Measured: `push_ask_shown` / `push_ask_enabled` / `push_ask_dismissed` with the placement, through
 * /api/analytics/track (the server attaches the user).
 */

function weekKey(placement: PushAskPlacement, now: Date): string {
  const start = new Date(now.getFullYear(), 0, 1)
  const week = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000))
  return `af-push-ask-${placement}-${now.getFullYear()}-${week}`
}

/** NFL game days in local time — where the shell's GameDayAlertsBanner already asks. */
const GAME_DAYS = new Set([0, 1, 4])

function track(event: string, placement: PushAskPlacement): void {
  if (typeof window === 'undefined') return
  void fetch('/api/analytics/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, toolKey: 'push_ask', path: window.location?.pathname ?? null, meta: { placement } }),
  }).catch(() => {})
}

export function PushAsk({
  placement,
  notOnGameDays = false,
}: {
  placement: PushAskPlacement
  /** Stay out of the way on Thu/Sun/Mon, when GameDayAlertsBanner is already asking on every /core screen. */
  notOnGameDays?: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = pushAskCopy(language)
  const [vapidKey, setVapidKey] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [iphoneHomeScreen, setIphoneHomeScreen] = useState(false)
  const [quiet, setQuiet] = useState(true)
  const [justEnabled, setJustEnabled] = useState(false)
  const shownRef = useRef(false)
  const { supported, permission, subscribed, busy, error, subscribe } = useWebPushSubscription(vapidKey)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // The iPhone app is a WKWebView with native push; this ask is for the browser.
    if (document.documentElement.hasAttribute('data-ios-app')) return
    let dismissed = false
    try {
      dismissed = window.localStorage.getItem(weekKey(placement, new Date())) === '1'
    } catch {
      // Storage blocked: ask anyway; "Not now" then only lasts for this view.
    }
    setIphoneHomeScreen(isIosSafariWithoutStandalone())
    setQuiet(dismissed || (notOnGameDays && GAME_DAYS.has(new Date().getDay())))
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/push/subscribe')
        const data = (await res.json()) as { configured?: boolean; vapidPublicKey?: string | null }
        if (cancelled) return
        setConfigured(Boolean(data.configured))
        setVapidKey(data.vapidPublicKey ?? null)
      } catch {
        if (!cancelled) setConfigured(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [placement, notOnGameDays])

  /*
   * ⚠ ONLY WHILE THE BROWSER IS UNDECIDED. The hook learns about an existing subscription a beat
   * after mount, so "granted but not yet known to be subscribed" would flash this ask — and log a
   * false shown + enabled — for someone who said yes long ago. `default` is the one state where
   * asking is right; iPhone Safari outside a Home Screen app reports no Push API at all, and gets
   * the how-to instead of a button.
   */
  const offer = !quiet && configured === true && ((supported && permission === 'default') || (!supported && iphoneHomeScreen))

  useEffect(() => {
    if (offer && !shownRef.current) {
      shownRef.current = true
      track('push_ask_shown', placement)
    }
  }, [offer, placement])

  useEffect(() => {
    if (subscribed && shownRef.current && !justEnabled) {
      setJustEnabled(true)
      track('push_ask_enabled', placement)
    }
  }, [subscribed, placement, justEnabled])

  if (justEnabled) {
    return (
      <p className="af-pf-pushask-done" role="status" data-hide-in-ios-app>
        ✓ {t.on}
      </p>
    )
  }
  if (!offer) return null

  const notNow = () => {
    try {
      window.localStorage.setItem(weekKey(placement, new Date()), '1')
    } catch {
      // Storage blocked: hidden for this view only.
    }
    setQuiet(true)
    track('push_ask_dismissed', placement)
  }

  return (
    <div className="af-pf-pushask" data-placement={placement} data-hide-in-ios-app>
      <span className="af-pf-pushask-icon" aria-hidden>
        🔔
      </span>
      <div className="af-pf-pushask-text">
        <p className="af-pf-pushask-title">{t.title[placement]}</p>
        <p className="af-pf-pushask-body">{iphoneHomeScreen && !supported ? t.iphone : t.body[placement]}</p>
        {error ? <p className="af-pf-pushask-error">{t.failed}</p> : null}
      </div>
      <div className="af-pf-pushask-actions">
        {supported ? (
          <button type="button" className="af-btn af-pf-pushask-go" disabled={busy} onClick={() => void subscribe()}>
            {busy ? t.working : t.turnOn}
          </button>
        ) : null}
        <button type="button" className="af-pf-pushask-later" onClick={notNow}>
          {t.notNow}
        </button>
      </div>
    </div>
  )
}

export default PushAsk
