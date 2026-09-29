'use client'

import React from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, Info, ShieldAlert, X, XCircle } from 'lucide-react'

export type ChimmyAlertBannerVariant = 'info' | 'warning' | 'success' | 'error'

export interface ChimmyAlertBannerProps {
  variant?: ChimmyAlertBannerVariant
  title?: string
  message: string
  explanation?: string
  /** Optional CTA label */
  ctaLabel?: string
  onCta?: () => void
  primaryActionLabel?: string
  onPrimaryAction?: () => void
  /** Allow dismissal */
  dismissible?: boolean
  onDismiss?: () => void
  className?: string
}

const VARIANT_STYLES: Record<ChimmyAlertBannerVariant, { container: string; icon: React.ReactNode; label: string }> = {
  info: {
    container: 'border-cyan-300/35 bg-gradient-to-r from-cyan-500/18 via-cyan-500/8 to-transparent text-cyan-100',
    icon: <Info className="h-4 w-4 text-cyan-200 shrink-0" />,
    label: 'Insight',
  },
  warning: {
    container: 'border-amber-300/45 bg-gradient-to-r from-amber-500/20 via-amber-500/8 to-transparent text-amber-100',
    icon: <AlertTriangle className="h-4 w-4 text-amber-200 shrink-0" />,
    label: 'Urgent',
  },
  success: {
    container: 'border-emerald-300/35 bg-gradient-to-r from-emerald-500/18 via-emerald-500/8 to-transparent text-emerald-100',
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-200 shrink-0" />,
    label: 'Good News',
  },
  error: {
    container: 'border-rose-300/45 bg-gradient-to-r from-rose-500/20 via-rose-500/8 to-transparent text-rose-100',
    icon: <ShieldAlert className="h-4 w-4 text-rose-200 shrink-0" />,
    label: 'Critical',
  },
}

export default function ChimmyAlertBanner({
  variant = 'info',
  title,
  message,
  explanation,
  ctaLabel,
  onCta,
  primaryActionLabel,
  onPrimaryAction,
  dismissible = false,
  onDismiss,
  className = '',
}: ChimmyAlertBannerProps) {
  const styles = VARIANT_STYLES[variant]
  const actionLabel = primaryActionLabel ?? ctaLabel
  const actionHandler = onPrimaryAction ?? onCta
  const resolvedTitle = title ?? styles.label

  return (
    <section className={`rounded-xl border px-3 py-2.5 text-sm backdrop-blur-sm sm:px-4 ${styles.container} ${className}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/15">
          {styles.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/25 bg-black/25 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/90">
              {resolvedTitle}
            </span>
            <p className="truncate text-[13px] font-semibold leading-tight text-white">{message}</p>
          </div>
          {explanation && <p className="text-xs leading-relaxed text-white/70">{explanation}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actionLabel && actionHandler && (
            <button
              onClick={actionHandler}
              className="inline-flex items-center gap-1 rounded-lg border border-white/30 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-white/20"
            >
              {actionLabel}
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
          {dismissible && onDismiss && (
            <button
              onClick={onDismiss}
              aria-label="Dismiss"
              className="rounded-lg p-1 hover:bg-white/10 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {variant === 'error' && !explanation && (
        <p className="mt-2 text-xs text-white/70">Take action now to avoid lineup or scoring impact.</p>
      )}
      {variant === 'error' && explanation && (
        <p className="mt-2 text-[11px] uppercase tracking-wide text-white/55">Requires acknowledgement</p>
      )}
      {variant !== 'error' && explanation && (
        <p className="mt-2 text-[11px] uppercase tracking-wide text-white/45">Chimmy recommendation</p>
      )}
      {variant !== 'error' && !explanation && (
        <p className="mt-2 text-[11px] uppercase tracking-wide text-white/40">Chimmy surfaced this because it is actionable</p>
      )}
      {variant === 'success' && (
        <p className="mt-2 text-[11px] uppercase tracking-wide text-white/45">Status update</p>
      )}
      {variant === 'warning' && (
        <p className="mt-2 text-[11px] uppercase tracking-wide text-white/55">Time-sensitive</p>
      )}
      {variant === 'info' && (
        <p className="mt-2 text-[11px] uppercase tracking-wide text-white/45">Low interruption alert</p>
      )}
      {variant === 'error' && (
        <p className="mt-2 text-[11px] uppercase tracking-wide text-white/60">High priority alert</p>
      )}
      {variant === 'warning' && <div className="mt-2 h-px bg-white/15" />}
      {variant === 'error' && <div className="mt-2 h-px bg-white/20" />}
      {variant === 'info' && <div className="mt-2 h-px bg-white/10" />}
      {variant === 'success' && <div className="mt-2 h-px bg-white/10" />}
      {variant === 'info' && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-white/45">
          <Info className="h-3 w-3" />
          <span>Non-blocking guidance</span>
        </div>
      )}
      {variant === 'warning' && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-white/55">
          <AlertTriangle className="h-3 w-3" />
          <span>Recommended action soon</span>
        </div>
      )}
      {variant === 'success' && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-white/50">
          <CheckCircle2 className="h-3 w-3" />
          <span>No action required</span>
        </div>
      )}
      {variant === 'error' && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-white/60">
          <XCircle className="h-3 w-3" />
          <span>Immediate action required</span>
        </div>
      )}
      <div className="sr-only">Chimmy alert banner</div>
    </section>
  )
}
