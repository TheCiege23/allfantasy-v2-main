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
  status?: 'Active' | 'Preview' | 'Coming Soon'
  badge?: string
  sport?: string
}

export default function AIToolCard({
  id,
  title,
  description,
  href,
  icon: Icon,
  accent = 'from-cyan-500/20 to-blue-500/10 border-cyan-500/20',
  className = '',
  status,
  badge,
  sport,
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
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-white group-hover:text-cyan-200">{title}</span>
          {badge && (
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                badge === 'Pro'
                  ? 'border-violet-500/40 bg-violet-500/15 text-violet-300'
                  : 'border-white/15 bg-white/[0.06] text-white/45'
              }`}
            >
              {badge}
            </span>
          )}
          {sport && (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-semibold text-white/35">
              {sport}
            </span>
          )}
          {status && status !== 'Active' && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-400/70">
              {status}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-white/50">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/30 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-white/60" aria-hidden />
    </Link>
  )
}
