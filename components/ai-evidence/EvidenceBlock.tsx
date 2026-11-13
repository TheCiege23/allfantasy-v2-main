'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Database } from 'lucide-react'
import type { EvidenceItem } from '@/lib/ai-context-envelope'

interface EvidenceBlockProps {
  /** Evidence items to display (from deterministic layer only). */
  items: EvidenceItem[]
  /** Optional title. */
  title?: string
  /** Default expanded on desktop. */
  defaultExpanded?: boolean
  /** Optional tool id for aria. */
  toolId?: string
  className?: string
}

/**
 * Renders evidence block. Evidence block always renders if items are available.
 * Readable on mobile (collapsible) and desktop. No clickable element without wiring.
 */
export default function EvidenceBlock({
  items,
  title = 'What the data says',
  defaultExpanded = true,
  toolId,
  className = '',
}: EvidenceBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

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
        aria-controls={toolId ? `evidence-list-${toolId}` : undefined}
      >
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-400/80 shrink-0" />
          <span className="text-sm font-medium text-white/90">{title}</span>
          <span className="text-xs text-white/50">({items.length})</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-white/40 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 text-white/40 shrink-0" aria-hidden />
        )}
      </button>
      {expanded && (
        <ul
          id={toolId ? `evidence-list-${toolId}` : undefined}
          className="border-t border-white/10 p-3 space-y-2 list-none"
        >
          {items.map((item, i) => (
            <li key={i} className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-1 text-xs">
              <span className="text-white/50 shrink-0">{item.label}</span>
              <span className="text-white/80 text-right break-words">
                {typeof item.value === 'number' ? item.value : item.value}
                {item.unit ? ` ${item.unit}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
