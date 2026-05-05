'use client'

import React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface AIToolCardProps {
  id: string
  title: string
  description: string
  href: string
  icon: LucideIcon
  /** Tailwind gradient/border classes, e.g. "from-cyan-500/20 to-blue-500/10 border-cyan-500/20" */
  accent?: string
  className?: string
}

/**
 * Single AI tool card; links to the tool route. No dead buttons.
 */
export default function AIToolCard({
  id,
  title,
  description,
  href,
  icon: Icon,
  accent = 'from-cyan-500/20 to-blue-500/10 border-cyan-500/20',
  className = '',
}: AIToolCardProps) {
  return (
    <Link
      href={href}
      data-tool-id={id}
      data-testid={`ai-tool-card-${id}`}
      className={`group flex touch-manipulation items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-white/20 hover:bg-white/[0.06] active:bg-white/[0.08] ${className}`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-gradient-to-br ${accent}`}
      >
        <Icon className="h-5 w-5 text-white/90" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="font-medium text-white group-hover:text-cyan-200">{title}</span>
        <p className="mt-0.5 text-xs text-white/50">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/30 group-hover:text-white/60" aria-hidden />
    </Link>
  )
}
