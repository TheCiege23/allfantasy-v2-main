'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import type { UncertaintyItem } from '@/lib/ai-context-envelope'

export interface UncertaintyBlockProps {
  /** Uncertainty items (when confidence is limited or data incomplete). */
  items: UncertaintyItem[]
  /** Optional title. */
  title?: string
  /** Default expanded when there are high-impact items. */
  defaultExpanded?: boolean
  className?: string
}

const impactStyles: Record<string, string> = {
  high: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  medium: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
  low: 'text-white/60 border-white/20 bg-white/5',
}

/**
 * Renders uncertainty block when confidence is limited.
 * Always show when items are provided; never silently ignore.
 * Readable on mobile and desktop. No unwired clickables.
 */
export default function UncertaintyBlock({
  items,
  title = 'Uncertainty',
  defaultExpanded,
  className = '',
}: UncertaintyBlockProps) {
  const hasHigh = items.some((u) => u.impact === 'high')
  const [expanded, setExpanded] = useState(defaultExpanded ?? hasHigh)

  if (!items?.length) return null

  return (
    <div
      className={`rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden ${className}`}
      role="region"
      aria-label={title}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-amber-500/10 min-h-[44px] touch-manipulation"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-400/80 shrink-0" />
          <span className="text-sm font-medium text-amber-200/90">{title}</span>
          <span className="text-xs text-amber-200/60">({items.length})</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-amber-200/50 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 text-amber-200/50 shrink-0" aria-hidden />
        )}
      </button>
      {expanded && (
        <ul className="border-t border-amber-500/20 p-3 space-y-2 list-none">
          {items.map((item, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <span className="text-sm text-amber-200/90">{item.what}</span>
              {item.reason && (
                <span className="text-xs text-amber-200/70">{item.reason}</span>
              )}
              <span
                className={`inline-flex w-fit rounded px-2 py-0.5 text-[11px] font-medium border capitalize ${impactStyles[item.impact] ?? impactStyles.low}`}
              >
                {item.impact} impact
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
