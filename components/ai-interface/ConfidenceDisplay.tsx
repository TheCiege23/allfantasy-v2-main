'use client'

import React, { useState } from 'react'
import { Info } from 'lucide-react'

export type ConfidenceLabel = 'low' | 'medium' | 'high'

export interface ConfidenceDisplayProps {
  confidencePct?: number
  confidenceLabel?: ConfidenceLabel
  /** Optional reason (e.g. data quality); shown on expand */
  reason?: string
  size?: 'sm' | 'md'
  className?: string
}

const LABEL_STYLES: Record<ConfidenceLabel, string> = {
  high: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  medium: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  low: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
}

/**
 * Confidence badge/meter. Tappable for "Why?" explanation when reason provided.
 */
export default function ConfidenceDisplay({
  confidencePct,
  confidenceLabel = 'medium',
  reason,
  size = 'md',
  className = '',
}: ConfidenceDisplayProps) {
  const [showReason, setShowReason] = useState(false)
  const label = confidenceLabel
  const style = LABEL_STYLES[label] ?? LABEL_STYLES.medium

  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'

  return (
    <div className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-lg border font-medium ${sizeClass} ${style}`}
        >
          {label.charAt(0).toUpperCase() + label.slice(1)} confidence
          {confidencePct != null && <span className="opacity-80">({confidencePct}%)</span>}
        </span>
        {reason && (
          <button
            type="button"
            onClick={() => setShowReason(!showReason)}
            data-testid="ai-confidence-info-button"
            className="rounded p-1 text-white/50 hover:text-white/80 hover:bg-white/10"
            aria-label="Why this confidence?"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {showReason && reason && (
        <p className="text-xs text-white/60 max-w-xs" data-testid="ai-confidence-reason-text">
          {reason}
        </p>
      )}
    </div>
  )
}
