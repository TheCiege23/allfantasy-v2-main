'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { StreakSummary } from '@/lib/core-app/dailyStreak'

/**
 * The daily check-in strip at the top of the /core home (founder, 2026-10-08).
 *
 * One compact row, not a card that pushes the decisions down: the flame and the count, the last
 * seven days as dots, the next milestone, and — beside it — today's glance (`children`, streamed in
 * separately so the strip never waits on the league reads). It celebrates once, on the visit that
 * extends the streak; every later load that day is quiet.
 */
const WEEKDAY = {
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  es: ['D', 'L', 'M', 'X', 'J', 'V', 'S'],
}

function headline(s: StreakSummary, es: boolean): string {
  if (s.current === 0) return es ? 'Empieza una racha' : 'Start a streak'
  if (s.justExtended && s.current === 1) return es ? 'Día 1: racha iniciada' : 'Day 1 — streak started'
  if (s.justExtended) return es ? `¡Día ${s.current}!` : `Day ${s.current}!`
  return es ? `Racha de ${s.current} día${s.current === 1 ? '' : 's'}` : `${s.current}-day streak`
}

function subline(s: StreakSummary, es: boolean): string {
  if (s.reached != null) return es ? `🏅 ¡Logro de ${s.reached} días!` : `🏅 ${s.reached}-day milestone!`
  if (s.current > 0 && !s.checkedInToday) {
    return es ? 'Entra hoy para no perderla' : 'Check in today to keep it alive'
  }
  if (s.current === 0) return es ? 'Vuelve cada día para sumar días' : 'Open AllFantasy each day to build it'
  if (s.next) {
    return es
      ? `${s.next.left} día${s.next.left === 1 ? '' : 's'} para el logro de ${s.next.at}`
      : `${s.next.left} day${s.next.left === 1 ? '' : 's'} to your ${s.next.at}-day badge`
  }
  return es ? 'Leyenda absoluta' : 'Legend status'
}

export function DailyStreakCardView({ streak, children }: { streak: StreakSummary; children?: ReactNode }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const days = es ? WEEKDAY.es : WEEKDAY.en
  const atRisk = streak.current > 0 && !streak.checkedInToday

  return (
    <section
      className="af-core af-streak"
      aria-label={es ? 'Racha diaria' : 'Daily streak'}
      data-celebrate={streak.justExtended ? 'true' : undefined}
      data-at-risk={atRisk ? 'true' : undefined}
    >
      <div className="af-streak-main">
        <span className="af-streak-flame" aria-hidden>
          🔥
          <span className="af-streak-count af-num">{streak.current}</span>
        </span>
        <div className="af-streak-text">
          <span className="af-streak-title">{headline(streak, es)}</span>
          <span className="af-streak-sub">{subline(streak, es)}</span>
        </div>
        <ol className="af-streak-week" aria-label={es ? 'Últimos 7 días' : 'Last 7 days'}>
          {streak.week.map((d) => (
            <li
              key={d.day}
              className="af-streak-day"
              data-checked={d.checked ? 'true' : 'false'}
              data-today={d.isToday ? 'true' : undefined}
              aria-label={`${d.day}${d.checked ? (es ? ', registrado' : ', checked in') : ''}`}
            >
              <span className="af-streak-dot" aria-hidden>
                {d.checked ? '✓' : ''}
              </span>
              <span className="af-streak-wd" aria-hidden>
                {days[d.weekday]}
              </span>
            </li>
          ))}
        </ol>
        {streak.best > 1 ? (
          <span className="af-streak-best af-num">
            {es ? 'Mejor' : 'Best'} {streak.best}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  )
}

export type StreakGlanceItem = {
  key: 'lineups' | 'injuries' | 'trades'
  tone: 'ok' | 'warn'
  /** English; the view below says it in the reader's language from `count`. */
  count: number
  href: string
}

function glanceText(item: StreakGlanceItem, es: boolean): string {
  const n = item.count
  if (item.key === 'lineups') {
    if (n === 0) return es ? 'Alineaciones listas' : 'Lineups set'
    return es ? `${n} alineación${n === 1 ? '' : 'es'} por revisar` : `${n} lineup${n === 1 ? '' : 's'} to fix`
  }
  if (item.key === 'injuries') {
    if (n === 0) return es ? 'Sin alertas de lesión' : 'No injury flags'
    return es ? `${n} alerta${n === 1 ? '' : 's'} de lesión` : `${n} injury flag${n === 1 ? '' : 's'}`
  }
  if (n === 0) return es ? 'Sin intercambios hoy' : 'No new trades'
  return es ? `${n} intercambio${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'}` : `${n} new trade${n === 1 ? '' : 's'}`
}

/** Today's glance — three facts the home already holds, each one tap from where it is handled. */
export function StreakGlanceView({ items }: { items: StreakGlanceItem[] }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  if (items.length === 0) return null
  return (
    <ul className="af-streak-glance" aria-label={es ? 'Hoy de un vistazo' : 'Today at a glance'}>
      {items.map((item) => (
        <li key={item.key}>
          <Link className="af-streak-chip" href={item.href} data-tone={item.tone}>
            <span aria-hidden>{item.tone === 'ok' ? '✓' : '!'}</span>
            {glanceText(item, es)}
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default DailyStreakCardView
