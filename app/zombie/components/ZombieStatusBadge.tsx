'use client'

import clsx from 'clsx'
import { ZOMBIE_STATUS_ICON } from '@/lib/zombie/iconSystem'

const LABEL: Record<string, string> = {
  survivor: 'SURVIVOR',
  whisperer: 'WHISPERER',
  zombie: 'ZOMBIE',
  revived_survivor: 'REVIVED',
  revived: 'REVIVED',
  eliminated: 'ELIMINATED',
}

const DANGER_LABEL: Record<string, string> = {
  stable: 'Stable',
  exposed: 'Exposed',
  critical: 'Critical',
  doomed: 'Doomed',
}

export function normalizeZombieStatus(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes('whisperer')) return 'whisperer'
  if (s.includes('zombie')) return 'zombie'
  if (s.includes('revived')) return 'revived_survivor'
  if (s.includes('eliminat') || s.includes('dead')) return 'eliminated'
  return 'survivor'
}

export function ZombieStatusBadge({
  status,
  compact = false,
  className,
  dangerLevel,
}: {
  status: string
  compact?: boolean
  className?: string
  dangerLevel?: 'stable' | 'exposed' | 'critical' | 'doomed' | null
}) {
  const key = normalizeZombieStatus(status)
  const icon = ZOMBIE_STATUS_ICON[key] ?? ZOMBIE_STATUS_ICON.survivor
  const label = LABEL[key] ?? 'SURVIVOR'

  const styles: Record<string, string> = {
    survivor:
      'border-[var(--zombie-green)]/50 bg-[var(--zombie-green)]/12 text-[var(--zombie-green)] shadow-[0_0_0_1px_rgba(34,197,94,0.12)]',
    whisperer:
      'animate-pulse border-[var(--zombie-crimson)]/60 bg-[var(--zombie-crimson)]/12 text-[var(--zombie-crimson)] shadow-[0_0_18px_rgba(220,38,38,0.16)]',
    zombie:
      'border-[var(--zombie-purple)]/50 bg-[var(--zombie-purple)]/12 text-[var(--zombie-purple)] shadow-[0_0_18px_rgba(124,58,237,0.12)]',
    revived_survivor:
      'border-[var(--zombie-gold)]/50 bg-[var(--zombie-gold)]/12 text-[var(--zombie-gold)] shadow-[0_0_18px_rgba(245,184,0,0.1)]',
    eliminated: 'border-[var(--zombie-gray)]/50 bg-white/[0.04] text-[var(--zombie-gray)]',
  }
  const dangerChip =
    dangerLevel && DANGER_LABEL[dangerLevel]
      ? {
          stable: 'bg-emerald-500/10 text-emerald-200',
          exposed: 'bg-amber-500/15 text-amber-200',
          critical: 'bg-red-500/20 text-red-100',
          doomed: 'animate-pulse bg-red-600/30 text-white',
        }[dangerLevel]
      : null

  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      <span
        className={clsx(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
          styles[key] ?? styles.survivor,
        )}
        aria-label={`Player status: ${label}`}
        title={`Status: ${label}`}
      >
        {!compact ? <span aria-hidden>{icon}</span> : null}
        {!compact ? label : icon}
      </span>
      {dangerChip ? (
        <span
          className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]', dangerChip)}
          title={`Danger level: ${DANGER_LABEL[dangerLevel!]}`}
        >
          {DANGER_LABEL[dangerLevel!]}
        </span>
      ) : null}
    </span>
  )
}

/** Chat-sized dot with tooltip label via title. */
export function ZombieStatusDot({ status, titleName }: { status: string; titleName: string }) {
  const key = normalizeZombieStatus(status)
  const colors: Record<string, string> = {
    survivor: 'bg-[var(--zombie-green)]',
    whisperer: 'bg-[var(--zombie-crimson)]',
    zombie: 'bg-[var(--zombie-purple)]',
    revived_survivor: 'bg-[var(--zombie-gold)]',
    eliminated: 'bg-[var(--zombie-gray)]',
  }
  const label = LABEL[key] ?? 'SURVIVOR'
  return (
    <span
      title={`${titleName}'s status: ${label}`}
      className={clsx('inline-block h-2 w-2 shrink-0 rounded-full ring-2 ring-white/10', colors[key] ?? colors.survivor)}
      aria-label={`${titleName}'s status: ${label}`}
    />
  )
}
