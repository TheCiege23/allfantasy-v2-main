'use client'

import { useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { homeLearnMessages } from '@/lib/core-app/messages/homeLearn'
import { homeGuideMessages } from '@/lib/core-app/messages/homeGuide'
import type { PlatformCalendarRow } from '@/lib/core-app/platformCalendar'
import '@/components/core-app/home/af-home-guide.css'

/**
 * "When things happen" (2026-11-12): the next kickoff, and when waivers run on each platform the
 * reader plays (lib/core-app/platformCalendar.ts). A platform whose waiver time is not stored says so.
 *
 * ⚠ TIMES ARE THE READER'S OWN, AND ONLY AFTER HYDRATION. A weekday and a clock time depend on the
 * reader's time zone, which the server does not know; the first paint shows the schedule's own zone
 * label ("Wednesday 00:00 Pacific", from the server), then the local time replaces it. The decision
 * queue's countdown block follows the same rule.
 */

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function localWhen(iso: string, locale: string, daily: boolean, dailyLabel: string): string | null {
  try {
    const d = new Date(iso)
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d)
    if (daily) return `${dailyLabel} ${time}`
    const day = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d)
    return `${day} ${time}`
  } catch {
    return null
  }
}

export type CalendarDisplayRow = PlatformCalendarRow & {
  /** "Sleeper", "ESPN" — the platform's display name, from the server. */
  label: string
  /** "Wednesday 00:00 Pacific" per waiver group — the server's paint before local time is known. */
  serverLabels: string[]
}

export function HomePlatformCalendar({
  rows,
  nextKickoffIso,
}: {
  rows: CalendarDisplayRow[]
  /** The next lineup lock's kickoff (the home summary's first lock), or null when none is scheduled. */
  nextKickoffIso: string | null
}) {
  const t = useMessages(homeLearnMessages)
  const g = useMessages(homeGuideMessages)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
  const kickoff = mounted && nextKickoffIso ? localWhen(nextKickoffIso, locale, false, t.calDaily) : null

  return (
    <section className="af3a-card af-hg-card" aria-labelledby="af-cal-title">
      <header className="af-hg-cardhead">
        <h2 id="af-cal-title">{t.calTitle}</h2>
        <span>{t.calSub}</span>
      </header>
      {nextKickoffIso ? (
        <div className="af-cal-kickoff">
          <p className="af-hg-label">{t.calNextKickoff}</p>
          <p className="af-cal-kickoff-when" suppressHydrationWarning>
            {kickoff ?? new Date(nextKickoffIso).toUTCString().slice(0, 22) + ' UTC'}
          </p>
          <p className="af-hg-note">{t.calLockNote}</p>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="af-hg-empty">{t.calNoLeagues}</p>
      ) : (
        <ul className="af-cal-rows">
          {rows.map((row) => (
            <li key={row.platform}>
              <span className="af-decision-plat af-cal-plat" data-platform={row.platform} aria-hidden="true">
                {row.label.slice(0, 2).toUpperCase()}
              </span>
              <div className="af-cal-main">
                <p className="af-cal-name">
                  {row.label} <span>· {t.calLeagues(row.leagues)}</span>
                </p>
                {row.waivers.length === 0 ? (
                  <p className="af-cal-unread">{t.calUnread(row.label)}</p>
                ) : (
                  <>
                    {row.waivers.map((w, i) => {
                      const when =
                        (mounted && w.nextRunIso
                          ? localWhen(w.nextRunIso, locale, w.schedule.dayOfWeek == null, t.calDaily)
                          : null) ?? row.serverLabels[i] ?? `${w.schedule.dayOfWeek == null ? t.calDaily : DAY_LONG[w.schedule.dayOfWeek]} ${w.schedule.time}`
                      return (
                        <p key={i} className="af-cal-run">
                          <b>{t.calWaivers}</b> {t.calRuns(when, w.leagues)}
                        </p>
                      )
                    })}
                    {row.unread > 0 ? <p className="af-cal-unread">{t.calSomeUnread(row.unread)}</p> : null}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="af-decision-why af-hg-why">
        <b>{g.why}</b> {t.calTeach}
      </p>
    </section>
  )
}

