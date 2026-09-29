'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronUp, FileQuestion } from 'lucide-react'
import type { MissingDataItem } from '@/lib/ai-context-envelope'

export interface MissingDataBlockProps {
  /** Missing data items — never silently ignored. */
  items: MissingDataItem[]
  /** Optional title. */
  title?: string
  /** Default expanded when there are high-impact items. */
  defaultExpanded?: boolean
  className?: string
}

const impactStyles: Record<string, string> = {
  high: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  medium: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
  low: 'text-white/50 border-white/20 bg-white/5',
}

/**
 * Renders missing-data block. Missing data must not be silently ignored.
 * Readable on mobile and desktop. No unwired clickables.
 */
export default function MissingDataBlock({
  items,
  title = 'Missing data',
  defaultExpanded,
  className = '',
}: MissingDataBlockProps) {
  const hasHigh = items.some((m) => m.impact === 'high')
  const [expanded, setExpanded] = useState(defaultExpanded ?? hasHigh)

  if (!items?.length) return null

  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden ${className}`}
      role="region"
      aria-label={title}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-white/[0.04] min-h-[44px] touch-manipulation"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <FileQuestion className="h-4 w-4 text-white/50 shrink-0" />
          <span className="text-sm font-medium text-white/80">{title}</span>
          <span className="text-xs text-white/50">({items.length})</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-white/40 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 text-white/40 shrink-0" aria-hidden />
        )}
      </button>
      {expanded && (
        <ul className="border-t border-white/10 p-3 space-y-2 list-none">
          {items.map((item, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <span className="text-sm text-white/80">{item.what}</span>
              {item.suggestedAction && (
                <span className="text-xs text-cyan-300/80">{item.suggestedAction}</span>
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
