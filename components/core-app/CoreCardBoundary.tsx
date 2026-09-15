'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import * as Sentry from '@sentry/nextjs'
import { isNavigationSignal } from '@/components/core-app/CoreScreenErrorBoundary'

/**
 * Keeps one failed /core home card from taking the rest of the home with it.
 *
 * The home's cards stream independently, each behind its own Suspense boundary. A card whose RENDER
 * throws would otherwise climb to `CoreScreenErrorBoundary` and replace every card on the screen —
 * the career card failing would blank the injury triage. So each card gets this boundary: the card
 * that failed says so in one line, and every other card renders as it would have.
 *
 * Loader failures never reach here — every home read already degrades to its own empty value. This
 * is for render bugs, which is why it reports each one to Sentry, tagged with the card.
 *
 * ⚠ SAME RULES AS THE SCREEN BOUNDARY, FOR THE SAME REASONS: `redirect()`/`notFound()` pass straight
 * through, and the reset happens in `getDerivedStateFromProps` when the URL changes.
 */

type Props = { card: string; resetKey: string; children: ReactNode }
type State = { failed: boolean; resetKey: string }

export class CoreCardBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { failed: false, resetKey: props.resetKey }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey }
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    if (isNavigationSignal(error)) throw error
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    try {
      Sentry.captureException(error, {
        tags: { 'af.boundary': 'core-card', 'af.card': this.props.card },
        contexts: { react: { componentStack: info.componentStack ?? '' } },
      })
    } catch {
      // Reporting must never turn a contained failure into an uncontained one.
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <p role="status" data-card-failed={this.props.card} style={{ margin: '8px 0', fontSize: 12, color: 'var(--muted)' }}>
        This part of your home did not load. The rest of the page is unaffected.
      </p>
    )
  }
}

export default CoreCardBoundary
