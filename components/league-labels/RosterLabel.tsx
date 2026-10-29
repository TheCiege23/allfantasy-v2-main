import { POSITION_COLORS, getRosterLabel } from '@/lib/league-labels/catalog'
import type { LabelSize } from './ScoringLabel'

export function PositionChip({ position, count = 1 }: { position: string; count?: number }) {
  const c = POSITION_COLORS[position] ?? { fill: '#1d2130', text: '#ffffff' }
  return (
    <span
      className="inline-flex min-h-7 items-center rounded-md px-2 py-0.5 text-[11px] font-black"
      style={{ backgroundColor: c.fill, color: c.text }}
    >
      {position}
      {count !== 1 ? ` ×${count}` : ''}
    </span>
  )
}

/**
 * A roster option's label. Shows the league's REAL bench and IR/IL counts when they are passed:
 * live templates do not always match the handoff's counts, and the strip art bakes the counts in,
 * so the art is used only when they agree (`lg`); otherwise the chips are drawn in code.
 */
export function RosterLabel({
  id,
  size = 'md',
  bench,
  injured,
  showText = true,
  className = '',
}: {
  id: string | null | undefined
  size?: LabelSize
  bench?: number
  injured?: number
  /** false = chips only (position codes read the same in every language). */
  showText?: boolean
  className?: string
}) {
  const label = getRosterLabel(id)
  if (!label) return null
  const bn = bench ?? label.bench
  const inj = injured ?? label.injured
  const exact = bn === label.bench && inj === label.injured
  const injuredCode = label.sport === 'NBA' ? 'IL' : 'IR'
  const summary = `${label.name} roster · ${label.starters.length} start · ${label.starters.length + bn} slots`
  if (size === 'sm') {
    return <span className={`text-sm font-semibold ${className}`} data-testid={`roster-label-${label.id}`}>{summary}</span>
  }
  return (
    <div className={`min-w-0 space-y-2 ${className}`} data-testid={`roster-label-${label.id}`}>
      {showText ? <p className="text-sm font-bold">{summary}</p> : null}
      {size === 'lg' && exact ? (
        // eslint-disable-next-line @next/next/no-img-element -- static vector strip
        <img src={label.strip} alt={`${label.name} roster: ${label.starters.join(', ')}, bench ×${bn}, ${injuredCode} ×${inj}`} className="h-auto w-full max-w-xl" />
      ) : (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label={showText ? `${label.name} roster positions` : label.starters.join(" ")}>
          {label.starters.map((p, i) => <span role="listitem" key={i}><PositionChip position={p} /></span>)}
          <span role="listitem"><PositionChip position="BN" count={bn} /></span>
          <span role="listitem"><PositionChip position={injuredCode} count={inj} /></span>
        </div>
      )}
      {size === 'lg' && showText ? <p className="text-xs opacity-60">Best for: {label.bestFor}</p> : null}
    </div>
  )
}
