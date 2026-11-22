'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { messagesFor, defineMessages } from '@/lib/i18n/messages'
import type { OffseasonCalendarView } from '@/lib/dynasty-core/offseasonCalendarService'
import type { OffseasonStep } from '@/lib/dynasty-core/offseasonCalendar'

const messages = defineMessages({
  en: {
    title: (season: number): string => `Offseason calendar · ${season}`,
    about: (date: string): string => `About ${date}`,
    byAllFantasy: ' (AllFantasy does this)',
    done: ' ✓ done',
    note: 'Dates marked "about" are AllFantasy’s plan from your settings; change them on the dynasty settings page.',
  },
  es: {
    title: (season: number) => `Calendario hasta la temporada ${season}`,
    about: (date: string) => `Hacia el ${date}`,
    byAllFantasy: ' (lo hace AllFantasy)',
    done: ' ✓ hecho',
    note: 'Las fechas marcadas con «hacia» son el plan de AllFantasy según tus ajustes; cámbialas en los ajustes de dinastía.',
  },
})

/** A step's text in the reader's language; the server words each step in English and Spanish. */
const stepText = (s: OffseasonStep, language: string): string => ({ en: s.en, es: s.es } as Record<string, string>)[language] ?? s.en

/**
 * The dynasty offseason calendar on the Commissioner Hub (lib/dynasty-core/offseasonCalendar.ts): each
 * step from the champion to the next kickoff, its date where it has one, and whether AllFantasy takes it
 * by itself. Hidden outside the offseason.
 */
export function OffseasonCalendar({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const m = messagesFor(messages, language)
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
  const when = (at: string) => new Date(at).toLocaleDateString(language || 'en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
  return (
    <section id="ch-offseason-calendar" className="af-tw af-tw-panel" data-testid="offseason-calendar">
      <h2>{m.title(view.season)}</h2>
      <ol>
        {view.steps.map((s) => (
          <li key={s.key} data-testid={`offseason-step-${s.key}`} data-done={s.done ? 'true' : 'false'}>
            {s.at ? <strong>{s.estimated ? m.about(when(s.at)) : when(s.at)}</strong> : null}
            {s.at ? ' — ' : ''}
            {stepText(s, language)}
            {s.byAllFantasy && !s.done ? <em>{m.byAllFantasy}</em> : null}
            {s.done ? <em>{m.done}</em> : null}
          </li>
        ))}
      </ol>
      <p className="nls-muted">{m.note}</p>
    </section>
  )
}
