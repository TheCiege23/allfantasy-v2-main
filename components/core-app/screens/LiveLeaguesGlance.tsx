'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { GlanceRow, LeaguesAtAGlance } from '@/lib/live/leaguesAtAGlance'

/** How many leagues the strip names before "Show all". */
const ATTENTION_SHOWN = 4

/** The viewer's last open/closed choice, on this device. A convenience: unreadable storage is "no choice". */
const OPEN_KEY = 'af-live-glance-open'
/** Where the live grid goes single-column — the strip starts closed below this. */
const PHONE_QUERY = '(max-width: 1080px)'

function readChoice(): boolean | null {
  try {
    const v = window.localStorage.getItem(OPEN_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}
function saveChoice(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    /* private mode / blocked storage: the choice simply is not remembered */
  }
}

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
  /*
   * ⚠ COLLAPSIBLE, AND CLOSED ON A PHONE BY DEFAULT (2026-10-12). Open, the league list put the first
   * game card ~1.6 screens down at 390px. Closed, the counts — the answer to "am I winning" — still show.
   *
   * `null` means "no choice yet": CSS decides (closed ≤1080px, open above), so a phone never paints the
   * list and then hides it. Once the viewer toggles, their choice wins at every width and is remembered.
   * `wide` only keeps `aria-expanded` truthful for the CSS default; it is learned after mount.
   */
  const [open, setOpen] = useState<boolean | null>(null)
  const [wide, setWide] = useState(true)
  useEffect(() => {
    setOpen(readChoice())
    const mq = window.matchMedia?.(PHONE_QUERY)
    if (!mq) return
    const sync = () => setWide(!mq.matches)
    sync()
    mq.addEventListener?.('change', sync)
    return () => mq.removeEventListener?.('change', sync)
  }, [])
  if (!glance) return null
  const { counts, attention, rows } = glance
  const shown = showAll ? rows : attention.slice(0, ATTENTION_SHOWN)
  const hidden = rows.length - shown.length

  const expanded = open ?? wide
  const bodyId = 'af-live-glance-body'
  const toggle = () => {
    const next = !expanded
    setOpen(next)
    saveChoice(next)
  }

  return (
    <section
      className="af-live-glance"
      aria-label="Your matchups this week"
      data-open={open == null ? 'auto' : open ? 'true' : 'false'}
    >
      <h2 className="af-live-glance-h">
      <button
        type="button"
        className="af-live-glance-toggle"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={toggle}
      >
        <span className="af-label af-live-glance-head">
          {sportLabel} · your matchups · {rows.length} {rows.length === 1 ? 'league' : 'leagues'}
        </span>
        <span className="af-live-glance-chev" aria-hidden />
      </button>
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

      <div className="af-live-glance-body" id={bodyId}>
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
      </div>
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
