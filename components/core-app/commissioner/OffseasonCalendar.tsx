'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { OffseasonCalendarView } from '@/lib/dynasty-core/offseasonCalendarService'

/**
 * The dynasty offseason calendar on the Commissioner Hub (lib/dynasty-core/offseasonCalendar.ts): each
 * step from the champion to the next kickoff, its date where it has one, and whether AllFantasy takes it
 * by itself. Hidden outside the offseason.
 */
export function OffseasonCalendar({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t = (en: string, esText: string) => (es ? esText : en)
  const [view, setView] = useState<OffseasonCalendarView | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/offseason-calendar`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { calendar: OffseasonCalendarView | null } | null) => live && setView(body?.calendar ?? null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [leagueId])

  if (!view) return null
  const when = (at: string) =>
    new Date(at).toLocaleDateString(es ? 'es' : 'en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
  return (
    <section id="ch-offseason-calendar" className="af-tw af-tw-panel" data-testid="offseason-calendar">
      <h2>{t(`Offseason calendar · ${view.season}`, `Calendario hasta la temporada ${view.season}`)}</h2>
      <ol>
        {view.steps.map((s) => (
          <li key={s.key} data-testid={`offseason-step-${s.key}`} data-done={s.done ? 'true' : 'false'}>
            {s.at ? <strong>{s.estimated ? t(`About ${when(s.at)}`, `Hacia el ${when(s.at)}`) : when(s.at)}</strong> : null}
            {s.at ? ' — ' : ''}
            {es ? s.es : s.en}
            {s.byAllFantasy && !s.done ? <em>{t(' (AllFantasy does this)', ' (lo hace AllFantasy)')}</em> : null}
            {s.done ? <em>{t(' ✓ done', ' ✓ hecho')}</em> : null}
          </li>
        ))}
      </ol>
      <p className="nls-muted">
        {t(
          'Dates marked "about" are AllFantasy’s plan from your settings; change them on the dynasty settings page.',
          'Las fechas marcadas con «hacia» son el plan de AllFantasy según tus ajustes; cámbialas en los ajustes de dinastía.',
        )}
      </p>
    </section>
  )
}
