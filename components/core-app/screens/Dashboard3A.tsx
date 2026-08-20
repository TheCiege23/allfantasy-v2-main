'use client'

import Link from 'next/link'
/*
 * ⚠ af-core.css FIRST, AND IT IS LOAD BEARING. This screen renders at /dashboard
 * OUTSIDE AfCoreShell, which is what imports the token layer for everything
 * under it. Without this line every var(--surface) / var(--line) / var(--accent)
 * below resolves to nothing: cards paint transparent with 0px borders and no
 * error is thrown. The same failure shipped on the landing page and on /login
 * before this exact import fixed it, and LeagueHome carries the same note.
 */
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-3a.css'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import type { CareerData } from '@/lib/core-app/career'
import type { WeekAllData } from '@/lib/core-app/weekAll'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'

/**
 * Screen 3a — Dashboard, all leagues.
 *
 * The rule the handoff opens with, and the reason this is a separate screen from
 * 3b: NO season timeline, NO Draft HQ card, NO Commissioner Hub. There is no one
 * season calendar across every league you play, so those three render only once a
 * league is picked. This screen is the cross-league aggregate.
 *
 * ── LAYOUT ───────────────────────────────────────────────────────────────────
 * 82px rail | 232px nav | main. Main is search + header, then `1fr | 360px` —
 * outstanding issues and this week's matchups on the left, Ask Chimmy, career
 * and rivalry on the right — then a three-up row of portfolio, leagues and
 * tools. Collapses to one column under 1080px.
 *
 * ── WHAT IS REAL, AND WHAT IS NOT ────────────────────────────────────────────
 * Measured against the loaders BEFORE building, the way 3b did, rather than
 * discovered after:
 *
 *   REAL — Outstanding issues (`deriveOutstandingIssues`: severity, glyph,
 *   title, meta, league, deadline and a platform deep link, already sorted by
 *   soonest deadline). Your career (the canonical XP engine: level, level name,
 *   XP progress, seasons, championships). My leagues (`Dash34Data.leagues`,
 *   including its own `formatLabel`). Matchup scores, from two sources merged in
 *   order: `Dash34League.score` when a league is live — it carries the OPPONENT'S
 *   NAME — then `WeekAllData.rows` for the rest, which is scored history without
 *   an opponent. A league appears once.
 *
 *   NOT REAL, AND SAID SO IN WORDS —
 *     - WIN PROBABILITY on the matchup cards. Neither source has projections or
 *       players-left-to-play, so the design's "71% win" has nothing behind it. 3b
 *       reached the same conclusion about the same number. It is the most
 *       authoritative-looking figure on the screen and inventing it is the one
 *       thing the handoff's own build rule forbids.
 *     - PLAYER EXPOSURE ("J. Jefferson · 4 of 4"). Needs per-roster player rows
 *       joined across leagues. `PortfolioData` is league inventory, not players.
 *     - RIVALRY RADAR. No head-to-head history exists, and nothing records when a
 *       manager is usually online.
 *
 * Each unbacked panel renders its frame with the reason inside rather than being
 * dropped, so the screen matches the design AND is honest about what is waiting
 * on an engine. A greyed-out "71%" still reads as a win probability, which is
 * why there is no greyed-out 71% here.
 */

export type Dashboard3AProps = {
  issues: CoreIssue[]
  data: Dash34Data | null
  career: CareerData | null
  week: WeekAllData | null
  weekLabel?: string | null
  planName?: string | null
  tokensLeft?: number | null
  commissionerCount?: number
  /** Server-rendered clock, so the header does not hydrate to a different time. */
  nowLabel?: string | null
}

const SEV_CLASS: Record<CoreIssue['severity'], string> = {
  bad: 'af3a-bad',
  warn: 'af3a-warn',
  info: 'af3a-accent',
}

function Help({ children, left = false }: { children: React.ReactNode; left?: boolean }) {
  return (
    <span data-help {...(left ? { 'data-help-left': '' } : {})} aria-hidden="true">
      ?<span data-help-body>{children}</span>
    </span>
  )
}

function platformTile(platform: string | null | undefined): string {
  const p = (platform ?? '').toLowerCase()
  if (p === 'sleeper') return 'S'
  if (p === 'espn') return 'E'
  if (p === 'yahoo') return 'Y'
  return (platform ?? '?').slice(0, 1).toUpperCase()
}

function platformClass(platform: string | null | undefined): string {
  const p = (platform ?? '').toLowerCase()
  if (p === 'sleeper' || p === 'espn' || p === 'yahoo') return `af3a-p-${p}`
  return 'af3a-p-none'
}

/** "in 1h 04m" / "3:00a". Relative while it is close, absolute once it is not. */
function deadlineLabel(deadline: Date | null, now: Date): string | null {
  if (!deadline) return null
  const ms = deadline.getTime() - now.getTime()
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return 'now'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${String(mins % 60).padStart(2, '0')}m`
  return `${Math.floor(hrs / 24)}D`
}

export function Dashboard3A({
  issues,
  data,
  career,
  week,
  weekLabel = null,
  planName = null,
  tokensLeft = null,
  commissionerCount = 0,
  nowLabel = null,
}: Dashboard3AProps) {
  const now = new Date()
  const openCount = issues.length
  const urgent = issues.slice(0, 3)
  const rest = issues.slice(3, 8)
  const leagues = data?.leagues ?? []

  /*
   * Two real sources, preferred in order. `Dash34League.score` is live and knows
   * the OPPONENT'S NAME, which the design shows and `WeekRow` cannot supply.
   * `weekAll` is the scored history and covers leagues with no live score. A
   * league appears once: live wins, history fills the gap.
   */
  const liveKeys = new Set(leagues.filter((l) => l.score).map((l) => l.id))
  const scored: Array<{
    key: string
    leagueName: string
    platform: string | null
    you: number
    them: number
    note: string
  }> = [
    ...leagues
      .filter((l) => l.score)
      .map((l) => ({
        key: l.id,
        leagueName: l.name,
        platform: l.platform ?? null,
        you: l.score!.you,
        them: l.score!.opponent,
        note: `vs ${l.score!.opponentName}`,
      })),
    ...(week?.rows ?? [])
      .filter((r) => !liveKeys.has(r.leagueId))
      .map((r) => ({
        key: r.leagueId,
        leagueName: r.leagueName,
        platform: r.platform,
        you: r.pointsFor,
        them: r.pointsAgainst,
        note: `Week ${r.week} · ${r.won ? 'you won' : 'you lost'}`,
      })),
  ]

  return (
    <div className="af-core af3a-shell">
      {/* ── Rail ─────────────────────────────────────────────────────────── */}
      <aside className="af3a-rail" aria-label="Platforms">
        <div className="af3a-shield" aria-label="AllFantasy">AF</div>
        <div className="af3a-rail-line" />
        {leagues.slice(0, 4).map((l) => (
          <Link
            key={l.id}
            href={`/dashboard?league=${encodeURIComponent(l.id)}`}
            className={`af3a-tile ${platformClass(l.platform)}`}
            title={l.name ?? 'League'}
          >
            {platformTile(l.platform)}
          </Link>
        ))}
        <Link href="/import" className="af3a-tile af3a-tile-add" title="Import a league">
          +
        </Link>
        <div className="af3a-rail-spacer" />
        <Link href="/settings" className="af3a-avatar" title="Profile, settings and modes">
          {(career?.handle ?? 'G').slice(0, 1).toUpperCase()}
        </Link>
      </aside>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="af3a-nav" aria-label="Sections">
        <ul className="af3a-navlist">
          <li><span className="af3a-navitem af3a-navitem-on"><i>▣</i>Home</span></li>
          <li><Link className="af3a-navitem" href="/players"><i>•</i>Player Finder</Link></li>
          <li>
            <Link className="af3a-navitem" href="/war-room">
              <i>◆</i>War Room<em className="af3a-tag af3a-tag-good">LIVE</em>
            </Link>
          </li>
          <li><Link className="af3a-navitem" href="/draft"><i>▤</i>Draft HQ</Link></li>
          <li><Link className="af3a-navitem" href="/portfolio"><i>◈</i>Portfolio</Link></li>
          <li><Link className="af3a-navitem" href="/career"><i>★</i>Your career</Link></li>
          <li>
            <Link className="af3a-navitem" href="/rankings">
              <i>↑</i>Rankings
              {career?.level != null ? <em className="af3a-tag">LVL {career.level}</em> : null}
            </Link>
          </li>
          <li>
            <Link className="af3a-navitem" href="/commissioner">
              <i>⚑</i>Commissioner
              {commissionerCount > 0 ? <em className="af3a-count">{commissionerCount}</em> : null}
            </Link>
          </li>
          <li><Link className="af3a-navitem" href="/tools"><i>⚙</i>Tools</Link></li>
        </ul>

        <div className="af3a-import">
          <h4>Import a league</h4>
          <p>Sleeper, ESPN or Yahoo. Read-only, takes about a minute.</p>
          <Link className="af3a-btn af3a-btn-accent af3a-btn-full" href="/import">
            Connect a platform
          </Link>
        </div>
      </nav>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="af3a-main">
        <div className="af3a-topbar">
          <div className="af3a-search">
            <span className="af3a-search-dot" />
            <span className="af3a-search-ph">Search any player or league</span>
            <kbd>⌘K</kbd>
          </div>
          <span className="af3a-chip">
            READ-ONLY
          </span>
          <Help>
            <b>AllFantasy never writes to your leagues.</b>
            We read your rosters and tell you what to do. Every change happens on the
            platform itself.
          </Help>
          {nowLabel ? <span className="af3a-chip af3a-mono">{nowLabel}</span> : null}
          <span className="af3a-chip af3a-plan">
            <b>{planName ?? 'FREE'}</b>
            {tokensLeft != null ? (
              <>
                <i />
                <span className="af3a-mono">{tokensLeft.toLocaleString()}</span> TOKENS LEFT
              </>
            ) : null}
          </span>
        </div>

        <div className="af3a-body">
          <div className="af3a-col-main">
            {/* ── Outstanding issues ───────────────────────────────────── */}
            <section className="af3a-sec">
              <header className="af3a-sechead">
                <h2>Outstanding issues</h2>
                <Help>
                  <b>Everything with a deadline, across every league.</b>
                  Unset lineups, waiver runs, trade offers and votes. Sorted by what
                  expires first.
                </Help>
                {openCount > 0 ? <span className="af3a-open">{openCount} OPEN</span> : null}
                <span className="af3a-note">Soonest deadline first</span>
              </header>

              {openCount === 0 ? (
                <div className="af3a-card af3a-empty">
                  <h3>Nothing is waiting on you.</h3>
                  <p>
                    No lineup holes, trade offers or votes with a deadline in any league
                    we can read.
                  </p>
                </div>
              ) : (
                <>
                  {urgent.map((issue) => (
                    <article key={issue.id} className={`af3a-urgent ${SEV_CLASS[issue.severity]}`}>
                      <span className="af3a-glyph">{issue.glyph}</span>
                      <div className="af3a-urgent-body">
                        <h3>
                          {issue.title}
                          {issue.leagueName ? <span className="af3a-dash"> — {issue.leagueName}</span> : null}
                        </h3>
                        <p>{issue.meta}</p>
                      </div>
                      {issue.action ? (
                        <a
                          className={`af3a-btn ${issue.severity === 'info' ? '' : 'af3a-btn-accent'}`}
                          href={issue.action.href}
                          {...(issue.action.external
                            ? { target: '_blank', rel: 'noopener noreferrer' }
                            : {})}
                        >
                          {issue.action.label}
                        </a>
                      ) : null}
                    </article>
                  ))}

                  {rest.length > 0 ? (
                    <div className="af3a-card af3a-rows">
                      {rest.map((issue) => (
                        <div key={issue.id} className="af3a-row">
                          <span className={`af3a-dot ${SEV_CLASS[issue.severity]}`} />
                          <span className="af3a-row-title">{issue.title}</span>
                          <span className="af3a-row-league">{issue.leagueName ?? 'Across your leagues'}</span>
                          <span className="af3a-row-when af3a-mono">
                            {deadlineLabel(issue.deadline, now) ?? '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {openCount > urgent.length + rest.length ? (
                    <Link className="af3a-more" href="/issues">
                      See all {openCount} issues →
                    </Link>
                  ) : null}
                </>
              )}
            </section>

            {/* ── This week's matchups ─────────────────────────────────── */}
            <section className="af3a-sec">
              <header className="af3a-sechead">
                <h2>This week&rsquo;s matchups</h2>
                <span className="af3a-note">{weekLabel ?? 'This week'}</span>
              </header>

              {scored.length === 0 ? (
                <div className="af3a-card af3a-empty">
                  <h3>No scored matchups this week.</h3>
                  <p>
                    Weekly scoring is only recorded for leagues with a synced history.
                    Import or re-sync a league and its scores appear here.
                  </p>
                </div>
              ) : (
                <div className="af3a-grid2">
                  {scored.slice(0, 4).map((m) => (
                    <article key={m.key} className="af3a-match">
                      <span className={`af3a-tile ${platformClass(m.platform)}`}>
                        {platformTile(m.platform)}
                      </span>
                      <div className="af3a-match-body">
                        <h4>{m.leagueName}</h4>
                        {/*
                          The design also puts a win% on this card. Neither source
                          carries projections or players-left-to-play, so there is
                          nothing to derive it from — and "71% win" is the most
                          authoritative-looking number on the screen. The opponent is
                          real when the loader knows it; the probability never is.
                         */}
                        <p>{m.note}</p>
                      </div>
                      <div className="af3a-match-score">
                        <b className={`af3a-mono ${m.you >= m.them ? 'af3a-good' : 'af3a-bad'}`}>
                          {m.you.toFixed(1)}
                        </b>
                        <span className="af3a-mono">{m.them.toFixed(1)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ── Right column ───────────────────────────────────────────── */}
          <div className="af3a-col-side">
            <section className="af3a-card af3a-chimmy">
              <header className="af3a-chimmy-head">
                <span className="af3a-chimmy-av" aria-hidden="true">◕</span>
                <div>
                  <b>ASK CHIMMY</b>
                  <span>Your day, in one line</span>
                </div>
              </header>
              {openCount === 0 ? (
                <h3>Nothing needs you right now — you&rsquo;re clean across every league.</h3>
              ) : (
                <h3>
                  {openCount === 1
                    ? 'One thing needs you today.'
                    : `${openCount} things need you today, soonest first.`}
                </h3>
              )}
              <p className="af3a-chimmy-note">
                I&rsquo;ll point you at the league and screen — you make the change on the
                platform.
              </p>
            </section>

            <section className="af3a-card">
              <header className="af3a-cardhead">
                <span className="af3a-label">YOUR CAREER</span>
                <Help left>
                  <b>Your record across every league you have ever imported.</b>
                  Level comes from the XP engine: championships, win rate, tenure,
                  leagues and playoff appearances.
                </Help>
                <Link className="af3a-cardlink" href="/rankings">Rankings →</Link>
              </header>

              {career ? (
                <>
                  <div className="af3a-career">
                    <span className="af3a-badge" aria-hidden="true">◈</span>
                    {career.level != null ? (
                      <b className="af3a-mono af3a-lvl">
                        LVL <i>{career.level}</i>
                        <em>AF RANK</em>
                      </b>
                    ) : null}
                    <b className="af3a-mono af3a-stat">
                      {career.championships}
                      <em>{career.championships === 1 ? 'TITLE' : 'TITLES'}</em>
                    </b>
                    <b className="af3a-mono af3a-stat">
                      {career.seasonsPlayed}
                      <em>{career.seasonsPlayed === 1 ? 'SEASON' : 'SEASONS'}</em>
                    </b>
                  </div>

                  {career.xp ? (
                    <div className="af3a-xp">
                      <div className="af3a-xp-top">
                        <span>Rank XP{career.levelName ? ` · ${career.levelName}` : ''}</span>
                        <b className="af3a-mono">{career.xp.total.toLocaleString()}</b>
                      </div>
                      <div className="af3a-xp-bar">
                        <span style={{ width: `${Math.max(0, Math.min(100, career.xp.progressPct ?? 0))}%` }} />
                      </div>
                      {career.xp.toNext != null && career.nextLevelName ? (
                        <p className="af3a-xp-note">
                          {career.xp.toNext.toLocaleString()} XP to {career.nextLevelName}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="af3a-reason">
                  Your career has not been scored yet. It fills in once a league with a
                  completed season is imported.
                </p>
              )}
            </section>

            {/*
              RIVALRY RADAR — frame kept, contents replaced by the reason. There is
              no head-to-head store and nothing records when a manager is usually
              online, so every figure in the design ("2–4 all-time", "usually on Sun
              10a–12p") would be invented. 3b reached the same conclusion.
             */}
            <section className="af3a-card">
              <header className="af3a-cardhead">
                <span className="af3a-label">RIVALRY RADAR</span>
              </header>
              <p className="af3a-reason">
                Head-to-head records are not stored yet, so there is no honest way to
                say who your rivals are. Needs a per-matchup opponent history.
              </p>
            </section>
          </div>
        </div>

        {/* ── Bottom three-up ────────────────────────────────────────────── */}
        <div className="af3a-bottom">
          {/*
            PORTFOLIO & EXPOSURE — the design shows player-level roster share
            ("J. Jefferson · 4 of 4"). That needs per-roster player rows joined
            across every league; PortfolioData is league inventory, not players.
           */}
          <section className="af3a-card">
            <header className="af3a-cardhead">
              <span className="af3a-label">PORTFOLIO &amp; EXPOSURE</span>
            </header>
            <p className="af3a-reason">
              Player exposure needs every roster read as players, not as leagues. The
              roster rows are not joined across leagues yet, so there is no share to
              show.
            </p>
            <Link className="af3a-cardlink" href="/portfolio">Open Portfolio →</Link>
          </section>

          <section className="af3a-card">
            <header className="af3a-cardhead">
              <span className="af3a-label">MY LEAGUES</span>
              <span className="af3a-note af3a-push">{leagues.length} total</span>
            </header>
            {leagues.length === 0 ? (
              <p className="af3a-reason">
                No leagues imported yet. Connect a platform and they appear here.
              </p>
            ) : (
              <div className="af3a-leagues">
                {leagues.slice(0, 5).map((l) => (
                  <Link
                    key={l.id}
                    className="af3a-league"
                    href={`/dashboard?league=${encodeURIComponent(l.id)}`}
                  >
                    <span className={`af3a-tile ${platformClass(l.platform)}`}>
                      {platformTile(l.platform)}
                    </span>
                    <span className="af3a-league-body">
                      <b>{l.name ?? 'Untitled league'}</b>
                      <em>{l.formatLabel ?? 'Imported league'}</em>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="af3a-card">
            <header className="af3a-cardhead">
              <span className="af3a-label">TOOLS</span>
            </header>
            <div className="af3a-tools">
              <Link className="af3a-tool" href="/trade-evaluator"><i>⇄</i>Trade analyzer</Link>
              <Link className="af3a-tool" href="/waivers"><i>◷</i>Waiver assistant</Link>
              <Link className="af3a-tool" href="/draft"><i>▤</i>Mock draft</Link>
              <Link className="af3a-tool" href="/rankings"><i>★</i>Rankings</Link>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default Dashboard3A
