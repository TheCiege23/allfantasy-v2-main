'use client'

import React from 'react'
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Info } from 'lucide-react'
import type { ReliabilityMetadata } from '@/lib/ai-reliability/types'

interface AIFailureStateRendererProps {
  /** When true, show fallback banner and optional deterministic result */
  usedDeterministicFallback?: boolean
  /** Short explanation (e.g. "AI analysis is temporarily unavailable. Showing data-only result.") */
  fallbackExplanation?: string
  /** Retry handler */
  onRetry?: () => void
  /** Loading state for retry */
  retryLoading?: boolean
  /** Optional full reliability metadata */
  reliability?: ReliabilityMetadata | null
  /** Show expandable data quality / provider details */
  showDetails?: boolean
  /** Confidence 0-100 to show */
  confidence?: number
  className?: string
}

export default function AIFailureStateRenderer({
  usedDeterministicFallback,
  fallbackExplanation,
  onRetry,
  retryLoading = false,
  reliability,
  showDetails = true,
  confidence,
  className = '',
}: AIFailureStateRendererProps) {
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const message = fallbackExplanation ?? reliability?.fallbackExplanation ?? (usedDeterministicFallback ? 'AI analysis is temporarily unavailable. Showing data-only result.' : '')

  if (!message && !reliability?.dataQualityWarnings?.length && confidence == null) return null

  return (
    <div
      className={`rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3 ${className}`}
      data-testid="ai-failure-state-renderer"
    >
      {(message || usedDeterministicFallback) && (
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-amber-200" data-testid="ai-fallback-explanation">
              {message}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={retryLoading}
                data-testid="ai-fallback-retry-button"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${retryLoading ? 'animate-spin' : ''}`} />
                {retryLoading ? 'Retrying…' : 'Retry AI analysis'}
              </button>
            )}
          </div>
        </div>
      )}

      {confidence != null && (
        <div className="flex items-center gap-2 text-xs text-white/70">
          <Info className="w-3.5 h-3.5" />
          <span>Confidence: {confidence}%</span>
        </div>
      )}

      {showDetails && reliability && (reliability.dataQualityWarnings.length > 0 || reliability.providerResults.length > 0) && (
        <>
          <button
            type="button"
            onClick={() => setDetailsOpen(!detailsOpen)}
            data-testid="ai-data-quality-toggle-button"
            className="flex items-center gap-1 text-xs text-white/60 hover:text-white/80"
          >
            {detailsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {detailsOpen ? 'Hide' : 'Show'} data quality info
          </button>
          {detailsOpen && (
            <div
              className="rounded-lg bg-black/20 p-3 space-y-2 text-xs text-white/70"
              data-testid="ai-data-quality-details"
            >
              {reliability.providerResults.length > 0 && (
                <div>
                  <span className="font-medium text-white/80">Providers: </span>
                  {reliability.providerResults.map((r) => (
                    <span key={r.provider} className="mr-2">
                      {r.provider}: {r.status}
                      {r.error ? ` (${r.error.slice(0, 40)}…)` : ''}
                    </span>
                  ))}
                </div>
              )}
              {reliability.dataQualityWarnings.length > 0 && (
                <ul className="list-disc list-inside">
                  {reliability.dataQualityWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
