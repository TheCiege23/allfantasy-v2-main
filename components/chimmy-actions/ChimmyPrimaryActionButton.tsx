'use client'

import { Sparkles, Lock } from 'lucide-react'
import type { AIAction } from '@/lib/chimmy-actions'

interface ChimmyPrimaryActionButtonProps {
  action: AIAction
  onClick: (action: AIAction) => void
  isLoading?: boolean
  className?: string
}

/**
 * The primary CTA button for a Chimmy-recommended AI action.
 * Shows a loading spinner while executing and disables when not available.
 */
export function ChimmyPrimaryActionButton({
  action,
  onClick,
  isLoading = false,
  className = '',
}: ChimmyPrimaryActionButtonProps) {
  const disabled = !action.isAvailable || isLoading

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(action)}
      className={[
        'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
        disabled
          ? 'cursor-not-allowed bg-white/10 text-white/30'
          : 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 active:scale-95',
        className,
      ].join(' ')}
      aria-label={action.label}
    >
      {isLoading ? (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
          aria-hidden="true"
        />
      ) : action.requiresPremium && !action.isAvailable ? (
        <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>{action.label}</span>
      {action.premiumBadgeLabel && action.requiresPremium && (
        <span className="ml-1 rounded bg-indigo-400/20 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-indigo-200">
          {action.premiumBadgeLabel}
        </span>
      )}
    </button>
  )
}
