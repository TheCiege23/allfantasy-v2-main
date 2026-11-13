'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Database } from 'lucide-react'

interface DeterministicEvidenceCardProps {
  /** Key-value pairs or list of evidence strings from deterministic payload */
  evidence?: Record<string, unknown> | string[]
  /** Optional title override */
  title?: string
  /** Default expanded on desktop */
  defaultExpanded?: boolean
  className?: string
}

function formatValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.slice(0, 5).map(formatValue).join(', ') + (v.length > 5 ? '…' : '')
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80) + (JSON.stringify(v).length > 80 ? '…' : '')
  return String(v)
}

/**
 * Displays deterministic (engine) facts. Read-only; no AI-generated numbers.
 * Mobile: collapsible. Desktop: defaultExpanded true.
 */
export default function DeterministicEvidenceCard({
  evidence,
  title = 'From your data',
  defaultExpanded = true,
  className = '',
}: DeterministicEvidenceCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (!evidence) return null

  const entries: { key: string; value: string }[] = []
  if (Array.isArray(evidence)) {
    evidence.slice(0, 15).forEach((item, i) => {
      entries.push({ key: `Item ${i + 1}`, value: typeof item === 'string' ? item : formatValue(item) })
    })
  } else if (typeof evidence === 'object') {
    Object.entries(evidence).slice(0, 15).forEach(([k, v]) => {
      entries.push({ key: k, value: formatValue(v) })
    })
  }

  if (entries.length === 0) return null

  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-white/[0.04]"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-400/80" />
          <span className="text-sm font-medium text-white/90">{title}</span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
      </button>
      {expanded && (
        <div className="border-t border-white/10 p-3 space-y-2">
          {entries.map(({ key, value }) => (
            <div key={key} className="flex justify-between gap-2 text-xs">
              <span className="text-white/50 shrink-0">{key}</span>
              <span className="text-white/80 text-right break-words">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
