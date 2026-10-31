'use client'

/**
 * NHL dynasty: the free Fantrax prospects in the War Room's waiver result, listed AFTER the
 * recommended adds and never ranked (lib/dynasty-war-room/dynastyWaiverEngine.ts `unrankedProspects`).
 * Same "Prospect" badge and "Unsigned" label as the draft board and the free-agent list (#3051, #3063).
 * Renders nothing when the league has no prospects to show, so every other sport is unchanged.
 */
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { DynastyWaiverProspect } from '@/lib/dynasty-war-room/dynastyWaiverEngine'

export function DynastyProspectFreeAgents({
  prospects,
  list,
}: {
  prospects: readonly DynastyWaiverProspect[] | undefined
  list: { total: number; listed: number } | undefined
}) {
  const { t, tInterpolate } = useOptionalLanguage()
  if (!prospects || prospects.length === 0) return null
  return (
    <div className="mt-2 border-t border-white/[0.06] pt-2" data-testid="dynasty-war-room-prospects">
      <p className="mb-1 font-semibold text-white/80">{t('dynastyWarRoom.prospects.title')}</p>
      <p className="mb-1 text-[11px] text-white/45" data-testid="dynasty-war-room-prospects-note">
        {t('dynastyWarRoom.prospects.note')}
      </p>
      <ul className="space-y-0.5">
        {prospects.map((p) => (
          <li key={p.playerId} className="flex flex-wrap items-center gap-1.5 text-[11px] text-white/70">
            <span>
              {p.playerName} ({p.position})
            </span>
            <span
              className="rounded-full border border-white/[0.1] bg-white/[0.04] px-1.5 py-px text-[11px] text-white/55"
              data-testid={p.team ? undefined : `dynasty-war-room-prospect-unsigned-${p.playerId}`}
            >
              {p.team ?? t('draftRoom.pool.prospectUnsigned')}
            </span>
            <span
              className="rounded border border-sky-300/35 bg-sky-500/12 px-1 py-px text-[11px] font-semibold uppercase tracking-[0.06em] text-sky-100"
              title={t('draftRoom.pool.prospectTooltip')}
              data-testid={`dynasty-war-room-prospect-badge-${p.playerId}`}
            >
              {t('draftRoom.pool.prospectBadge')}
            </span>
          </li>
        ))}
      </ul>
      {list && list.total > list.listed ? (
        <p className="mt-1 text-[11px] text-white/45" data-testid="dynasty-war-room-prospects-hint">
          {tInterpolate('dynastyWarRoom.prospects.listHint', { listed: list.listed, total: list.total })}
        </p>
      ) : null}
    </div>
  )
}
