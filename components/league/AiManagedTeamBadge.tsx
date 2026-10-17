'use client'

import { Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Subtle indicator for AI-managed teams — use next to team name in draft board, standings, matchups.
 */
export function AiManagedTeamBadge({
  className,
  variant = 'default',
  label = 'AI',
}: {
  className?: string
  variant?: 'default' | 'compact'
  label?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-cyan-400/35 bg-cyan-500/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-100/95',
        variant === 'compact' && 'px-1 py-0 text-[11px]',
        className,
      )}
      title="This team is managed by an AllFantasy AI opponent"
    >
      <Cpu className="h-3 w-3 opacity-90" aria-hidden />
      {label}
    </span>
  )
}
