import clsx from 'clsx'

export type SurvivorStatusBadgeVariant =
  | 'safe'
  | 'vulnerable'
  | 'immune'
  | 'exiled'
  | 'jury'
  | 'finalist'
  | 'eliminated'

const STYLES: Record<
  SurvivorStatusBadgeVariant,
  { className: string; label: string }
> = {
  safe: {
    className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
    label: '✓ SAFE',
  },
  vulnerable: {
    className: 'border-red-500/30 bg-red-500/15 text-red-300',
    label: '⚠ VULNERABLE',
  },
  immune: {
    className: 'border-cyan-500/30 bg-cyan-500/15 text-cyan-200',
    label: '🛡 IMMUNE',
  },
  exiled: {
    className: 'border-violet-500/30 bg-violet-500/15 text-violet-200',
    label: '🏚 EXILE',
  },
  jury: {
    className: 'border-amber-500/30 bg-amber-500/15 text-amber-200',
    label: '⚖️ JURY',
  },
  finalist: {
    className: 'border-amber-400/40 bg-amber-500/10 text-amber-100',
    label: '🏆 FINALIST',
  },
  eliminated: {
    className: 'border-white/15 bg-white/[0.06] text-white/45',
    label: '✗ ELIMINATED',
  },
}

export function SurvivorStatusBadge({
  variant,
  className,
}: {
  variant: SurvivorStatusBadgeVariant
  className?: string
}) {
  const s = STYLES[variant]
  return (
    <span
      role="status"
      className={clsx(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider',
        s.className,
        className,
      )}
    >
      {s.label}
    </span>
  )
}
