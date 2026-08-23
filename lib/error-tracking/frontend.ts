/**
 * Frontend error tracking: global handlers for uncaught errors and unhandled rejections.
 * Call initFrontendErrorTracking() once from the client root (e.g. layout client wrapper).
 */

import { captureException } from './capture'
import { isAppRouterControlFlowSignal } from '@/lib/next/is-app-router-redirect-error'

let initialized = false

export function initFrontendErrorTracking(): void {
  if (typeof window === 'undefined' || initialized) return
  initialized = true

  window.addEventListener('error', (event) => {
    const err = event.error ?? new Error(event.message ?? 'Unknown error')
    /*
     * ⚠ NEXT'S REDIRECT IS NOT AN ERROR, AND REPORTING IT DROWNED THE ONES THAT ARE.
     *
     * `redirect()` unwinds by throwing, and when that reaches the browser it
     * arrives here as an uncaught `window.error`. Every one was being sent to
     * Sentry. Observed on /dashboard: a signed-out visit fires three of these
     * before the /login bounce completes — and /dashboard is the destination the
     * whole signed-out funnel points at, so the volume is a function of how many
     * people are NOT logged in.
     *
     * That is worse than noise. An error tracker whose top event is a routing
     * success trains everyone to ignore it, and buries the real crash it exists
     * to surface.
     *
     * The console still shows these; only the report is suppressed.
     */
    if (isAppRouterControlFlowSignal(err)) return
    captureException(err, {
      context: 'window.error',
      path: window.location?.pathname,
      tags: { source: 'window' },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
    // Same signal, other channel: an aborted navigation surfaces the redirect
    // throw as a rejection rather than an error event.
    if (isAppRouterControlFlowSignal(err)) return
    captureException(err, {
      context: 'unhandledrejection',
      path: window.location?.pathname,
      tags: { source: 'promise' },
    })
    // Do not preventDefault so the console still shows the rejection
  })
}
