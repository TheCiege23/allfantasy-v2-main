'use client'

/**
 * The C2C campus lineup (lib/c2c/campusLineup.ts): which college players start on campus this week.
 * Their points are added to the team's pro score (lib/c2c/campusScoring.ts). One tap starts or sits a
 * player and saves; a player with no open seat he can fill cannot be started, and the save route
 * re-checks every change (lib/c2c/campusLineupCheck.ts).
 */
import { useMemo } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { campusToggles } from '@/lib/c2c/campusLineup'
import type { CampusLineupView } from '@/lib/c2c/campusLineupView'
import { campusCopy, campusLang } from '@/lib/i18n/c2c-campus-copy'

export function CampusLineupPanel({
  view,
  editable,
  saving,
  onChange,
  onAskChimmy,
}: {
  view: CampusLineupView
  editable: boolean
  saving: boolean
  onChange: (starterIds: string[]) => void
  onAskChimmy?: (prompt: string) => void
}) {
  const { language } = useLanguage()
  const lang = campusLang(language)
  const t = (key: Parameters<typeof campusCopy>[1], vars?: Record<string, string | number>) => campusCopy(lang, key, vars)
  const toggles = useMemo(() => campusToggles(view.seats, view.starterIds, view.players), [view])
  const byId = useMemo(() => new Map(toggles.map((x) => [x.playerId, x])), [toggles])
  const slots = view.seats.join(', ')

  const toggle = (id: string) => {
    if (!editable || saving) return
    const on = view.starterIds.includes(id)
    onChange(on ? view.starterIds.filter((x) => x !== id) : [...view.starterIds, id])
  }

  return (
    <section aria-labelledby="campus-lineup-title" data-testid="campus-lineup-panel">
      <div className="mb-2 flex items-center gap-2">
        <p id="campus-lineup-title" className="text-[11px] font-bold uppercase tracking-wide text-secondary">
          {t('title')}
        </p>
        <div className="h-px flex-1 bg-subtle" />
      </div>
      <div className="space-y-2 rounded-xl border border-subtle bg-surface-muted p-3">
        <p className="text-xs text-secondary">{t('intro')}</p>
        {view.seats.length === 0 ? (
          <p className="text-xs text-muted">{t('noSeats')}</p>
        ) : (
          <>
            <p className="text-xs font-semibold text-primary">
              {t('filled', { n: view.starterIds.length, total: view.seats.length })} · {t('slots', { slots })}
            </p>
            <p className="text-xs text-muted">
              {view.cfbWeeks.length ? t('weeks', { weeks: view.cfbWeeks.join(', '), nfl: view.nflWeek }) : t('noWeeks')}
            </p>
            {!editable ? <p className="text-xs text-muted">{t('locked')}</p> : null}
            {view.players.length === 0 ? (
              <p className="text-xs text-muted">{t('noPlayers')}</p>
            ) : (
              <ul className="space-y-1">
                {view.players.map((p) => {
                  const state = byId.get(p.id)
                  const on = state?.onCampus ?? false
                  const blocked = !on && !state?.canStart
                  const reason = blocked ? t('noSpot', { pos: p.position }) : undefined
                  return (
                    <li key={p.id} className="flex min-h-[44px] items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-primary">{p.name}</p>
                        <p className="text-xs text-muted">
                          {p.position}
                          {p.team ? ` · ${p.team}` : ''}
                          {on ? ` · ${t('onCampus')}` : ''}
                        </p>
                        {reason ? <p className="text-[11px] text-muted">{reason}</p> : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle(p.id)}
                        disabled={!editable || saving || blocked}
                        aria-pressed={on}
                        aria-label={`${on ? t('sit') : t('start')} ${p.name}`}
                        title={reason}
                        className={`min-h-[44px] min-w-[72px] rounded-lg border px-3 text-sm font-semibold disabled:opacity-40 ${
                          on ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' : 'border-subtle text-primary'
                        }`}
                      >
                        {on ? t('sit') : t('start')}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {onAskChimmy && view.players.length > 0 ? (
              <button
                type="button"
                onClick={() =>
                  onAskChimmy(
                    t('chimmyPrompt', {
                      slots,
                      players: view.players.map((p) => `${p.name} (${p.position})`).join(', '),
                    }),
                  )
                }
                className="min-h-[44px] w-full rounded-lg border border-cyan-500/30 px-3 text-sm font-semibold text-cyan-300"
              >
                ✦ {t('askChimmy')}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
