'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Full-bleed cinematic backdrop for tournament commissioner / war-room surfaces. */
export function TournamentWarRoomAmbient() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[#02040c]" />
      <div className="absolute -left-1/4 top-0 h-[70vh] w-[70vw] rounded-full bg-cyan-500/[0.07] blur-[120px]" />
      <div className="absolute -right-1/4 bottom-0 h-[60vh] w-[60vw] rounded-full bg-violet-600/[0.06] blur-[100px]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(34,211,238,0.12),transparent)]" />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='none' stroke='%23ffffff' stroke-opacity='0.03'%3E%3Cpath d='M0 40h80M40 0v80'/%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />
    </div>
  )
}

export function WarRoomHeroCard({
  children,
  className,
  phaseAccent = 'cyan',
}: {
  children: ReactNode
  className?: string
  phaseAccent?: 'cyan' | 'amber' | 'violet' | 'emerald'
}) {
  const ring =
    phaseAccent === 'amber'
      ? 'shadow-[0_0_60px_-12px_rgba(245,158,11,0.25)]'
      : phaseAccent === 'violet'
        ? 'shadow-[0_0_60px_-12px_rgba(139,92,246,0.2)]'
        : phaseAccent === 'emerald'
          ? 'shadow-[0_0_60px_-12px_rgba(52,211,153,0.2)]'
          : 'shadow-[0_0_60px_-12px_rgba(34,211,238,0.22)]'
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/[0.1] bg-gradient-to-br from-white/[0.07] via-white/[0.02] to-transparent p-1 backdrop-blur-xl',
        ring,
        className,
      )}
    >
      <div className="rounded-[14px] bg-[#060d18]/80 px-4 py-5 sm:px-6 sm:py-6">{children}</div>
    </div>
  )
}

export function WarRoomStatOrb({
  label,
  value,
  hint,
  accent = 'cyan',
}: {
  label: string
  value: string
  hint: string
  accent?: 'cyan' | 'amber' | 'violet' | 'emerald'
}) {
  const glow =
    accent === 'amber'
      ? 'from-amber-500/20 border-amber-500/25'
      : accent === 'violet'
        ? 'from-violet-500/20 border-violet-500/25'
        : accent === 'emerald'
          ? 'from-emerald-500/20 border-emerald-500/25'
          : 'from-cyan-500/20 border-cyan-500/25'
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-gradient-to-br to-transparent px-4 py-3.5 transition-all duration-300',
        'border-white/[0.08] hover:border-white/[0.14] hover:shadow-[0_0_32px_-8px_rgba(34,211,238,0.15)]',
        glow,
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <p className="relative text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className="relative mt-1.5 font-mono text-xl font-bold tracking-tight text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.08)]">
        {value}
      </p>
      <p className="relative mt-1 text-[11px] leading-snug text-white/38">{hint}</p>
    </div>
  )
}

export function WarRoomPanel({
  title,
  subtitle,
  children,
  actions,
  className,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.05] to-white/[0.015] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md sm:p-6',
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-white/50">{subtitle}</p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function WarRoomTabButton({
  active,
  onClick,
  icon,
  label,
  testId,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-all duration-200',
        active
          ? 'bg-gradient-to-b from-cyan-500/25 to-cyan-500/10 text-cyan-50 shadow-[0_0_24px_-4px_rgba(34,211,238,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-cyan-400/40'
          : 'text-white/50 hover:bg-white/[0.06] hover:text-white/90',
      )}
    >
      <span className={cn('opacity-90', active && 'text-cyan-200')}>{icon}</span>
      {label}
    </button>
  )
}
