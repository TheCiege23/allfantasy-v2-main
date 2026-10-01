'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { hapticOnce } from '@/lib/platform/haptics'
import { readAgo, type CareerWireData, type PlatformHealth, type WireLeague, type WireStatus } from '@/lib/core-app/careerWireModel'
import { askChimmyAboutCareer } from './CareerAskChimmy'

/**
 * Career Wire — every platform at a glance, this season's board, and what moved since your last
 * Career visit. Data from `lib/core-app/careerWire.ts`; the shell's own "Sync now" sits in the
 * topbar on this screen, so this card links to a league's Sync screen rather than adding a second
 * button that does the same thing.
 *
 * ⚠ `nowIso` COMES FROM THE SERVER. Ages are rendered from the server's clock so the first client
 * paint matches and hydration does not warn; a stale age on a long-open tab is the honest failure.
 */

const STATUS_TEXT: Record<WireStatus, string> = {
  ok: 'current',
  delayed: 'delayed',
  attention: 'needs attention',
  never: 'never read',
  paused: 'paused',
  gone: 'league removed',
  native: 'live on AllFantasy',
}

const MAX_BOARD_ROWS = 12

function syncHref(leagueId: string): string {
  return `/core/sync?league=${encodeURIComponent(leagueId)}`
}

function standingsHref(leagueId: string): string {
  return `/core/standings?league=${encodeURIComponent(leagueId)}`
}

function platformLine(p: PlatformHealth, now: Date): string {
  const n = `${p.leagues} ${p.leagues === 1 ? 'league' : 'leagues'}`
  if (p.native) return `${n} · live`
  if (p.status === 'paused') return `${n} · paused`
  if (p.status === 'never') return `${n} · not read yet`
  return `${n} · read ${readAgo(p.lastReadAt, now)}`
}

export function CareerWire({ data, nowIso }: { data: CareerWireData; nowIso: string }) {
  const now = new Date(nowIso)

  /*
   * Phase 6: one success haptic when the Wire opens on good news — a win or a climb since the last
   * Career visit. Once per window (`sinceAt`), so a refresh does not buzz again. Never for a loss:
   * a phone that celebrates a drop to #7 is worse than one that stays still.
   */
  const goodNews = data.changes.some(
    (c) => c.won > 0 || (c.rank != null && c.previousRank != null && c.rank < c.previousRank),
  )
  useEffect(() => {
    if (goodNews) hapticOnce(`career-wire:${data.sinceAt}`, 'success')
  }, [goodNews, data.sinceAt])

  if (data.leagues.length === 0) return null

  const firstProblem = (platform: string): WireLeague | undefined =>
    data.leagues.find((l) => l.platform === platform && (l.status === 'attention' || l.status === 'gone' || l.status === 'never'))

  const board = [...data.leagues]
    .filter((l) => l.status !== 'gone')
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.leagueName.localeCompare(b.leagueName))
    .slice(0, MAX_BOARD_ROWS)

  return (
    // The host is the container the two-pane layout queries (af-career-devices.css): it follows
    // the Wire's OWN width, which inside the /core shell is far narrower than the viewport.
    <div className="af-crw-host">
    <section className="af-crw" aria-label="Career Wire">
      <header className="af-crw-top">
        <p className="af-crl-head">
          Career Wire
          <span className="af-crl-sp" />
          <span className="af-crw-sub">across every platform</span>
        </p>
      </header>

      {/* ── 1. Is each platform current? ─────────────────────────────── */}
      <ul className="af-crw-plats" aria-label="Platform sync">
        {data.platforms.map((p) => {
          const problem = firstProblem(p.platform)
          const body = (
            <>
              <span className="af-crw-dot" data-status={p.status} aria-hidden />
              <span className="af-crw-plat">{p.label}</span>
              <span className="af-crw-platline">{platformLine(p, now)}</span>
              {p.needsAttention > 0 ? (
                <span className="af-crw-flag">
                  {p.needsAttention} {p.needsAttention === 1 ? 'needs' : 'need'} attention
                </span>
              ) : p.status === 'delayed' ? (
                <span className="af-crw-flag af-crw-flag--soft">delayed</span>
              ) : null}
            </>
          )
          return (
            <li key={p.platform} className="af-crw-platrow" title={`${p.label}: ${STATUS_TEXT[p.status]}`}>
              {problem ? (
                <Link className="af-crw-platlink" href={syncHref(problem.leagueId)}>
                  {body}
                </Link>
              ) : (
                <span className="af-crw-platlink">{body}</span>
              )}
            </li>
          )
        })}
      </ul>

      {/* ── 2. What moved since the last Career visit ────────────────── */}
      <div className="af-crw-block">
        <p className="af-crw-label">Since your last Career visit</p>
        {data.comparisonPending ? (
          <p className="af-crl-foot">
            This is your first visit we can compare from. Next time, wins, losses and standings moves across all your
            leagues show up here.
          </p>
        ) : data.changes.length === 0 ? (
          <p className="af-crl-foot">No results or standings moves since {readAgo(data.sinceAt, now)}.</p>
        ) : (
          <ul className="af-crl-list">
            {data.changes.map((c) => (
              <li key={c.leagueId} className="af-crl-row">
                <div className="af-crl-text">
                  <span className="af-crl-title">
                    <Link href={standingsHref(c.leagueId)} className="af-crw-link">
                      {c.leagueName}
                    </Link>
                    <span className="af-crl-plat">{c.platform}</span>
                  </span>
                  <span className="af-crl-detail">{changeLine(c)}</span>
                </div>
                <button
                  type="button"
                  className="af-crl-askbtn"
                  aria-label={`Ask Chimmy about ${c.leagueName}`}
                  title="Ask Chimmy"
                  onClick={() => askChimmyAboutCareer(c.ask, c.leagueId)}
                >
                  ✦
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── 3. This season, every league ─────────────────────────────── */}
      <div className="af-crw-block">
        <p className="af-crw-label">This season</p>
        <table className="af-crw-board">
          <thead>
            <tr>
              <th scope="col">League</th>
              <th scope="col">Record</th>
              <th scope="col">Rank</th>
              <th scope="col">Read</th>
            </tr>
          </thead>
          <tbody>
            {board.map((l) => (
              <tr key={l.leagueId}>
                <td>
                  <Link href={standingsHref(l.leagueId)} className="af-crw-link">
                    {l.leagueName}
                  </Link>
                  <span className="af-crl-plat">{l.platform}</span>
                </td>
                <td className="af-num">{l.record ?? '—'}</td>
                <td className="af-num">{l.rank != null ? `#${l.rank}` : '—'}</td>
                <td>
                  <span className="af-crw-dot" data-status={l.status} aria-hidden />
                  {l.status === 'native' ? 'live' : l.status === 'paused' ? 'paused' : readAgo(l.lastReadAt, now)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.leagues.length > board.length ? (
          <p className="af-crl-foot">
            Showing {board.length} of {data.leagues.length} leagues, best rank first.
          </p>
        ) : null}
        <p className="af-crl-foot">
          Times show when AllFantasy last read each league, not when the platform last changed it. Records count games
          already played; nothing here is added to your career totals until the season finishes.
        </p>
      </div>
    </section>
    </div>
  )
}

function changeLine(c: CareerWireData['changes'][number]): string {
  const parts: string[] = []
  if (c.won + c.lost + c.tied > 0) parts.push(`Went ${c.won}-${c.lost}${c.tied ? `-${c.tied}` : ''}`)
  parts.push(`now ${c.wins}-${c.losses}${c.ties ? `-${c.ties}` : ''}`)
  if (c.rank != null && c.previousRank != null && c.rank !== c.previousRank) {
    parts.push(`${c.rank < c.previousRank ? 'up' : 'down'} to #${c.rank} (was #${c.previousRank})`)
  } else if (c.rank != null) {
    parts.push(`#${c.rank}`)
  }
  return parts.join(', ')
}
