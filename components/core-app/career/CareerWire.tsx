'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { hapticOnce } from '@/lib/platform/haptics'
import { buildCareerFeed, type CareerFeedItem } from '@/lib/core-app/careerFeed'
import type { LegacyStake } from '@/lib/core-app/careerMilestones'
import { readAgo, type CareerWireData, type PlatformHealth, type WireLeague, type WireStatus } from '@/lib/core-app/careerWireModel'
import { askChimmyAboutCareer } from './CareerAskChimmy'
import { PushOptInPrompt } from '@/components/notifications/PushOptInPrompt'

/**
 * Career Wire — what moved since your last Career visit and what to do about it, every platform at
 * a glance, and this season's board. Data from `lib/core-app/careerWire.ts`; the feed's items come
 * from `lib/core-app/careerFeed.ts`. The shell's own "Sync now" sits in the topbar on this screen,
 * so this card links to a league's Sync screen rather than adding a second button that does the
 * same thing.
 *
 * The feed LEADS: it is the reason to open the tab. Each item carries one action into the screen
 * that acts on it (Sync, My Team, Matchup) and, where Chimmy has something to add, an unsent
 * question for it.
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

export function CareerWire({
  data,
  nowIso,
  stakes = [],
}: {
  data: CareerWireData
  nowIso: string
  /** The Career screen's live stakes; empty under a filter, which is when `buildLegacyStakes` returns none. */
  stakes?: readonly LegacyStake[]
}) {
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

      {/* ── 1. Since your last visit — what to do about it ──────────── */}
      <CareerFeed data={data} stakes={stakes} now={now} />

      {/* ── 2. Is each platform current? ─────────────────────────────── */}
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

/** Five fit a phone screen above the fold; the rest fold behind one tap rather than a scroll. */
const FEED_VISIBLE = 5

function CareerFeed({ data, stakes, now }: { data: CareerWireData; stakes: readonly LegacyStake[]; now: Date }) {
  const items = buildCareerFeed({ wire: data, stakes, now })
  const shown = items.slice(0, FEED_VISIBLE)
  const rest = items.slice(FEED_VISIBLE)
  const resultCount = items.filter((i) => i.kind === 'result').length

  return (
    <div className="af-crw-block af-crf">
      <p className="af-crw-label">
        Since your last visit
        {!data.comparisonPending ? <span className="af-crf-since"> · {readAgo(data.sinceAt, now)}</span> : null}
      </p>
      {items.length > 0 ? (
        <>
          <ul className="af-crf-list">
            {shown.map((item) => (
              <FeedRow key={item.key} item={item} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="af-crf-more">
              <summary>
                {rest.length} more {rest.length === 1 ? 'item' : 'items'}
              </summary>
              <ul className="af-crf-list">
                {rest.map((item) => (
                  <FeedRow key={item.key} item={item} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
      {data.comparisonPending ? (
        <p className="af-crl-foot">
          This is your first visit we can compare from. Next time, wins, losses and standings moves across all your
          leagues show up here, each with the screen to act on it.
        </p>
      ) : resultCount === 0 ? (
        <p className="af-crl-foot">No results or standings moves since {readAgo(data.sinceAt, now)}.</p>
      ) : null}
      {/*
        The phone-alerts ask, right where "what changed" is on screen. It renders nothing for anyone
        who has already answered, snoozed it, can't receive web push, or is in the iOS app.
      */}
      <PushOptInPrompt variant="career" className="af-crf-pushask" />
    </div>
  )
}

function FeedRow({ item }: { item: CareerFeedItem }) {
  return (
    <li className="af-crf-row" data-tone={item.tone}>
      <span className="af-crf-dot" aria-hidden />
      <div className="af-crl-text">
        <span className="af-crl-title">
          {item.title}
          <span className="af-crl-plat">{item.platform}</span>
        </span>
        <span className="af-crl-detail">
          <Link href={standingsHref(item.leagueId)} className="af-crw-link af-crf-league">
            {item.leagueName}
          </Link>
          {' · '}
          {item.detail}
        </span>
      </div>
      <div className="af-crf-acts">
        <Link className="af-crf-go" href={item.action.href}>
          {item.action.label}
        </Link>
        {item.ask ? (
          <button
            type="button"
            className="af-crl-askbtn"
            aria-label={`Ask Chimmy about ${item.leagueName}`}
            title="Ask Chimmy"
            onClick={() => askChimmyAboutCareer(item.ask as string, item.leagueId)}
          >
            ✦
          </button>
        ) : null}
      </div>
    </li>
  )
}
