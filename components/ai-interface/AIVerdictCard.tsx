'use client'

import React from 'react'
import { MessageSquare } from 'lucide-react'

interface AIVerdictCardProps {
  /** Primary AI synthesis text */
  primaryAnswer: string
  /** Optional short verdict label */
  verdict?: string
  className?: string
}

/**
 * AI synthesis output block. Calm typography; no hype.
 */
export default function AIVerdictCard({
  primaryAnswer,
  verdict,
  className = '',
}: AIVerdictCardProps) {
  if (!primaryAnswer?.trim()) return null

  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="h-4 w-4 text-cyan-400/80" />
        <span className="text-sm font-medium text-white/80">{verdict ? 'Summary' : 'Summary'}</span>
        {verdict && (
          <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs font-medium text-cyan-300">
            {verdict}
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed text-white/90 whitespace-pre-wrap">{primaryAnswer}</p>
    </div>
  )
}
