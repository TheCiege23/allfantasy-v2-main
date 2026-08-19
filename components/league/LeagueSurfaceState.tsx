'use client'

import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Clock3, Inbox, LockKeyhole, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type LeagueSurfaceStateKind = 'loading' | 'empty' | 'error' | 'permission'

const STATE_ICON: Record<LeagueSurfaceStateKind, LucideIcon> = {
  loading: Clock3,
  empty: Inbox,
  error: AlertTriangle,
  permission: LockKeyhole,
}

export function LeagueSurfaceState({
  kind,
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
  testId,
}: {
  kind: LeagueSurfaceStateKind
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  compact?: boolean
  testId?: string
}) {
  const Icon = STATE_ICON[kind]
  const isLoading = kind === 'loading'

  return (
    <section
      className={cn(
        'mx-auto flex w-full max-w-2xl flex-col items-center justify-center rounded-2xl border px-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
        compact ? 'min-h-36 py-6' : 'min-h-56 py-10',
        kind === 'error'
          ? 'border-rose-400/20 bg-rose-500/[0.07]'
          : kind === 'permission'
            ? 'border-amber-300/20 bg-amber-500/[0.07]'
            : 'border-cyan-400/15 bg-[linear-gradient(160deg,rgba(15,23,42,0.9),rgba(6,13,26,0.96))]',
      )}
      role={kind === 'error' || kind === 'permission' ? 'alert' : 'status'}
      aria-live={kind === 'loading' ? 'polite' : undefined}
      aria-busy={isLoading || undefined}
      data-testid={testId}
    >
      <span
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-2xl border',
          kind === 'error'
            ? 'border-rose-300/25 bg-rose-500/10 text-rose-200'
            : kind === 'permission'
              ? 'border-amber-300/25 bg-amber-500/10 text-amber-100'
              : 'border-cyan-300/20 bg-cyan-500/10 text-cyan-100',
        )}
        aria-hidden
      >
        <Icon className={cn('h-5 w-5', isLoading && 'animate-pulse')} />
      </span>
      <h2 className="mt-3 text-base font-black tracking-tight text-white">{title}</h2>
      <p className="mt-1 max-w-lg text-sm leading-6 text-white/55">{description}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 text-sm font-bold text-cyan-100 transition hover:bg-cyan-500/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {actionLabel}
        </button>
      ) : null}
    </section>
  )
}
