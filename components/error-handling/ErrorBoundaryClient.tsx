'use client'

import { ErrorBoundary } from './ErrorBoundary'

/**
 * Client wrapper that wraps children in an ErrorBoundary.
 * Use in root or segment layouts to catch render errors and show a fallback.
 *
 * Pass `fallback={null}` for silent failure (the crashed subtree disappears
 * rather than showing the amber error UI). Useful for non-critical chrome like
 * SafeGlobalChrome where a crash should not blank the whole page.
 */
export function ErrorBoundaryClient({
  children,
  fallback,
}: {
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  return (
    <ErrorBoundary fallback={fallback}>
      {children}
    </ErrorBoundary>
  )
}
