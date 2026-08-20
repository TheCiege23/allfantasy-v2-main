'use client'

import Link from 'next/link'
/*
 * ⚠ af-core.css FIRST, AND IT IS LOAD BEARING. This screen used to render only
 * inside AfCoreShell, which imports the token layer for everything under it. It
 * now also renders at /dashboard?league=, OUTSIDE that shell — where every
 * var(--surface) / var(--line) / var(--accent) below would resolve to nothing:
 * cards paint transparent with 0px borders and no error is thrown. Exactly the
 * failure the landing page shipped with before the same import fixed it.
 */
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-league-home.css'
import type { LeagueHomeData, SectionState } from '@/lib/core-app/leagueHome'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'

/**
 * Screen 3b — Dashboard, one league selected.
 *
 * The rule the handoff opens with: season timeline, Draft HQ and Commissioner
 * Hub exist ONLY here. There is no single season calendar across 60 leagues,
 * which is why 3a carries none of them.
 *
 * ── LAYOUT ───────────────────────────────────────────────────────────────────
 * Rebuilt to the 3b screenshot: identity header, full-width season timeline,
 * then `1fr | 372px` — matchup strip, the one urgent action, Draft HQ /
 * Commissioner Hub two-up and standings on the left; Ask Chimmy, league buzz and
 * rivalry radar on the right. Under 1080px it collapses to one column and the
 * timeline scrolls horizontally with the current stage pinned in view, which is
 * the mobile frame's own behaviour.
 *
 * ⚠ FOUR PANELS IN THE DESIGN HAVE NO DATA BEHIND THEM AND SAY SO IN WORDS.
 * Measured against the loader before building, not discovered afterwards:
 *
 *   - MATCHUP + WIN PROBABILITY. `leagueHome.matchup` is an `UnavailableSection`
 *     on every code path — no writer produces per-week scoring for imported
 *     leagues. The handoff's 71% is the single most authoritative-looking number
 *     in the product and there is nothing behind it.
 *   - COMMISSIONER HUB. Votes and commissioner tasks are not ingested.
 *   - LEAGUE BUZZ. League transactions are not ingested for these platforms.
 *   - RIVALRY RADAR. No head-to-head history, and nothing anywhere records when
 *     a manager is usually online.
 *
 * Each renders its frame with the reason inside rather than being dropped, so
 * the screen matches the design AND is honest about which panels are waiting on
 * an engine. A greyed-out "71%" still reads as a win probability.
 */

export type LeagueHomeProps = {
  data: LeagueHomeData
  /** How many outstanding issues exist in OTHER leagues. */
  otherLeagueIssueCount: number
  /**
   * This league's own issues, already sorted by severity then deadline.
   *
   * ⚠ THE HANDOFF SORTS THESE BY POINT DELTA ("the higher point delta wins").
   * We do not compute a point delta for any issue — `CoreIssue` carries a
   * deadline and a severity and no projection — so the existing sort stands in,
   * which ranks a lineup that locks in an hour above one that locks tomorrow.
   * That is a different rule and it is the honest one available.
   */
  issues?: CoreIssue[]
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <div className="af-unavailable">
      <span className="af-unavailable-mark" aria-hidden>
        —
      </span>
      <span className="af-unavailable-text">{reason}</span>
    </div>
  )
}

/** A titled panel. `tone` drives the 3b border colour on Commissioner Hub. */
function Panel({
  title,
  help,
  tone,
  className,
  children,
}: {
  title: string
  help?: React.ReactNode
  tone?: 'warn'
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={`af-card af-lh-panel${className ? ` ${className}` : ''}`}
      data-tone={tone}
    >
      <header className="af-lh-panel-head">
        <h2 className="af-label af-lh-panel-title">{title}</h2>
        {help ? <span className="af-lh-panel-help">{help}</span> : null}
      </header>
      {children}
    </section>
  )
}

function StatePanel<T>({
  title,
  help,
  tone,
  className,
  state,
  children,
}: {
  title: string
  help?: React.ReactNode
  tone?: 'warn'
  className?: string
  state: SectionState<T> | { available: false; reason: string }
  children: (data: T) => React.ReactNode
}) {
  return (
    <Panel title={title} help={help} tone={tone} className={className}>
      {state.available ? children((state as { available: true; data: T }).data) : <Unavailable reason={state.reason} />}
    </Panel>
  )
}

export function LeagueHome({ data, otherLeagueIssueCount, issues = [] }: LeagueHomeProps) {
  const { league } = data
  const platformLabel = league.platform === 'manual' ? 'your platform' : league.platform

  /*
   * ONE urgent action, not a list — the handoff is explicit. Anything that has
   * dropped out of the top slot is still reachable from the nav counts, so
   * nothing is hidden, it is just not competing for the same row.
   */
  const urgent = issues[0] ?? null

  return (
    <div className="af-lh">
      {/* ── League identity ─────────────────────────────────────────── */}
      <header className="af-lh-head">
        <div className="af-lh-ident">
          <h1 className="af-display af-lh-name">{league.name}</h1>
          <div className="af-lh-sub">
            <span className="af-platform af-lh-platform" data-platform={league.platform}>
              {league.platform}
            </span>
            {league.format ? <span>{league.format}</span> : null}
            {league.season ? <span className="af-num">{league.season}</span> : null}
            {data.yourTeam.available ? (
              <>
                <span className="af-num">{data.yourTeam.data.record}</span>
                {data.yourTeam.data.rank != null ? (
                  <span className="af-num">#{data.yourTeam.data.rank}</span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="af-lh-headside">
          {/*
            The READ-ONLY chip is on every signed-in screen per the shared
            contract. At /dashboard?league= this screen renders outside
            AfCoreShell, so nothing else on the page carries it.
          */}
          <span className="af-readonly">Read-only</span>
          <span className="af-sync af-num" data-stale={data.syncAge.stale}>
            {data.syncAge.stale ? '⚠ ' : ''}
            {data.syncAge.label}
          </span>
          <Link href="/dashboard" className="af-btn af-btn--ghost af-lh-back">
            Back to home →
          </Link>
        </div>
      </header>

      {/* ── Season timeline ─────────────────────────────────────────── */}
      <StatePanel
        title={`Season timeline · ${league.name}`}
        help={
          league.currentWeek != null ? (
            <span className="af-lh-here">You are here · week {league.currentWeek}</span>
          ) : undefined
        }
        className="af-lh-timeline-panel"
        state={data.timeline}
      >
        {(stages) => (
          <ol className="af-timeline">
            {stages.map((s) => (
              <li key={s.key} className="af-timeline-stage" data-state={s.state}>
                <span className="af-timeline-bar" aria-hidden />
                <span className="af-timeline-label">{s.label}</span>
                <span className="af-timeline-when af-label">{s.state === 'now' ? 'NOW' : s.when}</span>
              </li>
            ))}
          </ol>
        )}
      </StatePanel>

      {/* ── Main / side ─────────────────────────────────────────────── */}
      <div className="af-lh-grid">
        <div className="af-lh-main">
          {/* Matchup strip. Renders the frame, never a fabricated score. */}
          <StatePanel title="This week's matchup" className="af-lh-matchup" state={data.matchup}>
            {() => null}
          </StatePanel>

          {/* The one urgent action */}
          {urgent ? (
            <section className="af-card af-issue af-lh-urgent" data-severity={urgent.severity}>
              <span className="af-lh-urgent-glyph" aria-hidden>
                {urgent.glyph}
              </span>
              <div className="af-lh-urgent-body">
                <h2 className="af-lh-urgent-title">{urgent.title}</h2>
                <p className="af-lh-urgent-meta">{urgent.meta}</p>
              </div>
              {urgent.action ? (
                <Link
                  href={urgent.action.href}
                  className="af-btn af-lh-urgent-cta"
                  {...(urgent.action.external
                    ? { target: '_blank', rel: 'noopener noreferrer' }
                    : {})}
                >
                  {urgent.action.label}
                </Link>
              ) : null}
            </section>
          ) : null}

          {/* Draft HQ + Commissioner Hub, two-up */}
          <div className="af-lh-two">
            <StatePanel title="Draft HQ" state={data.draftHq}>
              {(d) => (
                <div>
                  <div className="af-lh-card-headline">{d.headline}</div>
                  {d.detail ? <p className="af-lh-card-detail">{d.detail}</p> : null}
                  <Link
                    href={`/core/draft-hq?league=${encodeURIComponent(league.id)}`}
                    className="af-lh-cardlink"
                  >
                    Open Draft HQ →
                  </Link>
                </div>
              )}
            </StatePanel>

            <StatePanel title="Commissioner Hub" tone="warn" state={data.commissioner}>
              {(c) => <div className="af-lh-card-headline">{c.openCount} open</div>}
            </StatePanel>
          </div>

          {/* Standings */}
          <StatePanel title="Standings" state={data.standings}>
            {(rows) => (
              <ol className="af-standings">
                {rows.slice(0, 6).map((t, i) => (
                  <li key={t.teamId} className="af-standings-row" data-you={t.isYou}>
                    <span className="af-standings-rank af-num">{t.rank ?? i + 1}</span>
                    <span className="af-standings-name">
                      {t.teamName}
                      {t.isYou ? <span className="af-standings-you"> — you</span> : null}
                    </span>
                    <span className="af-standings-record af-num">
                      {t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </StatePanel>
        </div>

        <aside className="af-lh-side">
          {/*
            ── Ask Chimmy ───────────────────────────────────────────────
            The handoff's open item resolves here: the screenshot label reads
            CHIMMY INTELLIGENCE, ship it as ASK CHIMMY to match the rest of the
            product.

            The card carries the read-only posture rather than a verdict.
            Chimmy's advice on this screen would have to be built on the matchup
            and lineup data the panel above just said we do not have.
          */}
          <Panel title="Ask Chimmy" help={<span className="af-lh-scope">This league only</span>}>
            <p className="af-lh-chimmy-note">
              Chimmy reasons about this league only from here. There is no verdict to show yet —
              the lineup and matchup reads it would be built on are not ingested for this league.
            </p>
            <p className="af-lh-readonly-note">
              Make changes in {platformLabel} — AllFantasy only reads your league.
            </p>
          </Panel>

          <StatePanel title="League buzz" state={data.buzz}>
            {(items) => (
              <ul className="af-buzz">
                {items.map((b) => (
                  <li key={b.id} className="af-buzz-row">
                    <span className="af-buzz-actor">{b.actor}</span>
                    <span className="af-buzz-text">{b.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </StatePanel>

          <StatePanel title="Rivalry radar · this league" state={data.rivalry}>
            {() => null}
          </StatePanel>
        </aside>
      </div>

      {/*
        ── All leagues ──────────────────────────────────────────────────
        League scope is absolute on this screen: every panel above is about this
        one league, and cross-league facts live here and nowhere else.
      */}
      {otherLeagueIssueCount > 0 ? (
        <section className="af-card af-lh-elsewhere">
          <span className="af-label">All leagues</span>
          <p className="af-lh-elsewhere-text">
            {otherLeagueIssueCount} more {otherLeagueIssueCount === 1 ? 'issue lives' : 'issues live'}{' '}
            outside this league.
          </p>
          <Link href="/dashboard" className="af-lh-cardlink">
            Back to home →
          </Link>
        </section>
      ) : null}
    </div>
  )
}

export default LeagueHome
