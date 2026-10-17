'use client'

import React, { useState } from 'react'
import { Info } from 'lucide-react'
import type { Confidence } from '@/lib/ai-context-envelope'

export type ConfidenceLabel = 'low' | 'medium' | 'high'

export interface ConfidenceMeterProps {
  /** 0–100. Always displayed when provided. */
  scorePct?: number
  label?: ConfidenceLabel
  reason?: string
  /** When true, show capped warning. */
  cappedByData?: boolean
  capReason?: string
  /** Full confidence object from envelope (overrides individual props). */
  confidence?: Confidence | null
  size?: 'sm' | 'md'
  className?: string
}

const LABEL_STYLES: Record<ConfidenceLabel, string> = {
  high: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  medium: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  low: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
}

/**
 * Confidence meter — always displayed. Bar + label; do not hide.
 * Reflects data strength; capped when data is missing or uncertain.
 */
export default function ConfidenceMeter({
  scorePct: scorePctProp,
  label: labelProp = 'medium',
  reason,
  cappedByData,
  capReason,
  confidence,
  size = 'md',
  className = '',
}: ConfidenceMeterProps) {
  const scorePct = confidence?.scorePct ?? scorePctProp
  const label = (confidence?.label ?? labelProp) as ConfidenceLabel
  const reasonText = confidence?.reason ?? reason
  const capped = confidence?.cappedByData ?? cappedByData
  const cap = confidence?.capReason ?? capReason

  const [showReason, setShowReason] = useState(false)
  const hasValue = typeof scorePct === 'number' || (confidence != null && typeof confidence.scorePct === 'number')
  const style = LABEL_STYLES[label] ?? LABEL_STYLES.medium
  const pct = typeof scorePct === 'number' ? Math.min(100, Math.max(0, scorePct)) : (confidence?.scorePct != null ? Math.min(100, Math.max(0, confidence.scorePct)) : 0)
  const sizeClass = size === 'sm' ? 'h-1.5' : 'h-2'

  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.03] p-3 ${className}`}
      role="region"
      aria-label="Confidence"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-white/70">Confidence</span>
        {hasValue ? (
          <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium ${style}`}>
            {label.charAt(0).toUpperCase() + label.slice(1)}
            {(typeof scorePct === 'number' || confidence?.scorePct != null) && (
              <span className="opacity-90">({typeof scorePct === 'number' ? scorePct : confidence!.scorePct}%)</span>
            )}
          </span>
        ) : (
          <span className="text-xs text-white/50">Not assessed</span>
        )}
      </div>
      {hasValue && (
        <div className={`w-full rounded-full bg-white/10 ${sizeClass}`}>
          <div
            className={`rounded-full bg-cyan-500/60 transition-[width] ${sizeClass}`}
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
      {(capped && cap) && (
        <p className="mt-1.5 text-[11px] text-amber-300/90">Capped: {cap}</p>
      )}
      {reasonText && (
        <>
          <button
            type="button"
            onClick={() => setShowReason(!showReason)}
            className="mt-1.5 flex items-center gap-1 text-[11px] text-white/50 hover:text-white/70"
            aria-label="Why this confidence?"
          >
            <Info className="h-3 w-3" />
            Why?
          </button>
          {showReason && <p className="mt-0.5 text-xs text-white/60 max-w-xs">{reasonText}</p>}
        </>
      )}
    </div>
  )
}
