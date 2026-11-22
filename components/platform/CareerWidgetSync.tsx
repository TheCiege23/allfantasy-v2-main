'use client'

import { useEffect } from 'react'
import { isInIosAppClient } from '@/lib/platform/iosApp'
import { refreshCareerWidget } from '@/lib/platform/careerWidgetBridge'

/** At most one server read per this long, however often the app is switched to and from. */
export const WIDGET_REFRESH_GAP_MS = 10 * 60 * 1000

/**
 * Keeps the iOS "Your career" widget current: refreshes it when the app opens and each time it comes
 * back to the foreground, from any screen. Before this the widget only moved when someone opened the
 * Career tab, so it sat on day-old figures for anyone who used the app without going there.
 *
 * Renders nothing, and does nothing outside the iOS app. The widget itself never fetches; a widget
 * refresh while the app is closed needs native code and a new build.
 */
export function CareerWidgetSync() {
  useEffect(() => {
    if (!isInIosAppClient()) return
    let lastRun = 0
    let running = false

    const run = () => {
      if (document.visibilityState !== 'visible' || running) return
      const now = Date.now()
      if (lastRun && now - lastRun < WIDGET_REFRESH_GAP_MS) return
      lastRun = now
      running = true
      void refreshCareerWidget().finally(() => {
        running = false
      })
    }

    run()
    document.addEventListener('visibilitychange', run)
    return () => document.removeEventListener('visibilitychange', run)
  }, [])

  return null
}
