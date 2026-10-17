'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { iosAppPushBridge, notificationTapHref } from '@/lib/push-notifications/iosAppPushBridge'
import { useIosAppPush } from '@/lib/push-notifications/useIosAppPush'

/**
 * Mounted once in the ROOT layout, renders nothing. Two jobs, both iOS-app-only:
 *
 * 🛑 It used to live in the /core shell, and a notification tapped while the app was on any
 * other page (a league, a player, Settings) was simply dropped: no listener, so the app reopened
 * where it was. Keep it at the root, and keep it to ONE mount — two listeners push the route
 * twice and re-store the token twice.
 *
 *  1. When notifications are already allowed, re-send this phone's token for the signed-in
 *     user (`useIosAppPush` does it on mount). Signing out deletes the token for that login,
 *     so the next sign-in on the same phone must store it again — without this, alerts
 *     would stop after the first sign-out and nothing would say so.
 *  2. Open the screen a tapped notification points at (`href` in the APNs payload). The
 *     plugin retains a tap that launched the app until a listener consumes it, so a cold
 *     start from a notification still lands on the right screen.
 *
 * It never ASKS for permission — that is `IosAppPushCard`'s job, shown where the user can
 * see why.
 */
export function IosAppPushRegistrar() {
  useIosAppPush()
  const router = useRouter()

  useEffect(() => {
    const bridge = iosAppPushBridge()
    if (!bridge) return
    const handle = bridge.on('pushNotificationActionPerformed', (event) => {
      const href = notificationTapHref(event)
      if (href) router.push(href)
    })
    return () => {
      try {
        void handle.remove()
      } catch {
        // Nothing to clean up if the bridge is gone.
      }
    }
  }, [router])

  return null
}

export default IosAppPushRegistrar
