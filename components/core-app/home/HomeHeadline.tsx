'use client'

import Link from 'next/link'
import { useMessages } from '@/components/i18n/useMessages'
import { homeGuideMessages } from '@/lib/core-app/messages/homeGuide'
import '@/components/core-app/home/af-home-guide.css'

/**
 * The first thing on the /core home (2026-11-12): what the page is, how many things need you, and the
 * same count broken down by kind — said ONCE. It replaced four separate counts of the same queue (the
 * streak card's chips, the queue's "6 OPEN", the nav badge's number and the Chimmy card's "6 things
 * need you today"), which disagreed with each other often enough that readers stopped trusting any.
 *
 * Every count comes from a read the home already makes (HomeCards.tsx); a read that failed drops its
 * chip rather than reporting zero, because "0 lineups to fix" about a read we never made is a lie.
 */

export type HeadlineChip = {
  key: 'lineups' | 'injuries' | 'trades' | 'run'
  count: number
  href: string
}

export function HomeHeadline({
  weekLabel,
  leagueCount,
  openCount,
  chips,
  streakDays,
  firstVisit,
}: {
  weekLabel: string | null
  leagueCount: number
  /** Open decisions, after the queue's injury fold — the number the list below actually shows. */
  openCount: number | null
  chips: HeadlineChip[]
  /** The daily check-in streak, when the streak section is on and the read succeeded. */
  streakDays: number | null
  /** Say what the page is in a full sentence (a reader with few visits), or in a short line. */
  firstVisit: boolean
}) {
  const g = useMessages(homeGuideMessages)
  const label: Record<HeadlineChip['key'], string> = {
    lineups: g.chipLineups,
    injuries: g.chipInjuries,
    trades: g.chipTrades,
    run: g.chipRun,
  }
  return (
    <section className="af-hg-head" aria-labelledby="af-hg-head-title">
      <div className="af-hg-head-top">
        <p className="af-hg-eyebrow">{g.eyebrow(weekLabel, leagueCount)}</p>
        {streakDays != null && streakDays > 0 ? (
          <span className="af-hg-streak" title={g.streak(streakDays)}>
            <span aria-hidden="true">●</span> {g.streak(streakDays)}
          </span>
        ) : null}
      </div>
      <h1 id="af-hg-head-title" className="af-hg-title">
        {openCount == null ? g.introShort : openCount > 0 ? g.needsYou(openCount) : g.allClear}
      </h1>
      <p className="af-hg-intro">{firstVisit ? g.intro : g.introShort}</p>
      {chips.length > 0 ? (
        <ul className="af-hg-chips">
          {chips.map((chip) => (
            <li key={chip.key}>
              <Link
                href={chip.href}
                className="af-hg-chip"
                data-tone={chip.count > 0 ? (chip.key === 'trades' ? 'info' : 'warn') : 'ok'}
              >
                <b>{chip.count}</b>
                <span>{label[chip.key]}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export default HomeHeadline
