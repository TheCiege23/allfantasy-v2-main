/**
 * Optional Sentry integration. When SENTRY_DSN (server) or NEXT_PUBLIC_SENTRY_DSN (client)
 * is set and @sentry/nextjs is installed, errors are sent to Sentry.
 *
 * To enable:
 * 1. npm install @sentry/nextjs
 * 2. Set NEXT_PUBLIC_SENTRY_DSN and/or SENTRY_DSN
 * 3. In app layout (client), call initSentryClient() after initFrontendErrorTracking
 * 4. In instrumentation.ts (or server entry), call initSentryServer()
 *
 * This module provides no-op stubs when Sentry is not installed.
 */

import { setErrorReporter } from './capture'

type SentryCapture = (error: unknown, ctx?: Record<string, unknown>) => void
type SentryModuleLike = {
  init: (options: Record<string, unknown>) => void
  captureException: (error: unknown, context?: { extra?: Record<string, unknown> }) => void
}

let clientInitDone = false
let serverInitDone = false
let sentryLoadPromise: Promise<SentryModuleLike | null> | null = null

function loadOptionalSentryModule(): Promise<SentryModuleLike | null> {
  if (sentryLoadPromise) return sentryLoadPromise

  sentryLoadPromise = (async () => {
    try {
      // Avoid static module analysis so optional Sentry does not trigger bundler warnings when unused.
      const dynamicImport = new Function(
        'specifier',
        'return import(specifier)'
      ) as (specifier: string) => Promise<unknown>
      const mod = await dynamicImport('@sentry/nextjs')
      const candidate = (mod as { default?: unknown }).default ?? mod
      const sentry = candidate as Partial<SentryModuleLike>
      if (typeof sentry.init !== 'function' || typeof sentry.captureException !== 'function') {
        return null
      }
      return sentry as SentryModuleLike
    } catch {
      return null
    }
  })()

  return sentryLoadPromise
}

/**
 * Initialize Sentry on the client. Call once from a client root (e.g. layout wrapper).
 * No-op if NEXT_PUBLIC_SENTRY_DSN is not set or Sentry is not installed.
 */
export function initSentryClient(): void {
  if (clientInitDone || typeof window === 'undefined') return
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn?.trim()) return
  clientInitDone = true
  void (async () => {
    const Sentry = await loadOptionalSentryModule()
    if (!Sentry) return
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      replaysOnErrorSampleRate: 0.1,
    })
    const capture: SentryCapture = (error, ctx) => {
      Sentry.captureException(error, { extra: ctx })
    }
    setErrorReporter(capture)
  })()
}

/**
 * Initialize Sentry on the server. Call from instrumentation.ts or server entry.
 * No-op if SENTRY_DSN is not set or Sentry is not installed.
 */
/**
 * 🛑 EVERY EXIT FROM THIS FUNCTION USED TO BE SILENT, AND THAT COST TWO WEEKS OF
 * BLINDNESS. On 2026-09-02 a production 500 on /admin had no Sentry issue, and
 * the newest server error in the project was 14 days old — for a live app. The
 * cause was not that Sentry broke; it is that Sentry was never initialised and
 * said nothing about it.
 *
 * There were THREE silent exits here plus an empty catch at the call site, and
 * the outer catch could only ever see one of them:
 *   1. no DSN            → bare `return`
 *   2. module not loaded → bare `return`
 *   3. Sentry.init threw → inside a detached `void (async () => …)()` with no
 *      .catch(), so it surfaced as an unhandled rejection AFTER this function
 *      had already returned. A try/catch around the CALL cannot observe that.
 *
 * ⚠ IT STILL MUST NOT THROW. An observability failure taking down the server is
 * strictly worse than no observability. So this fails open exactly as before —
 * it just says so, once, in a form you can grep for. Fail open, but say so.
 *
 * ⚠ THE DSN IS NEVER LOGGED, only whether one was found. It is a credential-
 * bearing URL, and the repo already has a standing rule about secrets escaping
 * through helpful error output.
 */
function reportSentryInitStatus(stage: string, detail?: unknown): void {
  const suffix = detail instanceof Error ? `: ${detail.message}` : detail ? `: ${String(detail)}` : ''
  // console.error, not warn: this is the difference between having server error
  // reporting and silently not having it, and warn is filtered by default in
  // most log views.
  console.error(`[Sentry] server error reporting NOT active — ${stage}${suffix}`)
}

export function initSentryServer(): void {
  if (serverInitDone || typeof window !== 'undefined') return
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn?.trim()) {
    reportSentryInitStatus(
      'neither SENTRY_DSN nor NEXT_PUBLIC_SENTRY_DSN is set in this environment. ' +
        'Unhandled server errors will not be reported anywhere.'
    )
    return
  }
  serverInitDone = true
  void (async () => {
    try {
      const Sentry = await loadOptionalSentryModule()
      if (!Sentry) {
        reportSentryInitStatus('the @sentry/nextjs module could not be loaded (optional dependency)')
        return
      }
      Sentry.init({
        dsn,
        environment: process.env.NODE_ENV,
        tracesSampleRate: 0.1,
      })
      const capture: SentryCapture = (error, ctx) => {
        Sentry.captureException(error, { extra: ctx })
      }
      setErrorReporter(capture)
      console.info(`[Sentry] server error reporting active (environment: ${process.env.NODE_ENV})`)
    } catch (err) {
      // Reached only if init itself throws. Without this catch the rejection is
      // unhandled and detached from the caller — see the header.
      reportSentryInitStatus('Sentry.init() threw', err)
    }
  })()
}
