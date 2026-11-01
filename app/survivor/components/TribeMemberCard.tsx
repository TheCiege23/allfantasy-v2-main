import clsx from 'clsx'
import { SurvivorStatusBadge, type SurvivorStatusBadgeVariant } from './SurvivorStatusBadge'
import { SurvivorAvatar, SurvivorOutChip, survivorAvatarStatus } from '@/components/survivor/weekly/SurvivorAvatar'

export function TribeMemberCard({
  name,
  teamName,
  weeklyScore,
  statusVariant,
  publicAdvantage,
  atRisk,
  avatarUrl,
  outWeek,
}: {
  name: string
  teamName?: string
  weeklyScore?: number
  statusVariant: SurvivorStatusBadgeVariant
  /** @deprecated The avatar ring now follows the weekly status (immune gold, out dim). */
  ringClass?: string
  publicAdvantage?: string | null
  atRisk?: boolean
  avatarUrl?: string | null
  /** Week the manager's torch went out; renders the struck-through name and "Out · Wk N". */
  outWeek?: number | null
}) {
  // Voted out, whether the manager now plays from Exile or sits on the jury: the torch is out.
  const out = statusVariant === 'eliminated' || statusVariant === 'exiled' || statusVariant === 'jury'
  const immune = statusVariant === 'immune'
  return (
    <div
      className={clsx(
        'survivor-panel rounded-xl p-3 transition-shadow',
        atRisk && 'ring-1 ring-red-500/25',
        immune && 'bg-amber-400/[0.07] ring-1 ring-amber-300/35',
      )}
      data-immune={immune}
      data-out={out}
    >
      <div className="flex items-start gap-3">
        <span className="shrink-0">
          <SurvivorAvatar name={name} size={48} imageUrl={avatarUrl ?? null} status={survivorAvatarStatus({ immune, out })} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={clsx('truncate text-[13px] font-semibold', out ? 'text-white/45 line-through' : 'text-white')}>{name}</p>
          {teamName ? (
            <p className="truncate text-[11px] text-[var(--survivor-text-dim)]">{teamName}</p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <SurvivorStatusBadge variant={statusVariant} />
            {out ? <SurvivorOutChip week={outWeek} /> : null}
            {publicAdvantage ? (
              <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-200">
                {publicAdvantage}
              </span>
            ) : null}
          </div>
        </div>
        <p className="font-mono text-lg font-semibold tabular-nums text-[var(--survivor-torch)]">
          {weeklyScore != null ? weeklyScore.toFixed(1) : '—'}
        </p>
      </div>
    </div>
  )
}
