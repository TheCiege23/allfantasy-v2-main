'use client'

/**
 * Game-day alerts inside the iOS app. Rendered BESIDE `EnableWebPushCard` wherever that card
 * is, because the web card is hidden in the app (`data-hide-in-ios-app`): the WKWebView has
 * no Push API, so its only honest message there was "add the website to your Home Screen".
 *
 * Renders nothing outside the app, in an app build without the push plugin, or when the
 * server cannot send to Apple — see `useIosAppPush`.
 */

import { useIosAppPush } from '@/lib/push-notifications/useIosAppPush'

export function IosAppPushCard({ className }: { className?: string }) {
  const { available, permission, registered, busy, error, enable } = useIosAppPush()
  if (!available || permission === null) return null

  const on = permission === 'granted' && registered

  return (
    <div className={className} data-testid="ios-app-push-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Game-day alerts</p>
          <p className="mt-1 text-sm text-[var(--af-muted,#9aa4b2)]">
            Get notified when a starter is ruled out before kickoff, with a replacement suggestion.
          </p>
        </div>
        {permission !== 'denied' && !on ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void enable()}
            className="min-h-[44px] shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Working…' : permission === 'granted' ? 'Try again' : 'Turn on'}
          </button>
        ) : null}
      </div>

      {permission === 'denied' ? (
        <p className="mt-2 text-xs text-amber-400">
          Notifications are off for AllFantasy. To turn them on, open the iPhone Settings app →
          Notifications → AllFantasy, and switch on Allow Notifications.
        </p>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}

      {on && !error ? (
        <p className="mt-2 text-xs text-emerald-400">
          Alerts are on for this iPhone. You can turn them off any time in Settings → Notifications
          → AllFantasy.
        </p>
      ) : null}
    </div>
  )
}

export default IosAppPushCard
