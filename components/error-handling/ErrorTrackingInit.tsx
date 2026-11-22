'use client'

import { useEffect } from 'react'
import { initFrontendErrorTracking } from '@/lib/error-tracking'

/**
 * Initializes global error tracking (window.error, unhandledrejection). Sentry's browser SDK is set
 * up by sentry.client.config.ts, not here.
 * Mount once in the root layout inside a client boundary.
 */
export function ErrorTrackingInit() {
  useEffect(() => {
    initFrontendErrorTracking()
  }, [])
  return null
}
