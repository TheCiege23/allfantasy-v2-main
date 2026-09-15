'use client'

import { Component, startTransition, type ErrorInfo, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'

/**
 * Keeps a failed /core screen inside the shell.
 *
 * Before streaming, a render that threw took the page with it and landed on the app-level error
 * card. Now the shell paints first, so a screen that fails afterwards must not tear down the
 * rail, nav and league tabs the user is already looking at — they are the way out. This catches
 * the streamed screen body only; the route's own `error.tsx`, where one exists, still handles
 * anything that fails before the shell renders.
 *
 * ⚠ IT RESETS WHEN `resetKey` CHANGES — the page passes the URL — so navigating away from a failed
 * screen renders the next one instead of carrying the error panel with it. The reset happens in
 * `getDerivedStateFromProps`, in the same render, as Next's own boundary does: resetting after
 * commit would let a failure on the NEXT screen render and report twice.
 *
 * ⚠ `redirect()` AND `notFound()` PASS STRAIGHT THROUGH. Next delivers both as thrown errors and
 * handles them in its own boundaries above the page; catching one here would show "did not load"
 * where the user should have been sent somewhere. Next's own error boundary rethrows them the
 * same way.
 *
 * ⚠ REPORTED FROM HERE, BECAUSE NOTHING ELSE WILL. In production a caught error never reaches the
 * browser SDK's global handlers, and on the server the automatic page wrapper only sees what throws
 * while `AfCorePage` itself runs — the streamed body renders after it has returned. In production
 * the message is redacted; the `digest` on the event matches the server log line for the failure.
 * (In `next dev` React re-dispatches the error to `window` first, Sentry's global handler captures
 * it, and this call is skipped as already captured — so locally the event arrives without the tag.)
 */

type BoundaryProps = { resetKey: string; onRetry: () => void; children: ReactNode }
type BoundaryState = { failed: boolean; resetKey: string }

/** Next's navigation signals, by the digest it stamps on them (NEXT_REDIRECT;…, NEXT_NOT_FOUND). */
function isNavigationSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null | undefined)?.digest
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND')
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props)
    this.state = { failed: false, resetKey: props.resetKey }
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey }
  }

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    if (isNavigationSignal(error)) throw error
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    try {
      Sentry.captureException(error, {
        tags: { 'af.boundary': 'core-screen' },
        contexts: { react: { componentStack: info.componentStack ?? '' } },
      })
    } catch {
      // Reporting must never turn a contained failure into an uncontained one.
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="af-frame" role="alert" style={{ padding: 24, maxWidth: 720 }}>
        <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
          This screen did not load
        </h1>
        <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
          Something failed on our side while reading it. Your leagues and settings are untouched — try
          again, or pick another screen from the menu.
        </p>
        <button
          type="button"
          className="af-btn"
          style={{ marginTop: 12 }}
          onClick={() => {
            /*
             * Refetch and clear in ONE transition. Clearing first would re-render the same failed
             * payload and throw straight back into this panel before the refreshed render arrived.
             */
            startTransition(() => {
              this.props.onRetry()
              this.setState({ failed: false })
            })
          }}
        >
          Try again
        </button>
      </div>
    )
  }
}

export default function CoreScreenErrorBoundary({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const router = useRouter()
  return (
    <Boundary resetKey={resetKey} onRetry={() => router.refresh()}>
      {children}
    </Boundary>
  )
}
