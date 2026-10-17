'use client'

import type { BotArchetypeId } from '@/lib/ai/opponents/types'

export type BotPersonalityBadgeProps = {
  /** Short label, e.g. "Balanced Builder" */
  archetypeLabel: string
  archetypeId?: BotArchetypeId | string | null
  /** Compact chip for tight layouts (draft strip, feed). */
  compact?: boolean
  className?: string
}

/**
 * Subtle AI manager marker — archetype only; no noisy animation.
 */
export function BotPersonalityBadge({
  archetypeLabel,
  archetypeId: _archetypeId,
  compact = false,
  className = '',
}: BotPersonalityBadgeProps) {
  const label = archetypeLabel.trim() || 'AI'
  const summary = `AI-managed team · ${label}`

  if (compact) {
    return (
      <span
        className={`inline-flex max-w-full items-center gap-1 rounded-md border border-sky-500/35 bg-sky-500/10 px-1 py-px text-[11px] font-semibold uppercase tracking-wide text-sky-100/95 ${className}`}
        title={summary}
      >
        <span className="text-sky-300/90">AI</span>
        <span className="truncate font-normal normal-case tracking-normal text-white/75">· {label}</span>
      </span>
    )
  }

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/80 ${className}`}
      title={summary}
    >
      <span className="rounded bg-sky-500/25 px-1 text-[11px] font-bold uppercase tracking-wide text-sky-100">AI</span>
      <span className="truncate text-white/75">{label}</span>
    </span>
  )
}
