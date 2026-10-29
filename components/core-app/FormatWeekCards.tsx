'use client'
import Link from 'next/link'
import type { WeekBoard } from '@/lib/core-app/weekBoard'
import { useMessages } from '@/components/i18n/useMessages'
import { coreWidgetsMessages } from '@/lib/core-app/messages/coreWidgets'
export function FormatWeekCards({ weeks }: { weeks: NonNullable<WeekBoard['formatWeeks']> }) {
  const m = useMessages(coreWidgetsMessages)
  if (!weeks.length) return null
  return <section className="af-bd-sec"><h2 className="af-label">{m.formatWeekTitle}</h2><ul className="af-bd-rows">{weeks.map(w => <li key={w.leagueId}><Link className="af-bd-row" href={w.href}><span className="af-bd-league"><strong>{w.leagueName}</strong><span className="af-bd-sub">{w.season} · {m.formatWeekPeriod} {w.week}</span><span className="af-bd-sub">{{ categories: m.formatWeekGoalCategories, roto: m.formatWeekGoalRoto, 'season-points': m.formatWeekGoalSeasonPoints, elimination: m.formatWeekGoalElimination, 'head-to-head': m.formatWeekGoalHeadToHead }[w.format]}</span></span></Link></li>)}</ul></section>
}
