import clsx from 'clsx'
import type { SurvivorSeasonTribe } from '@/lib/survivor/survivorUiTypes'
import { extractLeadingTribeIcon, stripLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'
import { tribeCrestAlt } from '@/lib/survivor/survivorTribeIdentity'

export function TribeCard({
  tribe,
  weeklyScore,
  status,
  memberCount,
}: {
  tribe: SurvivorSeasonTribe
  weeklyScore?: number
  status: 'immune' | 'tribal' | 'neutral'
  memberCount: number
}) {
  const accent = tribe.colorHex ?? '#22d3ee'
  const tribeIcon = tribe.emoji ?? extractLeadingTribeIcon(tribe.name)
  const tribeName = stripLeadingTribeIcon(tribe.name ?? 'Tribe')
  return (
    <article
      className="survivor-panel relative min-w-[220px] shrink-0 rounded-xl p-4 md:min-w-0"
      style={{
        boxShadow:
          status === 'immune'
            ? `0 0 0 1px rgba(0,212,170,0.35), 0 0 24px rgba(0,212,170,0.12)`
            : status === 'tribal'
              ? `0 0 0 1px rgba(255,68,68,0.45), 0 0 28px rgba(255,68,68,0.15)`
              : undefined,
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <div
          className={`flex shrink-0 items-center justify-center rounded-lg text-sm font-bold text-black/80 ${tribe.logoUrl ? 'h-16 w-16' : 'h-8 w-8'}`}
          style={{ backgroundColor: tribe.logoUrl ? 'transparent' : accent }}
        >
          {tribe.logoUrl ? <img src={tribe.logoUrl} alt={tribe.mascot ? tribeCrestAlt(tribeName || 'Tribe', tribe.mascot) : ''} width={56} height={56} className="h-14 w-14 max-w-none object-contain" /> : tribeIcon ?? tribeName.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-bold uppercase tracking-wider text-[var(--survivor-text-bright)]">
            {tribeName || 'Tribe'}
          </h3>
          <div className="h-1 w-full rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full" style={{ width: '100%', backgroundColor: accent }} />
          </div>
        </div>
      </div>
      <p className="font-mono text-2xl font-semibold tabular-nums text-white">
        {weeklyScore != null ? weeklyScore.toFixed(1) : '—'}
        <span className="ml-1 text-xs font-normal text-[var(--survivor-text-dim)]">pts</span>
      </p>
      <p className="mt-2 text-[11px] text-[var(--survivor-text-dim)]">{memberCount} members</p>
      <div className="mt-2">
        {status === 'immune' ? (
          <span className="text-[11px] font-bold uppercase tracking-wide text-cyan-300">🛡 Immune</span>
        ) : status === 'tribal' ? (
          <span className="tribal-dot-pulse text-[11px] font-bold uppercase tracking-wide text-red-400">
            🔥 Tribal tonight
          </span>
        ) : (
          <span className="text-[11px] text-white/35">—</span>
        )}
      </div>
    </article>
  )
}
