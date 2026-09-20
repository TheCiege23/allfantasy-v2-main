'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { isNavigationSignal } from '@/components/core-app/CoreScreenErrorBoundary'

/**
 * AF Core — the segment error boundary, for a failure BEFORE the shell streams.
 *
 * 🛑 THE CODEBASE ALREADY DELEGATED THIS CASE TO A FILE THAT DID NOT EXIST.
 * `CoreScreenErrorBoundary`'s own note says it "catches the streamed screen body only; the route's
 * own `error.tsx`, where one exists, still handles anything that fails before the shell renders."
 * There was no `error.tsx` at this segment — seven other segments have one, including the app-level
 * `app/error.tsx` — so a `/core` render that threw before the shell flushed climbed past every
 * core-aware surface and landed on the app card, which carries none of the core chrome.
 *
 * Three surfaces, three genuinely different failures, and this is the only one that was missing:
 *   `ScreenLoadError`          a league-scoped READ that failed before render (server component)
 *   `CoreScreenErrorBoundary`  a render that THREW after the shell streamed (client class)
 *   this file                  a render that threw BEFORE the shell existed
 *
 * ⚠ IT IS A CLIENT COMPONENT AND IMPORTS NOTHING SERVER-ONLY. `app/dashboard/error.tsx` carries the
 * same warning for a reason: pulling a server module in here bundles database-url resolution into a
 * shared client chunk and breaks every route that loads it. `isNavigationSignal` is a pure digest
 * check from a file already marked `'use client'`.
 */
export default function AfCoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    /*
     * ⚠ A `redirect()` OR `notFound()` MUST NOT BE REPORTED AS A CRASH. Next delivers both as
     * thrown errors carrying a digest, and while it normally handles them above this boundary,
     * reporting one here would file a Sentry issue every time a screen legitimately redirects —
     * which on `/core` is every signed-out visit. `CoreScreenErrorBoundary` filters them for the
     * same reason.
     */
    if (isNavigationSignal(error)) return
    try {
      Sentry.captureException(error, {
        tags: { 'af.boundary': 'core-segment' },
        contexts: { react: { digest: error?.digest ?? '' } },
      })
    } catch {
      // Reporting must never turn a contained failure into an uncontained one.
    }
  }, [error])

  /*
   * The house surface — `af-card`, `af-display`, `af-btn`, `var(--muted)` — rather than a
   * hand-rolled panel. An inline palette here would be a second error visual that does not follow
   * the theme, and would render a hardcoded dark card to a light-mode reader.
   */
  return (
    <div className="af-card" role="alert" style={{ padding: 24, maxWidth: 720, margin: '24px auto' }}>
      <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
        This screen did not load
      </h1>
      <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
        Something failed on our side while the screen was building. Your leagues and their settings
        are untouched — nothing has changed.
      </p>
      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {/*
          `reset()` re-runs the server render of THIS screen only, which is the whole retry and is
          why this one is a button rather than the plain link `ScreenLoadError` uses — there, the
          failure was a data read and a fresh request was the only meaningful retry.
        */}
        <button type="button" className="af-btn" onClick={() => reset()}>
          Try again
        </button>
        <Link className="af-btn" href="/core" style={{ display: 'inline-flex' }}>
          My leagues
        </Link>
      </div>
    </div>
  )
}
