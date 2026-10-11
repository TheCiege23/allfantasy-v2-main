'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { GlanceRow, LeaguesAtAGlance } from '@/lib/live/leaguesAtAGlance'

/** How many leagues the strip names before "Show all". */
const ATTENTION_SHOWN = 4

/**
 * Your matchups across every league, at the top of the cross-league live screen.
 *
 * The slate below answers "what is happening in the games"; this answers the question people open the
 * page with — "am I winning?" — which until now lived only in the desktop league rail, and not at all
 * on a phone. Each row opens that league's own live view.
 */
export function LiveLeaguesGlance({
  glance,
  sportLabel,
}: {
  glance: LeaguesAtAGlance | null
  sportLabel: string
}) {
  const [showAll, setShowAll] = useState(false)
  if (!glance) return null
  const { counts, attention, rows } = glance
  const shown = showAll ? rows : attention.slice(0, ATTENTION_SHOWN)
  const hidden = rows.length - shown.length

  return (
    <section className="af-live-glance" aria-label="Your matchups this week">
      <h2 className="af-label af-live-glance-head">
        {sportLabel} · your matchups · {rows.length} {rows.length === 1 ? 'league' : 'leagues'}
      </h2>
      <p className="af-live-glance-counts af-num">
        <Count n={counts.ahead} label="ahead" tone="good" />
        <Count n={counts.behind} label="behind" tone="bad" />
        {counts.level > 0 ? <Count n={counts.level} label="level" /> : null}
        <span title="Within 10% of the score or 5 points, or two places or fewer above an elimination cut.">
          <Count n={counts.close} label="close" tone="warn" />
        </span>
        {counts.pending > 0 ? <Count n={counts.pending} label="not started" /> : null}
      </p>

      {shown.length > 0 ? (
        <ul className="af-live-glance-list">
          {shown.map((row) => (
            <GlanceItem key={row.leagueId} row={row} />
          ))}
        </ul>
      ) : (
        <p className="af-live-glance-calm">Nothing close and nothing behind right now.</p>
      )}

      {hidden > 0 || showAll ? (
        <button
          type="button"
          className="af-live-glance-more"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show only the ones to watch' : `Show all ${rows.length} leagues`}
        </button>
      ) : null}
    </section>
  )
}

function Count({ n, label, tone }: { n: number; label: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <span className="af-live-glance-count" data-tone={n > 0 ? tone : undefined}>
      <b>{n}</b> {label}
    </span>
  )
}

function GlanceItem({ row }: { row: GlanceRow }) {
  const tone =
    row.status === 'block' || row.status === 'behind'
      ? 'bad'
      : row.close
        ? 'warn'
        : row.status === 'ahead' || row.status === 'clear'
          ? 'good'
          : undefined
  return (
    <li className="af-live-glance-row" data-tone={tone}>
      <Link href={`/core/live?league=${encodeURIComponent(row.leagueId)}`} className="af-live-glance-link">
        <span className="af-live-glance-name">{row.leagueName}</span>
        <span className="af-live-glance-line af-num">{row.line}</span>
      </Link>
    </li>
  )
}
