'use client'

/**
 * The "turn on phone alerts" sheet shown after someone signs up or signs back in (owner's call,
 * 2026-10-25: everyone who creates an account or signs in is asked; "Not now" asks again later;
 * they can switch alerts off any time in Settings › Notifications). When it shows is decided in
 * `lib/push-notifications/signInPushAsk.ts`.
 *
 * 🛑 A THIRD DOOR, NOT A SECOND FLOW. Permission, the service worker, the server round trip and
 * the rollback stay in `useWebPushSubscription` (web) and `useIosAppPush` (the iOS app) — the only
 * places allowed to ask the browser or the phone (pinned by __tests__/push-optin-reachable.test.ts).
 * The push key is fetched before the tap, so the permission request still runs inside the user's
 * gesture; iOS refuses one that follows an await.
 *
 * WHO NEVER SEES IT: signed-out visitors; anyone who already answered (granted or denied); a
 * browser that cannot push and is not an iPhone tab that could after "Add to Home Screen"; a
 * server without push keys; and the sign-in, sign-up and onboarding screens themselves.
 */

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

import { loadPushConfig, needsHomeScreenForPush } from '@/components/notifications/PushOptInPrompt'
import {
  MAX_ASKS,
  SIGN_IN_PUSH_ASK_KEY,
  SIGN_IN_PUSH_ASK_SESSION_KEY,
  readSignInPushAskState,
  recordSignInPushAsk,
  shouldShowSignInPushAsk,
} from '@/lib/push-notifications/signInPushAsk'
import { useIosAppPush } from '@/lib/push-notifications/useIosAppPush'
import { useWebPushSubscription } from '@/lib/push-notifications/useWebPushSubscription'
import { usePublishSignInPushVisibility } from '@/lib/push-notifications/signInPushVisibility'

type Mode = 'web' | 'app' | 'homeScreen'

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function SignInPushSheet() {
  const session = useSession()
  const signedIn = session?.status === 'authenticated'
  const pathname = usePathname()
  const [eligible, setEligible] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [vapidKey, setVapidKey] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)
  const [tapped, setTapped] = useState(false)
  const dialog = useRef<HTMLDivElement | null>(null)
  usePublishSignInPushVisibility(open)
  const web = useWebPushSubscription(vapidKey)
  const app = useIosAppPush({ registerOnMount: false })

  // Is it this visit's turn to ask? Read once per sign-in state and screen.
  useEffect(() => {
    if (!signedIn) {
      setEligible(false)
      return
    }
    const asked = storage('session')?.getItem(SIGN_IN_PUSH_ASK_SESSION_KEY) === '1'
    const state = readSignInPushAskState(storage('local')?.getItem(SIGN_IN_PUSH_ASK_KEY) ?? null)
    setEligible(shouldShowSignInPushAsk({ state, askedThisSession: asked, pathname, now: Date.now() }))
  }, [signedIn, pathname])

  const homeScreen = eligible && !app.available && !web.supported && needsHomeScreenForPush()
  const mode: Mode | null = app.available
    ? app.permission === 'prompt'
      ? 'app'
      : null
    : web.supported && web.permission === 'default'
      ? 'web'
      : homeScreen
        ? 'homeScreen'
        : null

  // Fetch the push key only for a browser that could use it.
  useEffect(() => {
    if (!eligible || (mode !== 'web' && mode !== 'homeScreen')) return
    let cancelled = false
    void loadPushConfig().then((cfg) => {
      if (cancelled || !cfg) return
      setConfigured(cfg.configured)
      setVapidKey(cfg.vapidPublicKey)
    })
    return () => {
      cancelled = true
    }
  }, [eligible, mode])

  const ready = eligible && mode !== null && (mode === 'app' || configured)

  // Count the ask the moment it is shown, so a reload in the same visit does not show it again.
  useEffect(() => {
    if (!ready || open) return
    storage('session')?.setItem(SIGN_IN_PUSH_ASK_SESSION_KEY, '1')
    const local = storage('local')
    const state = readSignInPushAskState(local?.getItem(SIGN_IN_PUSH_ASK_KEY) ?? null)
    local?.setItem(SIGN_IN_PUSH_ASK_KEY, JSON.stringify(recordSignInPushAsk(state, Date.now())))
    setOpen(true)
  }, [ready, open])

  // The iOS app answers asynchronously; close on the answer.
  useEffect(() => {
    if (!tapped || mode !== 'app') return
    if (app.permission === 'granted' && app.registered) setDone(true)
  }, [tapped, mode, app.permission, app.registered])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    dialog.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [open])

  if (!open) return null

  const close = () => {
    setOpen(false)
    setEligible(false)
  }
  const stopAsking = () => {
    storage('local')?.setItem(SIGN_IN_PUSH_ASK_KEY, JSON.stringify({ asks: MAX_ASKS, lastAskAt: Date.now() }))
  }
  const turnOn = () => {
    setTapped(true)
    if (mode === 'app') {
      void app.enable()
      return
    }
    void web.subscribe().then((ok) => {
      if (ok) {
        stopAsking()
        setDone(true)
      }
    })
  }
  const busy = mode === 'app' ? app.busy : web.busy
  const error = tapped ? (mode === 'app' ? app.error : web.error) : null
  const appDenied = tapped && mode === 'app' && app.permission === 'denied'

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="af-signin-push-title"
      data-testid="signin-push-sheet"
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); return }
        if (event.key !== 'Tab') return
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }}
      {...(mode === 'app' ? {} : { 'data-hide-in-ios-app': true })}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
        padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px max(16px, env(safe-area-inset-bottom, 0px))',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          borderRadius: 16,
          background: '#14161c',
          color: '#f4f4f5',
          border: '1px solid rgba(255,255,255,0.12)',
          padding: 20,
          maxHeight: 'calc(100dvh - 32px)',
          overflowY: 'auto',
        }}
      >
        <h2 id="af-signin-push-title" style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800 }}>
          {done ? "You're set" : 'Turn on phone alerts'}
        </h2>
        {done ? (
          <p style={{ margin: 0, color: '#d4d4d8' }}>
            This device will get your alerts. You can turn them off any time in Settings › Notifications.
          </p>
        ) : mode === 'homeScreen' ? (
          <p style={{ margin: 0, color: '#d4d4d8' }}>
            On iPhone, alerts need AllFantasy on your Home Screen: tap Share, then <strong>Add to Home Screen</strong>, and
            open it from there.
          </p>
        ) : (
          <>
            <p style={{ margin: 0, color: '#d4d4d8' }}>
              Get a ping when a starter is ruled out, a trade comes in, someone messages you, or you are on the clock in a
              draft.
            </p>
            <p style={{ margin: '8px 0 0', color: '#a1a1aa', fontSize: 13 }}>
              You can turn them off any time in Settings › Notifications.
            </p>
          </>
        )}
        {error || appDenied ? (
          <p role="status" style={{ margin: '8px 0 0', color: '#fbbf24', fontSize: 13 }}>
            {error ??
              'Notifications are off for AllFantasy. Turn them on in the iPhone Settings app → Notifications → AllFantasy.'}
          </p>
        ) : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          {done || mode === 'homeScreen' || error || appDenied ? (
            <button type="button" onClick={close} style={primaryButton}>
              {done ? 'Done' : 'Got it'}
            </button>
          ) : (
            <>
              <button type="button" onClick={turnOn} disabled={busy} style={primaryButton}>
                {busy ? 'Turning on…' : 'Turn on alerts'}
              </button>
              <button type="button" onClick={close} disabled={busy} style={secondaryButton}>
                Not now
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const primaryButton = {
  flex: '1 1 auto',
  minHeight: 44,
  borderRadius: 10,
  border: 0,
  background: '#22d3ee',
  color: '#06121a',
  fontWeight: 800,
  fontSize: 15,
  cursor: 'pointer',
} as const

const secondaryButton = {
  flex: '1 1 auto',
  minHeight: 44,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'transparent',
  color: '#d4d4d8',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
} as const

export default SignInPushSheet
