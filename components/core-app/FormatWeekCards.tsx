'use client'
import Link from 'next/link'
import type { WeekBoard } from '@/lib/core-app/weekBoard'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
export function FormatWeekCards({ weeks }: { weeks: NonNullable<WeekBoard['formatWeeks']> }) {
  const { language } = useOptionalLanguage(); const es = language === 'es'
  if (!weeks.length) return null
  return <section className="af-bd-sec"><h2 className="af-label">{es ? 'Los objetivos de tus ligas' : 'Your league goals'}</h2><ul className="af-bd-rows">{weeks.map(w => <li key={w.leagueId}><Link className="af-bd-row" href={w.href}><span className="af-bd-league"><strong>{w.leagueName}</strong><span className="af-bd-sub">{w.season} · {es ? 'Período' : 'Period'} {w.week}</span><span className="af-bd-sub">{es ? { categories: 'Protege tus categorías; revisa mínimos y límites.', roto: 'Revisa tu posición y los objetivos de categorías de la temporada.', 'season-points': 'Persigue tu objetivo de puntos de la temporada.', elimination: 'Revisa las reglas de supervivencia.', 'head-to-head': 'El calendario no identifica un rival. Revisa o sincroniza la liga.' }[w.format] : { categories: 'Protect your categories; check minimums and caps.', roto: 'Review your season category standings and targets.', 'season-points': 'Track your season points target.', elimination: 'Review survival rules.', 'head-to-head': 'The schedule does not identify an opponent. Review or sync the league.' }[w.format]}</span></span></Link></li>)}</ul></section>
}
