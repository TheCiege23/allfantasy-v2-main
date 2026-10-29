import { getScoringLabel, type ScoringLabel as ScoringLabelData } from '@/lib/league-labels/catalog'

export type LabelSize = 'sm' | 'md' | 'lg'

/** The small pill drawn in code: family gradient + plate code. For chips, tables, league cards. */
export function ScoringPill({ label, className = '' }: { label: ScoringLabelData; className?: string }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-white ${className}`}
      style={{ backgroundImage: `linear-gradient(135deg, ${label.colors[0]}, ${label.colors[1]})` }}
      data-testid={`scoring-pill-${label.id}`}
    >
      {label.code}
    </span>
  )
}

/**
 * A scoring option's label: plate + name + one-liner.
 * `sm` draws the pill in code; `md` / `lg` use the plate art. Custom always reads CUSTOM (its plate
 * and code say so whatever values the commissioner set). Renders nothing for an unknown id.
 */
export function ScoringLabel({
  id,
  size = 'md',
  showText = true,
  className = '',
}: {
  id: string | null | undefined
  size?: LabelSize
  /** false = plate only, for screens whose own (translated) copy already names the option. */
  showText?: boolean
  className?: string
}) {
  const label = getScoringLabel(id)
  if (!label) return null
  const alt = `${label.name} scoring: ${label.oneLine}`
  if (size === 'sm') {
    return (
      <span className={`inline-flex min-w-0 items-center gap-2 ${className}`} data-testid={`scoring-label-${label.id}`}>
        <ScoringPill label={label} />
        <span className="truncate text-sm font-semibold">{label.name}</span>
      </span>
    )
  }
  const width = size === 'lg' ? 280 : 140
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`} data-testid={`scoring-label-${label.id}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static vector plate, sized by width/height */}
      <img src={label.plate} alt={alt} width={width} height={width * 0.4} className="h-auto shrink-0" style={{ width, maxWidth: showText ? '45%' : '100%' }} />
      {showText ? <div className="min-w-0">
        <p className={`${size === 'lg' ? 'text-lg' : 'text-sm'} font-bold`}>{label.name}</p>
        <p className="text-xs opacity-75">{label.oneLine}</p>
        {size === 'lg' ? <p className="mt-1 text-xs opacity-60">Best for: {label.bestFor}</p> : null}
        {label.type === 'categories' ? (
          <p className="mt-1 text-[11px] opacity-70">{label.categories.join(' · ')}</p>
        ) : null}
      </div> : null}
    </div>
  )
}
