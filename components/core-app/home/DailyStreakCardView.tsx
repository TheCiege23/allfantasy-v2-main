'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { dailyStreakMessages } from '@/lib/core-app/messages/dailyStreak'
import type { StreakSummary } from '@/lib/core-app/dailyStreak'

/**
 * The daily check-in strip at the top of the /core home (founder, 2026-10-08).
 *
 * One compact row, not a card that pushes the decisions down: the flame and the count, the last
 * seven days as dots, the next milestone, and — beside it — today's glance (`children`, streamed in
 * separately so the strip never waits on the league reads). It celebrates once, on the visit that
 * extends the streak; every later load that day is quiet.
 */
type StreakMessages = typeof dailyStreakMessages.en

function headline(s: StreakSummary, m: StreakMessages): string {
  if (s.current === 0) return m.startStreak
  if (s.justExtended && s.current === 1) return m.dayOneStarted
  if (s.justExtended) return m.dayN(s.current)
  return m.streakOf(s.current)
}

function subline(s: StreakSummary, m: StreakMessages): string {
  if (s.reached != null) return m.milestone(s.reached)
  if (s.current > 0 && !s.checkedInToday) {
    return m.checkInToday
  }
  if (s.current === 0) return m.comeBackDaily
  if (s.next) {
    return m.toNextBadge(s.next.left, s.next.at)
  }
  return m.legend
}

export function DailyStreakCardView({ streak, children }: { streak: StreakSummary; children?: ReactNode }) {
  const m = useMessages(dailyStreakMessages)
  const atRisk = streak.current > 0 && !streak.checkedInToday

  return (
    <section
      className="af-core af-streak"
      aria-label={m.dailyStreak}
      data-celebrate={streak.justExtended ? 'true' : undefined}
      data-at-risk={atRisk ? 'true' : undefined}
    >
      <div className="af-streak-main">
        <span className="af-streak-flame" aria-hidden>
          🔥
          <span className="af-streak-count af-num">{streak.current}</span>
        </span>
        <div className="af-streak-text">
          <span className="af-streak-title">{headline(streak, m)}</span>
          <span className="af-streak-sub">{subline(streak, m)}</span>
        </div>
        <ol className="af-streak-week" aria-label={m.last7Days}>
          {streak.week.map((d) => (
            <li
              key={d.day}
              className="af-streak-day"
              data-checked={d.checked ? 'true' : 'false'}
              data-today={d.isToday ? 'true' : undefined}
              aria-label={`${d.day}${d.checked ? m.checkedIn : ''}`}
            >
              <span className="af-streak-dot" aria-hidden>
                {d.checked ? '✓' : ''}
              </span>
              <span className="af-streak-wd" aria-hidden>
                {m.weekday(d.weekday)}
              </span>
            </li>
          ))}
        </ol>
        {streak.best > 1 ? (
          <span className="af-streak-best af-num">
            {m.best} {streak.best}
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

function glanceText(item: StreakGlanceItem, m: StreakMessages): string {
  const n = item.count
  if (item.key === 'lineups') {
    if (n === 0) return m.lineupsSet
    return m.lineupsToFix(n)
  }
  if (item.key === 'injuries') {
    if (n === 0) return m.noInjuries
    return m.injuryFlags(n)
  }
  if (n === 0) return m.noTrades
  return m.newTrades(n)
}

/** Today's glance — three facts the home already holds, each one tap from where it is handled. */
export function StreakGlanceView({ items }: { items: StreakGlanceItem[] }) {
  const m = useMessages(dailyStreakMessages)
  if (items.length === 0) return null
  return (
    <ul className="af-streak-glance" aria-label={m.todayAtAGlance}>
      {items.map((item) => (
        <li key={item.key}>
          <Link className="af-streak-chip" href={item.href} data-tone={item.tone}>
            <span aria-hidden>{item.tone === 'ok' ? '✓' : '!'}</span>
            {glanceText(item, m)}
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default DailyStreakCardView
