'use client'

/**
 * A seat's Survivor tribe, as a small chip: the tribe's mark (or a colour dot) and its name in the
 * tribe colour. Used wherever the draft room names a manager once tribes are locked before the
 * draft (team strip, board headers, big screen).
 */
export type SurvivorTribeBadgeTribe = { name: string; colorHex: string | null; markUrl: string | null }

const FALLBACK = '#22d3ee'

function alpha(hex: string, suffix: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${suffix}` : hex
}

export function SurvivorTribeBadge({ tribe, className = '' }: { tribe: SurvivorTribeBadgeTribe; className?: string }) {
  const color = tribe.colorHex && /^#[0-9a-f]{6}$/i.test(tribe.colorHex) ? tribe.colorHex : FALLBACK
  return (
    <span
      data-testid="survivor-tribe-badge"
      title={`${tribe.name} tribe`}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-bold uppercase leading-none tracking-wide ${className}`}
      style={{ borderColor: alpha(color, '80'), color, backgroundColor: alpha(color, '1f') }}
    >
      {tribe.markUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tribe.markUrl} alt="" className="h-3.5 w-3.5 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      )}
      <span className="truncate">{tribe.name}</span>
    </span>
  )
}

/** The mark alone, for tight spots such as a 28px avatar: a colour-ringed dot over the corner. */
export function SurvivorTribeMark({ tribe, className = '' }: { tribe: SurvivorTribeBadgeTribe; className?: string }) {
  const color = tribe.colorHex && /^#[0-9a-f]{6}$/i.test(tribe.colorHex) ? tribe.colorHex : FALLBACK
  return (
    <span
      data-testid="survivor-tribe-mark"
      title={`${tribe.name} tribe`}
      className={`inline-flex h-3.5 w-3.5 items-center justify-center overflow-hidden rounded-full border bg-[#0b1428] ${className}`}
      style={{ borderColor: color }}
    >
      {tribe.markUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tribe.markUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      )}
    </span>
  )
}
