'use client'

import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import AIFailureStateRenderer from '@/components/ai-reliability/AIFailureStateRenderer'
import type { ReliabilityMetadata } from '@/lib/ai-reliability/types'

interface AIErrorFallbackProps {
  /** User-facing message */
  message: string
  /** Retry handler; when provided, shows Retry button */
  onRetry?: () => void
  /** When true, show loading state on retry button */
  retryLoading?: boolean
  /** When true, this is deterministic-only fallback (use AIFailureStateRenderer style) */
  usedDeterministicFallback?: boolean
  /** Optional: show "View data only" when deterministic result exists */
  onShowDataOnly?: () => void
  /** Optional reliability metadata for Prompt 127 failure rendering. */
  reliability?: ReliabilityMetadata | null
  /** Optional confidence number to display in reliability renderer. */
  confidence?: number
  className?: string
}

/**
 * Generic AI error / fallback UI. For deterministic-only fallback, use AIFailureStateRenderer;
 * this component can wrap it or be used for non-fallback errors (e.g. validation, 503).
 */
export default function AIErrorFallback({
  message,
  onRetry,
  retryLoading = false,
  usedDeterministicFallback = false,
  onShowDataOnly,
  reliability,
  confidence,
  className = '',
}: AIErrorFallbackProps) {
  if (usedDeterministicFallback || reliability) {
    return (
      <AIFailureStateRenderer
        usedDeterministicFallback={usedDeterministicFallback}
        fallbackExplanation={message}
        onRetry={onRetry}
        retryLoading={retryLoading}
        reliability={reliability}
        confidence={confidence}
        className={className}
      />
    )
  }

  return (
    <div className={`rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-amber-200">{message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={retryLoading}
                data-testid="ai-error-retry-button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${retryLoading ? 'animate-spin' : ''}`} />
                {retryLoading ? 'Retrying…' : 'Retry'}
              </button>
            )}
            {onShowDataOnly && (
              <button
                type="button"
                onClick={onShowDataOnly}
                className="inline-flex items-center rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10"
              >
                View data only
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
