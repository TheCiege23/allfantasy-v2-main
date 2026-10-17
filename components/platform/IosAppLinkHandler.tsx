'use client'

import { useEffect } from 'react'
import { installIosAppLinkHandler } from '@/lib/platform/iosAppLinks'

/**
 * Sends the iOS app to the page a tapped link names (lib/platform/iosAppLinks.ts). Renders nothing
 * and does nothing outside the app. Mounted once in the root layout, on its own rather than inside
 * SafeGlobalChrome, which returns early on several paths before its hooks run.
 */
export function IosAppLinkHandler() {
  useEffect(() => installIosAppLinkHandler(), [])
  return null
}
