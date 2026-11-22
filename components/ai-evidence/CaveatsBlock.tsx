'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'

interface CaveatsBlockProps {
  /** Caveats when confidence is capped or risks apply. */
  caveats: string[]
  /** Optional title. */
  title?: string
  /** Default expanded when caveats exist. */
  defaultExpanded?: boolean
  className?: string
}

/**
 * Renders caveats block when confidence is capped or risks apply.
 * Readable on mobile and desktop. No unwired clickables.
 */
export default function CaveatsBlock({
  caveats,
  title = 'Caveats',
  defaultExpanded = true,
  className = '',
}: CaveatsBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (!caveats?.length) return null

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
          <AlertTriangle className="h-4 w-4 text-amber-400/80 shrink-0" />
          <span className="text-sm font-medium text-amber-200/90">{title}</span>
          <span className="text-xs text-amber-200/60">({caveats.length})</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-amber-200/50 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 text-amber-200/50 shrink-0" aria-hidden />
        )}
      </button>
      {expanded && (
        <ul className="border-t border-amber-500/20 p-3 space-y-1.5 list-disc list-inside text-xs text-amber-200/80">
          {caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
