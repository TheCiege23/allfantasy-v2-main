'use client'

import * as Sentry from '@sentry/nextjs'
import posthog from 'posthog-js'

/**
 * Report a crash an error boundary caught. Same shape as `/core`'s segment boundary
 * (`app/core/(shell)/[[...screen]]/error.tsx`), shared so every boundary reports, not only that one.
 *
 * 🛑 THE APP'S CRASH SCREENS WERE SILENT (owner report, 2026-11-28: "Why does the app crash sometimes?
 * This should never happen"). `app/global-error.tsx` said it would "surface in Railway logs", but it
 * is a client component: its `console.error` printed in the PHONE's console and nowhere else.
 * `app/error.tsx` did the same, and the league route's boundary did nothing. A Next.js error boundary
 * handles the error itself, so Sentry's global handler never sees it either. Every "Something went
 * wrong loading this page" a manager hit left no record anyone could read.
 *
 * Deliberately imports nothing else from the app: `global-error` replaces the root layout and must
 * stay light, so this does not reach into `CoreScreenErrorBoundary` for its navigation check.
 */
export function isNavigationDigest(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null | undefined)?.digest
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND')
}

export function reportBoundaryError(error: (Error & { digest?: string }) | null | undefined, boundary: string): void {
  // A `redirect()` / `notFound()` arrives as a thrown error with a digest, and is not a crash.
  if (!error || isNavigationDigest(error)) return
  try {
    Sentry.captureException(error, {
      tags: { 'af.boundary': boundary },
      contexts: { react: { digest: error.digest ?? '' } },
    })
  } catch {
    // Reporting must never turn a contained failure into an uncontained one.
  }
  // Production strips the stack from a Server Components error; the digest keys the server log line.
  try {
    posthog.captureException(error, { digest: error.digest ?? null, 'af.boundary': boundary })
  } catch {
    // Same rule.
  }
}
