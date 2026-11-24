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
  SAFE: 'border-[var(--good)] bg-[var(--good-soft)] text-[var(--good)]',
  HOH: 'border-[var(--line2)] bg-[var(--warn-soft)] text-[var(--warn)]',
  NOMINATED: 'border-[var(--bad)] bg-[var(--bad-soft)] text-[var(--bad)]',
  VETO_PLAYER: 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]',
  VETO_WINNER: 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]',
  ELIMINATED: 'border-[var(--line)] bg-[var(--chip)] text-[var(--muted)]',
  JURY: 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]',
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
