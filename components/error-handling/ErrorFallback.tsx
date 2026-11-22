'use client'

import { getErrorMessage } from '@/lib/error-handling'

type ErrorFallbackProps = {
  error: Error
  resetErrorBoundary?: () => void
  /** Override title */
  title?: string
  /** Show retry button (default true when resetErrorBoundary is provided) */
  showRetry?: boolean
  className?: string
}

export function ErrorFallback({
  error,
  resetErrorBoundary,
  title = "Something went wrong",
  showRetry = true,
  className = "",
}: ErrorFallbackProps) {
  const message = getErrorMessage(error)
  const canRetry = showRetry && typeof resetErrorBoundary === "function"

  return (
    <div
      role="alert"
      className={`rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-center ${className}`}
    >
      <h3 className="text-base font-semibold text-amber-200">{title}</h3>
      <p className="mt-2 text-sm text-white/80">{message}</p>
      {canRetry && (
        <button
          type="button"
          onClick={resetErrorBoundary}
          className="mt-4 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/20 px-4 py-2.5 text-sm font-medium text-amber-200 hover:bg-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] touch-manipulation"
        >
          Try again
        </button>
      )}
    </div>
  )
}
