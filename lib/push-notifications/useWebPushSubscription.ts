'use client'

/**
 * Web-push subscription hook — browser side.
 *
 * WHY THIS EXISTS. Every server-side piece of web push was already built (VAPID config,
 * `sendPushToUser`, the `WebPushSubscription` model, `/api/push/subscribe`, and push handlers
 * inside `public/sw.js`) — but nothing on the client ever called `PushManager.subscribe`, so
 * the subscription table was empty and no push could physically be delivered to anyone.
 *
 * Deliberately WEB-first: this uses the standard Service Worker + Push API, so it works in
 * any modern browser (Chrome, Edge, Firefox, and Safari 16.4+ once the site is installed to
 * the home screen on iOS). No native app required.
 *
 * The service worker itself is registered by SafeGlobalChrome at `/sw.js`; this hook waits
 * for that registration rather than registering a second worker, because only one service
 * worker can control a given scope and registering `/sw-push.js` alongside it would fight for
 * the same scope.
 */

import { useCallback, useEffect, useState } from 'react'

export type PushPermissionState = 'unsupported' | 'default' | 'granted' | 'denied'

export interface WebPushState {
  /** False when the browser lacks Service Worker or Push API (older Safari, some in-app webviews). */
  supported: boolean
  permission: PushPermissionState
  /** True once this browser has an active subscription registered with our server. */
  subscribed: boolean
  busy: boolean
  error: string | null
}

/**
 * VAPID public keys are base64url; `applicationServerKey` needs a Uint8Array. Browsers do not
 * accept the string form, and a malformed key fails at subscribe() with an opaque error.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

/**
 * navigator.serviceWorker.ready NEVER settles until a worker actually activates.
 * If registration is slow, blocked, or fails outright — a sandboxed webview, a
 * corporate proxy, exhausted storage, dev without NEXT_PUBLIC_ENABLE_PWA_SW —
 * awaiting it hangs forever. Anything gated behind that await silently never
 * runs, which is how a browser that fully supports push ends up being told it
 * does not. Bound the wait and treat a timeout as "not ready yet", never as
 * "unsupported".
 */
async function serviceWorkerReadyWithin(ms: number): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

function readPermission(): PushPermissionState {
  if (typeof window === 'undefined') return 'unsupported'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported'
  }
  return Notification.permission as PushPermissionState
}

export function useWebPushSubscription(vapidPublicKey: string | null | undefined): WebPushState & {
  subscribe: () => Promise<boolean>
  unsubscribe: () => Promise<boolean>
} {
  const [state, setState] = useState<WebPushState>({
    supported: false,
    permission: 'unsupported',
    subscribed: false,
    busy: false,
    error: null,
  })

  // Reflect existing state on mount: a returning user may already be subscribed, and
  // re-prompting someone who already said yes is the fastest way to get told no.
  useEffect(() => {
    let cancelled = false
    const permission = readPermission()
    const supported = permission !== 'unsupported'
    if (!supported) {
      setState((s) => ({ ...s, supported: false, permission: 'unsupported' }))
      return
    }
    // Support is a property of the BROWSER and is already known here. Publish it
    // immediately so the opt-in renders; whether a worker has come up yet only
    // affects whether we can read an existing subscription.
    setState((s) => ({ ...s, supported: true, permission }))

    void (async () => {
      try {
        const reg = await serviceWorkerReadyWithin(5000)
        if (cancelled || !reg) return
        const existing = await reg.pushManager.getSubscription()
        if (cancelled) return
        setState((s) => ({ ...s, subscribed: Boolean(existing) }))
      } catch {
        // Leave `subscribed` false; the user can still attempt to enable.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!vapidPublicKey) {
      setState((s) => ({ ...s, error: 'Push is not configured on the server.' }))
      return false
    }
    if (readPermission() === 'unsupported') {
      setState((s) => ({ ...s, error: 'This browser does not support web push.' }))
      return false
    }

    setState((s) => ({ ...s, busy: true, error: null }))
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        // Denied is sticky in most browsers — the user must clear it in site settings.
        // Say so rather than letting a silent no-op look like a bug.
        setState((s) => ({
          ...s,
          busy: false,
          permission: permission as PushPermissionState,
          error:
            permission === 'denied'
              ? 'Notifications are blocked for this site. Enable them in your browser settings to turn alerts back on.'
              : null,
        }))
        return false
      }

      const reg = await serviceWorkerReadyWithin(10000)
      if (!reg) {
        setState((s) => ({
          ...s,
          busy: false,
          error:
            'The background service worker did not start, so alerts cannot be enabled on this device. Reload the page and try again.',
        }))
        return false
      }
      const existing = await reg.pushManager.getSubscription()
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          // Required by Chrome: a push that shows no notification is not permitted.
          userVisibleOnly: true,
          // Cast: lib.dom types `applicationServerKey` as BufferSource, and TS 5.7+ made
          // Uint8Array generic over its backing buffer, so the two no longer unify even
          // though an ArrayBuffer-backed Uint8Array is exactly what the API wants.
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
        }))

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error('Browser returned an incomplete push subscription.')
      }

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          userAgent: navigator.userAgent,
        }),
      })
      if (!res.ok) {
        // Roll back the browser-side subscription: keeping it while the server has no record
        // produces a device that believes it is subscribed and never receives anything.
        await sub.unsubscribe().catch(() => {})
        throw new Error(res.status === 401 ? 'Sign in to enable alerts.' : 'Could not save the subscription.')
      }

      setState((s) => ({ ...s, busy: false, subscribed: true, permission: 'granted', error: null }))
      return true
    } catch (err) {
      setState((s) => ({
        ...s,
        busy: false,
        error: err instanceof Error ? err.message : 'Could not enable notifications.',
      }))
      return false
    }
  }, [vapidPublicKey])

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setState((s) => ({ ...s, busy: true, error: null }))
    try {
      const reg = await serviceWorkerReadyWithin(10000)
      if (!reg) {
        // Without a worker we can neither read the endpoint nor drop the browser
        // subscription. Report it and leave `subscribed` alone — flipping the UI
        // to off while the device may still hold a subscription is the lie this
        // component exists to avoid.
        setState((s) => ({
          ...s,
          busy: false,
          error: 'The background service worker did not start, so alerts could not be turned off here. Reload and try again.',
        }))
        return false
      }
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
      setState((s) => ({ ...s, busy: false, subscribed: false }))
      return true
    } catch (err) {
      setState((s) => ({
        ...s,
        busy: false,
        error: err instanceof Error ? err.message : 'Could not turn notifications off.',
      }))
      return false
    }
  }, [])

  return { ...state, subscribe, unsubscribe }
}
