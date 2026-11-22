'use client'

/**
 * [NEW] User status badge: SAFE | HOH | NOMINATED | VETO_PLAYER | VETO_WINNER | ELIMINATED | JURY. PROMPT 4.
 */

import type { BigBrotherUserStatus } from './types'

const LABELS: Record<BigBrotherUserStatus, string> = {
  SAFE: 'Safe',
  HOH: 'HOH',
  NOMINATED: 'On the Block',
  VETO_PLAYER: 'Veto Player',
  VETO_WINNER: 'Veto Winner',
  ELIMINATED: 'Eliminated',
  JURY: 'Jury',
}

const STYLES: Record<BigBrotherUserStatus, string> = {
  SAFE: 'border-emerald-500/50 bg-emerald-950/40 text-emerald-200',
  HOH: 'border-amber-500/60 bg-amber-950/50 text-amber-200',
  NOMINATED: 'border-red-500/50 bg-red-950/40 text-red-200',
  VETO_PLAYER: 'border-cyan-500/50 bg-cyan-950/40 text-cyan-200',
  VETO_WINNER: 'border-cyan-400/60 bg-cyan-900/50 text-cyan-100',
  ELIMINATED: 'border-white/20 bg-white/5 text-white/50',
  JURY: 'border-purple-500/50 bg-purple-950/40 text-purple-200',
}

interface BigBrotherStatusBadgeProps {
  status: BigBrotherUserStatus
  className?: string
}

export function BigBrotherStatusBadge({ status, className = '' }: BigBrotherStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-xs font-medium ${STYLES[status]} ${className}`}
    >
      {LABELS[status]}
    </span>
  )
}
