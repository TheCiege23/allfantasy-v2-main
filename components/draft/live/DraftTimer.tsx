'use client'

import { useMemo } from 'react'
import type { TimerState } from '@/lib/live-draft-engine/types'
import { useDraftCountdownSeconds } from '@/lib/draft/useDraftCountdown'

function formatClockSeconds(totalSec: number | null | undefined): string {
  if (totalSec == null || !Number.isFinite(totalSec)) return '—'
  const s = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

export function DraftTimer({
  timer,
  className = '',
}: {
  timer: TimerState
  className?: string
}) {
  const liveSec = useDraftCountdownSeconds(timer.status, timer.timerEndAt, timer.remainingSeconds, {
    pauseReason: timer.pauseReason,
    overnightResumeAtIso: timer.overnightResumeAt ?? null,
  })
  const sec = liveSec ?? timer.remainingSeconds

  /** Two urgency tiers: critical ≤5s (strong red pulse), urgent ≤15s (amber warning). */
  const [critical, urgent] = useMemo(() => {
    if (timer.status !== 'running') return [false, false]
    const n = liveSec ?? timer.remainingSeconds
    if (n == null) return [false, false]
    if (n <= 5) return [true, false]
    if (n <= 15) return [false, true]
    return [false, false]
  }, [timer.status, timer.remainingSeconds, liveSec])

  const label =
    timer.status === 'paused'
      ? 'Paused'
      : timer.status === 'none'
        ? '—'
        : timer.status === 'expired'
          ? '0:00'
          : sec != null
            ? formatClockSeconds(sec)
            : '—'

  const containerClass = critical
    ? 'border-rose-500/60 bg-gradient-to-br from-rose-500/20 via-[#0a1228]/95 to-[#070d18]/95 shadow-[0_0_48px_rgba(239,68,68,0.55)] ring-2 ring-rose-500/50 scale-[1.04] animate-pulse'
    : urgent
      ? 'border-amber-400/50 bg-gradient-to-br from-amber-500/15 via-[#0a1228]/95 to-[#070d18]/95 shadow-[0_0_36px_rgba(251,191,46,0.45)] ring-2 ring-amber-400/55 scale-[1.02]'
      : timer.status === 'paused'
        ? 'border-amber-300/35 bg-gradient-to-br from-amber-500/10 via-[#0a1228]/95 to-[#070d18]/95 shadow-[0_0_20px_rgba(251,191,36,0.18)]'
        : timer.status === 'expired'
          ? 'border-rose-400/45 bg-gradient-to-br from-rose-500/15 via-[#0a1228]/95 to-[#070d18]/95 shadow-[0_0_28px_rgba(239,68,68,0.35)]'
          : timer.status === 'none'
            ? 'border-white/10 bg-[#0a1228]/80 shadow-none opacity-60'
            : 'border-cyan-500/25 bg-gradient-to-br from-cyan-500/8 via-[#0a1228]/95 to-[#070d18]/95 shadow-[0_0_24px_rgba(34,211,238,0.12)]'

  const labelText = critical
    ? 'URGENT'
    : urgent
      ? 'PICK CLOCK'
      : timer.status === 'paused'
        ? 'PAUSED'
        : timer.status === 'expired'
          ? 'EXPIRED'
          : 'PICK CLOCK'

  const labelColor = critical
    ? 'text-rose-200'
    : urgent
      ? 'text-amber-200'
      : timer.status === 'paused'
        ? 'text-amber-200/80'
        : timer.status === 'expired'
          ? 'text-rose-300/80'
          : 'text-cyan-200/70'

  const digitClass = critical
    ? 'text-rose-50 text-4xl sm:text-5xl'
    : urgent
      ? 'text-amber-50 text-4xl sm:text-5xl'
      : timer.status === 'paused'
        ? 'text-amber-100/90 text-3xl'
        : timer.status === 'expired'
          ? 'text-rose-200 text-3xl'
          : timer.status === 'none'
            ? 'text-white/30 text-3xl'
            : 'text-white text-3xl'

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-center transition-[box-shadow,transform,border-color] duration-300 ${containerClass} ${className}`}
      data-testid="draft-live-timer"
      role="timer"
      aria-live="polite"
      aria-label={timer.status === 'running' ? `Time remaining ${label}` : `Timer ${label}`}
    >
      <div className="flex items-center justify-center gap-1.5">
        {timer.status === 'running' && !critical && !urgent ? (
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400/60 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />
          </span>
        ) : null}
        <p className={`text-[11px] font-bold uppercase tracking-[0.2em] ${labelColor}`}>
          {labelText}
        </p>
      </div>
      <p className={`mt-1 font-mono font-bold tabular-nums tracking-tight ${digitClass}`}>
        {label}
      </p>
      {critical ? (
        <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-rose-200/90">
          Hurry!
        </p>
      ) : urgent ? (
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200/90">
          Time running out
        </p>
      ) : timer.status === 'paused' ? (
        <p className="mt-1 text-[11px] font-medium text-amber-200/60">Draft clock is paused</p>
      ) : timer.status === 'expired' ? (
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-rose-300/80">
          Pick overdue
        </p>
      ) : timer.timerEndAt && timer.status === 'running' ? (
        <p className="mt-1 text-[11px] text-white/35">Ends {new Date(timer.timerEndAt).toLocaleTimeString()}</p>
      ) : null}
    </div>
  )
}
