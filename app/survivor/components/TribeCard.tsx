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
  const accent = tribe.colorHex ?? '#f0a35e'
  const tribeIcon = tribe.emoji ?? extractLeadingTribeIcon(tribe.name)
  const tribeName = stripLeadingTribeIcon(tribe.name ?? 'Tribe')
  return (
    <article
      className="survivor-panel relative min-w-[220px] shrink-0 rounded-xl p-4 md:min-w-0"
      style={{
        boxShadow:
          status === 'immune'
            ? `0 0 0 1px rgba(242,196,107,0.45), 0 0 24px rgba(242,196,107,0.14)`
            : status === 'tribal'
              ? `0 0 0 1px rgba(224,86,59,0.5), 0 0 28px rgba(224,86,59,0.16)`
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
          <h3 className="sv-h truncate text-[13px] uppercase tracking-[0.12em]">
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
          <span className="sv-immune text-[11px] font-bold uppercase tracking-wide">🛡 Immune</span>
        ) : status === 'tribal' ? (
          <span className="tribal-dot-pulse text-[11px] font-bold uppercase tracking-wide text-[#f08a72]">
            🔥 Tribal tonight
          </span>
        ) : (
          <span className="text-[11px] text-white/35">—</span>
        )}
      </div>
    </article>
  )
}
