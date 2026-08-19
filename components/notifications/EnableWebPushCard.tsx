'use client'

/**
 * Opt-in control for browser push alerts.
 *
 * WEB-FIRST BY DESIGN. This is the standard Service Worker + Push API, so it works in any
 * modern browser without a native app. The one platform caveat worth surfacing to the user
 * rather than hiding: iOS Safari only permits web push once the site has been added to the
 * home screen, so an iPhone user who taps "Enable" in a normal Safari tab gets an opaque
 * failure unless told why.
 *
 * The component is deliberately honest about state. It never shows "on" unless the server
 * has a stored subscription AND the browser still holds one — a device that believes it is
 * subscribed while the server has no record would silently receive nothing, which is the
 * exact failure this whole alerting effort exists to end.
 */

import { useEffect, useState } from 'react'

import { useWebPushSubscription } from '@/lib/push-notifications/useWebPushSubscription'

function isIosSafariWithoutStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua)
  if (!isIos) return false
  const standalone = (window.navigator as unknown as { standalone?: boolean }).standalone
  return standalone !== true && !window.matchMedia('(display-mode: standalone)').matches
}

export function EnableWebPushCard({ className }: { className?: string }) {
  const [vapidKey, setVapidKey] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [needsHomeScreen, setNeedsHomeScreen] = useState(false)

  const { supported, permission, subscribed, busy, error, subscribe, unsubscribe } =
    useWebPushSubscription(vapidKey)

  useEffect(() => {
    setNeedsHomeScreen(isIosSafariWithoutStandalone())
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
  }, [])

  // Server-side push isn't configured. Saying so plainly beats a button that cannot work.
  if (configured === false) {
    return (
      <div className={className}>
        <p className="text-sm text-[var(--af-muted,#9aa4b2)]">
          Push alerts aren&apos;t available yet — the server isn&apos;t configured to send them.
        </p>
      </div>
    )
  }

  if (!supported) {
    return (
      <div className={className}>
        <p className="text-sm text-[var(--af-muted,#9aa4b2)]">
          This browser doesn&apos;t support web push notifications.
        </p>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Game-day alerts</p>
          <p className="mt-1 text-sm text-[var(--af-muted,#9aa4b2)]">
            Get notified when a starter is ruled out before kickoff, with a replacement suggestion.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || (needsHomeScreen && !subscribed)}
          onClick={() => void (subscribed ? unsubscribe() : subscribe())}
          className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Working…' : subscribed ? 'Turn off' : 'Enable'}
        </button>
      </div>

      {needsHomeScreen && !subscribed && (
        <p className="mt-2 text-xs text-[var(--af-muted,#9aa4b2)]">
          On iPhone, add AllFantasy to your Home Screen first — Safari only allows notifications
          for installed sites.
        </p>
      )}

      {permission === 'denied' && (
        <p className="mt-2 text-xs text-amber-400">
          Notifications are blocked for this site. Re-enable them in your browser settings.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {subscribed && !error && (
        <p className="mt-2 text-xs text-emerald-400">Alerts are on for this device.</p>
      )}
    </div>
  )
}

export default EnableWebPushCard
