import clsx from 'clsx'
import { SurvivorStatusBadge, type SurvivorStatusBadgeVariant } from './SurvivorStatusBadge'

export function TribeMemberCard({
  name,
  teamName,
  weeklyScore,
  statusVariant,
  ringClass,
  publicAdvantage,
  atRisk,
}: {
  name: string
  teamName?: string
  weeklyScore?: number
  statusVariant: SurvivorStatusBadgeVariant
  ringClass?: string
  publicAdvantage?: string | null
  atRisk?: boolean
}) {
  return (
    <div
      className={clsx(
        'survivor-panel rounded-xl p-3 transition-shadow',
        atRisk && 'ring-1 ring-red-500/25',
        statusVariant === 'immune' && 'ring-1 ring-cyan-400/30',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={clsx(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-sm font-bold text-white/80 ring-2',
            ringClass ?? 'ring-white/10',
          )}
        >
          {name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-white">{name}</p>
          {teamName ? (
            <p className="truncate text-[11px] text-[var(--survivor-text-dim)]">{teamName}</p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <SurvivorStatusBadge variant={statusVariant} />
            {publicAdvantage ? (
              <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-200">
                {publicAdvantage}
              </span>
            ) : null}
          </div>
        </div>
        <p className="font-mono text-lg font-semibold tabular-nums text-sky-200">
          {weeklyScore != null ? weeklyScore.toFixed(1) : '—'}
        </p>
      </div>
    </div>
  )
}
