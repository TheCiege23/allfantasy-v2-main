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
    className: 'border-[rgba(240,163,94,0.3)] bg-[rgba(240,163,94,0.1)] text-[#f6d3ae]',
    label: '✓ SAFE',
  },
  vulnerable: {
    className: 'border-[rgba(224,86,59,0.4)] bg-[rgba(224,86,59,0.14)] text-[#f4a493]',
    label: '⚠ VULNERABLE',
  },
  immune: {
    className: 'border-[rgba(242,196,107,0.45)] bg-[rgba(242,196,107,0.12)] text-[#f2c46b]',
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
