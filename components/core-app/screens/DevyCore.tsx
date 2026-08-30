'use client'

import { useMemo, useState } from 'react'
/*
 * ⚠ THE CLASS ON THE ROOT IS HALF THE FIX; THIS IMPORT IS THE OTHER HALF.
 * `.af-core` selects nothing unless af-core.css is in the bundle. Without it every
 * `var(--token)` in af-devy.css resolves to nothing: cards lose their background and
 * border, and `--accent` silently falls through to the GLOBAL #7c3aed purple that
 * app/globals.css sets at :root, instead of the handoff's #22d3ee cyan.
 *
 * Measured on the preview before this line existed — `getComputedStyle` reported
 * `--accent: #7c3aed`, `--surface: ''`, card background transparent and border 0px.
 * Nothing threw and nothing 404'd; the screen just painted wrong, which is how
 * DefenseHubClient's own note says this break survives review.
 *
 * A JS import rather than an `@import` inside af-devy.css: per app/layout.tsx an
 * @import in a route-bundled CSS file is dropped once another af-*.css is
 * concatenated ahead of it.
 */
import '../af-core.css'
import '../af-devy.css'

/**
 * Devy Core — the cross-league college-prospect hub.
 *
 * Built from `design-refs/devy-handoff/AF Devy Core.dc.html`. The handoff is a design
 * REFERENCE, not source: it says so itself, and the task is to rebuild it with this
 * codebase's own tokens and components rather than paste its markup.
 *
 * ⚠ THE MOCK'S STATE SWITCHER IS NOT HERE, DELIBERATELY. The design carries a
 * Populated / Empty / Loading pill row top-right, and its README says in as many words
 * that it is a QA control which must not ship. Shipping it would put a button on a
 * production screen that lies to the user about what the server returned. `viewState`
 * is a prop, driven by real fetch status; the preview route is where the three states
 * are exercised side by side.
 *
 * ⚠ AND THE THREE STATES REPLACE THE WHOLE STACK, not each section. That is the
 * handoff's rule and it matters: per-section gating would render a populated watchlist
 * above an empty prospect list and imply the pool is genuinely empty rather than
 * unloaded.
 */

export type DevyViewState = 'loading' | 'empty' | 'populated'
export type DevyPosition = 'QB' | 'RB' | 'WR' | 'TE'
export type DevyTrend = 'up' | 'down' | 'flat'

export interface DevyProspectStat {
  label: string
  value: string
}

export interface DevyProspect {
  id: string
  rank: number
  name: string
  position: string
  school: string
  classYear: string | null
  /** 0–100 scouting projection. Null when nothing has scored this player yet. */
  grade: number | null
  trend: DevyTrend
  headshotUrl: string | null
  /** School colour for the badge overlay. Null renders no badge rather than a grey blob. */
  teamColor: string | null
  teamAbbrev: string | null
  stats: DevyProspectStat[]
  blurb: string | null
}

export interface DevyExposureRow {
  player: string
  rosteredIn: number
  leagueCount: number
  platforms: string[]
  exposurePct: number
}

export interface DevyRankedPlayer {
  rank: number
  name: string
  school: string
  classYear: string | null
  grade: number | null
}

export interface DevyWatchRow {
  id: string
  name: string
  position: string
  school: string
  headshotUrl: string | null
}

export interface DevyCollegeTile {
  school: string
  conference: string | null
  prospectCount: number
  teamColor: string | null
}

export type DevyNewsKind = 'breakout' | 'injury' | 'combine' | 'transfer' | 'neutral'

export interface DevyNewsItem {
  id: string
  kind: DevyNewsKind
  player: string
  blurb: string
  /** Pre-formatted relative time. Formatting on the server keeps this component pure. */
  age: string
}

export interface DevyCoreProps {
  viewState: DevyViewState
  prospects: DevyProspect[]
  exposure: DevyExposureRow[]
  rankingsByPosition: Partial<Record<DevyPosition, DevyRankedPlayer[]>>
  watchlist: DevyWatchRow[]
  colleges: DevyCollegeTile[]
  news: DevyNewsItem[]
  /** Where "Connect a league" goes. */
  connectHref?: string
}

const POSITIONS: DevyPosition[] = ['QB', 'RB', 'WR', 'TE']

/** The handoff's thresholds, kept in one place so the table and the hero cannot drift. */
export function gradeTone(grade: number | null): 'good' | 'accent' | 'neutral' {
  if (grade == null) return 'neutral'
  if (grade >= 93) return 'good'
  if (grade >= 88) return 'accent'
  return 'neutral'
}

function Grade({ grade }: { grade: number | null }) {
  // Null is "not scored", which is not the same as a low grade. Render the absence.
  if (grade == null) return <span className="af-devy-grade af-devy-grade--neutral">—</span>
  return <span className={`af-devy-grade af-devy-grade--${gradeTone(grade)}`}>{Math.round(grade)}</span>
}

function Trend({ trend }: { trend: DevyTrend }) {
  const glyph = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—'
  const label = trend === 'up' ? 'Trending up' : trend === 'down' ? 'Trending down' : 'Flat'
  return (
    <span className={`af-devy-trend af-devy-trend--${trend}`} title={label}>
      <span aria-hidden="true">{glyph}</span>
      <span className="af-sr-only"> {label}</span>
    </span>
  )
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Headshot with an initials fallback.
 *
 * ⚠ NOT A BROKEN <img>. The handoff uses `<image-slot>` placeholders, which are a
 * design-tool affordance with no runtime equivalent — every one of them is a URL the feed
 * may not have. A missing headshot must degrade to something legible, not to the
 * browser's broken-image glyph.
 */
function Avatar({ url, name, color, abbrev }: { url: string | null; name: string; color: string | null; abbrev: string | null }) {
  return (
    <div className="af-devy-avatar-wrap">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- vendor headshot CDNs are not in next.config images
        <img className="af-devy-avatar" src={url} alt="" loading="lazy" />
      ) : (
        <div className="af-devy-avatar-fb" aria-hidden="true">
          {initials(name)}
        </div>
      )}
      {color ? (
        <span className="af-devy-badge" style={{ background: color }} aria-hidden="true">
          {abbrev ?? ''}
        </span>
      ) : null}
    </div>
  )
}

function LoadingPanel() {
  return (
    <div className="af-devy-state" role="status" aria-live="polite">
      <div className="af-devy-spinner" aria-hidden="true" />
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text2)' }}>Loading devy data…</div>
      <div className="af-devy-skel" aria-hidden="true">
        <span style={{ width: '70%' }} />
        <span style={{ width: '90%' }} />
        <span style={{ width: '55%' }} />
      </div>
    </div>
  )
}

function EmptyPanel({ connectHref }: { connectHref?: string }) {
  return (
    <div className="af-devy-state">
      <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>No devy data yet</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 420 }}>
        Connect a league with devy or taxi slots and college prospects you can roster will show up
        here, ranked and tracked across every league you are in.
      </div>
      <a className="af-devy-btn" href={connectHref ?? '/import'}>
        Connect a league
      </a>
    </div>
  )
}

export default function DevyCore({
  viewState,
  prospects,
  exposure,
  rankingsByPosition,
  watchlist,
  colleges,
  news,
  connectHref,
}: DevyCoreProps) {
  const [activePosition, setActivePosition] = useState<DevyPosition>('QB')
  const posList = useMemo(() => rankingsByPosition[activePosition] ?? [], [rankingsByPosition, activePosition])

  return (
    <div className="af-core af-devy">
      <header className="af-devy-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div className="af-devy-eyebrow">Core · Devy</div>
          <h1 className="af-devy-title">Devy</h1>
          <p className="af-devy-sub">
            College prospects tracked across every league you&apos;re in — rankings, exposure, and
            news, pulled from public college data feeds.
          </p>
        </div>
      </header>

      {viewState === 'loading' ? <LoadingPanel /> : null}
      {viewState === 'empty' ? <EmptyPanel connectHref={connectHref} /> : null}

      {viewState === 'populated' ? (
        <>
          <section className="af-devy-card" aria-labelledby="af-devy-top">
            <div className="af-devy-sec-head">
              <div className="af-devy-eyebrow" id="af-devy-top">
                Top devy prospects
              </div>
            </div>
            {prospects.map((p) => (
              <article className="af-devy-prospect" key={p.id}>
                <div className="af-devy-rank">{p.rank}</div>
                <Avatar url={p.headshotUrl} name={p.name} color={p.teamColor} abbrev={p.teamAbbrev} />
                <div style={{ minWidth: 0 }}>
                  <div className="af-devy-name">
                    {p.name} <Trend trend={p.trend} />
                  </div>
                  <div className="af-devy-meta">
                    {[p.position, p.school, p.classYear].filter(Boolean).join(' · ')}
                  </div>
                  {p.blurb ? <p className="af-devy-blurb">{p.blurb}</p> : null}
                </div>
                <div className="af-devy-statrow">
                  {p.stats.map((s) => (
                    <div key={s.label} style={{ textAlign: 'right' }}>
                      <div className="af-devy-stat-v">{s.value}</div>
                      <div className="af-devy-stat-l">{s.label}</div>
                    </div>
                  ))}
                  <div style={{ textAlign: 'right' }}>
                    <Grade grade={p.grade} />
                    <div className="af-devy-stat-l">Grade</div>
                  </div>
                </div>
              </article>
            ))}
          </section>

          <section className="af-devy-card" aria-labelledby="af-devy-exp">
            <div className="af-devy-sec-head">
              <div className="af-devy-eyebrow" id="af-devy-exp">
                Cross-league exposure
              </div>
            </div>
            <div className="af-devy-tablewrap">
              <table className="af-devy-table">
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Leagues</th>
                    <th scope="col">Platforms</th>
                    <th scope="col">Exposure</th>
                  </tr>
                </thead>
                <tbody>
                  {exposure.map((e) => (
                    <tr key={e.player}>
                      <td>{e.player}</td>
                      <td className="af-devy-num">
                        {e.rosteredIn} of {e.leagueCount}
                      </td>
                      <td>{e.platforms.join(', ') || '—'}</td>
                      <td className="af-devy-num af-devy-num--accent">{Math.round(e.exposurePct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="af-devy-card" aria-labelledby="af-devy-rank">
            <div className="af-devy-sec-head">
              <div className="af-devy-eyebrow" id="af-devy-rank">
                Rankings by position
              </div>
            </div>
            <div className="af-devy-chips" role="group" aria-label="Filter rankings by position">
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  className="af-devy-chip"
                  aria-pressed={activePosition === pos}
                  onClick={() => setActivePosition(pos)}
                >
                  {pos}
                </button>
              ))}
            </div>
            <div className="af-devy-tablewrap" style={{ marginTop: 12 }}>
              <table className="af-devy-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Player</th>
                    <th scope="col">School</th>
                    <th scope="col">Class</th>
                    <th scope="col">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {posList.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--faint)' }}>
                        No ranked {activePosition}s in the pool yet.
                      </td>
                    </tr>
                  ) : (
                    posList.map((q) => (
                      <tr key={`${q.rank}-${q.name}`}>
                        <td className="af-devy-num">{q.rank}</td>
                        <td>{q.name}</td>
                        <td>{q.school}</td>
                        <td>{q.classYear ?? '—'}</td>
                        <td>
                          <Grade grade={q.grade} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="af-devy-card" aria-labelledby="af-devy-watch">
            <div className="af-devy-sec-head">
              <div className="af-devy-eyebrow" id="af-devy-watch">
                Your watchlist
              </div>
            </div>
            {watchlist.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--faint)', margin: 0 }}>
                Nothing followed yet. Following a prospect keeps his news and grade changes here.
              </p>
            ) : (
              <div className="af-devy-grid2">
                {watchlist.map((w) => (
                  <div className="af-devy-tile" key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar url={w.headshotUrl} name={w.name} color={null} abbrev={null} />
                    <div style={{ minWidth: 0 }}>
                      <div className="af-devy-name">{w.name}</div>
                      <div className="af-devy-meta">
                        {w.position} · {w.school}
                      </div>
                    </div>
                    <span className="af-devy-pill" style={{ marginLeft: 'auto' }}>
                      Following
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="af-devy-card" aria-labelledby="af-devy-colleges">
            <div className="af-devy-sec-head">
              <div className="af-devy-eyebrow" id="af-devy-colleges">
                Browse by college
              </div>
            </div>
            <div className="af-devy-grid4">
              {colleges.map((c) => (
                <div className="af-devy-tile" key={c.school}>
                  <span
                    className="af-devy-badge"
                    style={{ position: 'static', background: c.teamColor ?? 'var(--chip)', display: 'inline-flex' }}
                    aria-hidden="true"
                  />
                  <div className="af-devy-name" style={{ marginTop: 8 }}>
                    {c.school}
                  </div>
                  <div className="af-devy-meta">{c.conference ?? '—'}</div>
                  <div className="af-devy-stat-l" style={{ marginTop: 6 }}>
                    {c.prospectCount} tracked
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="af-devy-card" aria-labelledby="af-devy-news">
            <div className="af-devy-sec-head">
              <div className="af-devy-eyebrow" id="af-devy-news">
                Devy news
              </div>
            </div>
            {news.map((n) => (
              <div className="af-devy-news" key={n.id}>
                <span className={`af-devy-tag af-devy-tag--${n.kind}`}>{n.kind}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="af-devy-name">{n.player}</div>
                  <div className="af-devy-meta">{n.blurb}</div>
                </div>
                <span className="af-devy-time">{n.age}</span>
              </div>
            ))}
            <p className="af-devy-note">
              College data is sourced from public feeds and updates on a schedule — grades and news
              can lag the field. Nothing here is an official injury designation; the NCAA does not
              publish one.
            </p>
          </section>
        </>
      ) : null}
    </div>
  )
}
