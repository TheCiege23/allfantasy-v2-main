"use client"

import { useCallback, useEffect, useState } from "react"

import {
  iosAppPushBridge,
  iosPushConfigured,
  registerIosDevice,
  type IosPushBridge,
  type IosPushPermission,
} from "@/lib/push-notifications/iosAppPushBridge"

/**
 * The one permission flow for push inside the iOS app — the counterpart of
 * `useWebPushSubscription`, which the WKWebView cannot use (no Push API there).
 *
 * `available` is false outside the app, in an app build without the push plugin, and when
 * the server has no APNs key. Every surface renders nothing in that case: a button that
 * cannot deliver a notification is worse than no button.
 */
export type IosAppPushState = {
  available: boolean
  permission: IosPushPermission | null
  /** True once this phone's token is stored for the signed-in user, this session. */
  registered: boolean
  busy: boolean
  error: string | null
  enable: () => Promise<void>
}

export function useIosAppPush(): IosAppPushState {
  const [bridge, setBridge] = useState<IosPushBridge | null>(null)
  const [permission, setPermission] = useState<IosPushPermission | null>(null)
  const [registered, setRegistered] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const b = iosAppPushBridge()
    if (!b) return
    let cancelled = false
    void (async () => {
      if (!(await iosPushConfigured()) || cancelled) return
      let current: IosPushPermission
      try {
        current = await b.checkPermissions()
      } catch {
        return
      }
      if (cancelled) return
      setBridge(b)
      setPermission(current)
      // Already allowed: make sure THIS login has the token (a new sign-in on the same
      // phone, or a token iOS rotated). The server upserts, so repeating is harmless.
      if (current === "granted") {
        const ok = await registerIosDevice(b)
        if (!cancelled) setRegistered(ok)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const enable = useCallback(async () => {
    if (!bridge) return
    setBusy(true)
    setError(null)
    try {
      // iOS shows its own prompt exactly once; after a denial this returns "denied" silently.
      const next = await bridge.requestPermissions()
      setPermission(next)
      if (next !== "granted") return
      const ok = await registerIosDevice(bridge)
      setRegistered(ok)
      if (!ok) setError("Couldn't finish turning on alerts. Check your connection and try again.")
    } catch {
      setError("Couldn't turn on alerts. Try again.")
    } finally {
      setBusy(false)
    }
  }, [bridge])

  return { available: bridge !== null, permission, registered, busy, error, enable }
}
