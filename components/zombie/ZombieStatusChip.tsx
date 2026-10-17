import clsx from 'clsx'

export type ZombieChipStatus = 'survivor' | 'zombie' | 'whisperer' | 'revived'

/**
 * A team's zombie status as stored (`ZombieLeagueTeam.status`: Survivor | Zombie | Whisperer) mapped to the
 * art key. A revived team is stored as Survivor with `revivedAt` set, so "revived" is a flag, not a status.
 */
export function zombieChipStatus(status: string | null | undefined, revived = false): ZombieChipStatus {
  const s = String(status ?? '').toLowerCase()
  if (s.includes('whisperer')) return 'whisperer'
  if (s.includes('zombie')) return 'zombie'
  return revived ? 'revived' : 'survivor'
}

const LABEL: Record<ZombieChipStatus, string> = {
  survivor: 'Survivor',
  zombie: 'Zombie',
  whisperer: 'Whisperer',
  revived: 'Revived',
}

const TONE: Record<ZombieChipStatus, string> = {
  survivor: 'border-sky-400/35 bg-sky-950/40 text-sky-100',
  zombie: 'border-lime-400/40 bg-lime-950/40 text-lime-100',
  whisperer: 'border-violet-400/40 bg-violet-950/40 text-violet-100',
  revived: 'border-amber-400/40 bg-amber-950/40 text-amber-100',
}

/** Status art (`/zombie/art/status-*.svg`, readable at 28px) plus the word, so colour is never the only cue. */
export function ZombieStatusChip({
  status,
  size = 'sm',
  showLabel = true,
  className,
}: {
  status: ZombieChipStatus
  size?: 'sm' | 'md'
  showLabel?: boolean
  className?: string
}) {
  const px = size === 'md' ? 'h-8 w-8' : 'h-6 w-6'
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border pr-2.5 text-[11px] font-bold uppercase tracking-[0.12em]',
        showLabel ? 'pl-0.5' : 'px-0.5',
        TONE[status],
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- small local SVG */}
      <img src={`/zombie/art/status-${status}.svg`} alt={showLabel ? '' : LABEL[status]} className={clsx(px, 'shrink-0')} />
      {showLabel && <span>{LABEL[status]}</span>}
    </span>
  )
}
