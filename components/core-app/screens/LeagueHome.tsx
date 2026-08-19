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

/**
 * Screen 2 — Dashboard, one league selected.
 *
 * The handoff: "the rail stays; the main column becomes that league's world".
 * Season timeline, Draft HQ and Commissioner Hub appear ONLY here.
 *
 * Sections render real values or state plainly that they are unavailable and
 * why. There is no skeleton standing in for a number — a greyed-out win
 * probability still reads as a win probability, and this screen is where the
 * temptation to fake one is strongest.
 */

export type LeagueHomeProps = {
  data: LeagueHomeData
  /** How many outstanding issues exist in OTHER leagues. */
  otherLeagueIssueCount: number
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

function Section<T>({
  title,
  help,
  state,
  children,
}: {
  title: string
  help?: string
  state: SectionState<T>
  children: (data: T) => React.ReactNode
}) {
  return (
    <section className="af-card af-lh-section">
      <header className="af-lh-section-head">
        <h2 className="af-label af-lh-section-title">{title}</h2>
        {help ? <span className="af-lh-section-help">{help}</span> : null}
      </header>
      {state.available ? children(state.data) : <Unavailable reason={state.reason} />}
    </section>
  )
}

export function LeagueHome({ data, otherLeagueIssueCount }: LeagueHomeProps) {
  const { league } = data

  return (
    <div className="af-lh">
      {/* ── League identity ─────────────────────────────────────────── */}
      <header className="af-lh-head">
        <div>
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

        {/* Back to the all-leagues dashboard — the state this screen is a
            variant OF, not /core, which is a different surface. */}
        <Link href="/dashboard" className="af-btn af-btn--ghost af-lh-back">
          Back to home →
        </Link>
      </header>

      {otherLeagueIssueCount > 0 ? (
        <p className="af-lh-elsewhere">
          <span className="af-label">All leagues</span>
          {` ${otherLeagueIssueCount} more ${otherLeagueIssueCount === 1 ? 'issue lives' : 'issues live'} outside this league.`}
        </p>
      ) : null}

      {/* ── Season timeline ─────────────────────────────────────────── */}
      <Section
        title={`Season timeline · ${league.name}`}
        help={league.currentWeek != null ? `You are here · week ${league.currentWeek}` : undefined}
        state={data.timeline}
      >
        {(stages) => (
          <ol className="af-timeline">
            {stages.map((s) => (
              <li key={s.key} className="af-timeline-stage" data-state={s.state}>
                <span className="af-timeline-dot" aria-hidden />
                <span className="af-timeline-label">{s.label}</span>
                <span className="af-timeline-when af-label">{s.state === 'now' ? 'NOW' : s.when}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <div className="af-lh-grid">
        {/* ── Matchup ───────────────────────────────────────────────── */}
        <Section title="This week's matchup" state={data.matchup}>
          {() => null}
        </Section>

        {/* ── Standings ─────────────────────────────────────────────── */}
        <Section title="Standings" state={data.standings}>
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
        </Section>

        {/* ── Draft HQ ──────────────────────────────────────────────── */}
        <Section title="Draft HQ" state={data.draftHq}>
          {(d) => (
            <div>
              <div className="af-lh-card-headline">{d.headline}</div>
              <p className="af-lh-card-detail">{d.detail}</p>
            </div>
          )}
        </Section>

        {/* ── Commissioner Hub ──────────────────────────────────────── */}
        <Section title="Commissioner Hub" state={data.commissioner}>
          {(c) => <div className="af-lh-card-headline">{c.openCount} open</div>}
        </Section>

        {/* ── League buzz ───────────────────────────────────────────── */}
        <Section title="League buzz" state={data.buzz}>
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
        </Section>
      </div>

      {/*
        The handoff puts this line under Chimmy's advice on this screen, and it is
        the product's whole posture in one sentence — so it stays visible even
        while the intelligence panel itself has nothing to say.
      */}
      <p className="af-lh-readonly-note">
        Make changes in {league.platform === 'manual' ? 'your platform' : league.platform} — AllFantasy
        only reads your league.
      </p>
    </div>
  )
}

export default LeagueHome
