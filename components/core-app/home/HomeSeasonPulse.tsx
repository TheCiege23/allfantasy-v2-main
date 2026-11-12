'use client'

import Link from 'next/link'
import { useMessages } from '@/components/i18n/useMessages'
import type { PulseRow, SeasonPulse } from '@/lib/core-app/homeGuide'
import { homeGuideMessages } from '@/lib/core-app/messages/homeGuide'
import '@/components/core-app/home/af-home-guide.css'

/**
 * "How your season is going" — the question the home never answered (2026-11-12). It listed what was
 * broken in every league but never where you stood in them. Built from `buildSeasonPulse`
 * (lib/core-app/homeGuide.ts) over the same claimed-team standings the "since your last visit" brief
 * already reads, so it costs one set-based query for every league at once.
 */

function standingsHref(id: string): string {
  return `/core/standings?league=${encodeURIComponent(id)}`
}

function Rows({ title, rows, tone }: { title: string; rows: PulseRow[]; tone: 'good' | 'warn' }) {
  const g = useMessages(homeGuideMessages)
  if (rows.length === 0) return null
  return (
    <div className="af-pulse-list" data-tone={tone}>
      <p className="af-guide-label">{title}</p>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={standingsHref(row.id)}>
              <span className="af-pulse-rank">{g.pulseRank(row.rank, row.teams)}</span>
              <span className="af-pulse-name">{row.name}</span>
              <span className="af-pulse-rec">{row.record}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function HomeSeasonPulse({ pulse }: { pulse: SeasonPulse }) {
  const g = useMessages(homeGuideMessages)
  const record = pulse.ties > 0 ? `${pulse.wins}-${pulse.losses}-${pulse.ties}` : `${pulse.wins}-${pulse.losses}`
  return (
    <section className="af3a-card af-guide-card" aria-labelledby="af-pulse-title">
      <header className="af-guide-cardhead">
        <h2 id="af-pulse-title">{g.pulseTitle}</h2>
        <span>{g.pulseSub}</span>
      </header>
      {pulse.ranked === 0 ? (
        <p className="af-guide-empty">{g.pulseNone}</p>
      ) : (
        <>
          <ul className="af-guide-stats">
            <li data-tone="good">
              <b>{pulse.topHalf}</b>
              <span>{g.pulseTopHalf}</span>
            </li>
            <li data-tone="warn">
              <b>{pulse.bubble}</b>
              <span>{g.pulseBubble}</span>
            </li>
            <li>
              <b>{pulse.bottomHalf}</b>
              <span>{g.pulseBottomHalf}</span>
            </li>
            <li>
              <b>{pulse.firstPlace}</b>
              <span>{g.pulseFirst}</span>
            </li>
            <li>
              <b>{record}</b>
              <span>{g.pulseRecord}</span>
            </li>
          </ul>
          <div className="af-pulse-cols">
            <Rows title={g.pulseBest} rows={pulse.best} tone="good" />
            <Rows title={g.pulseWorst} rows={pulse.worst} tone="warn" />
          </div>
          {pulse.unranked > 0 ? <p className="af-guide-note">{g.pulseUnranked(pulse.unranked)}</p> : null}
        </>
      )}
      <p className="af-decision-why af-guide-why">
        <b>{g.why}</b> {g.pulseTeach}
      </p>
      <Link className="af-guide-more" href="/core/standings">
        {g.pulseStandings} →
      </Link>
    </section>
  )
}

export default HomeSeasonPulse
