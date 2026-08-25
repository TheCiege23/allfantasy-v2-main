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
import { LeagueScoreboardPanel } from '@/components/core-app/screens/LeagueScoreboardPanel'

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
 * ⚠ TWO OF THE FOUR "MISSING" PANELS WERE NOT MISSING. Corrected after audit:
 *
 *   - MATCHUP + WIN PROBABILITY. ✅ REAL NOW. The claim that no writer produces
 *     per-week scoring was false — `lib/core-app/matchup.ts` already resolved
 *     WeeklyMatchup rows and priced both lineups against fantasy_projections for
 *     the Matchup screen. `leagueHome` now reuses that resolver. The probability
 *     renders only when the engine produced one; a matchup that could not be
 *     priced shows scores and no percentage.
 *   - RIVALRY RADAR. ✅ REAL NOW. `WeeklyMatchup.matchupId` pairs the two rosters
 *     in a week, so every past meeting is stored. Only "usually online" is
 *     genuinely absent, and that line is dropped rather than guessed.
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
          <Link href="/core" className="af-btn af-btn--ghost af-lh-back">
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

      {/* ── Every game in the league ────────────────────────────────── */}
      {/*
        ⚠ THE PAGE SHOWED ONE MATCHUP — THE VIEWER'S. On a screen whose whole
        subject is the league, the other games were invisible: you could not see
        who was getting blown out, who was in a shootout, or whether next week's
        opponent was in trouble.
      */}
      <StatePanel
        title="This week in the league"
        className="af-lh-scoreboard-panel"
        state={data.scoreboard}
      >
        {(board) => (
          <LeagueScoreboardPanel
            board={board}
            winProbability={data.matchup.available ? data.matchup.data.winProbability : null}
          />
        )}
      </StatePanel>

      {/* ── Power board: all-play + movement ────────────────────────── */}
      {/*
        ⚠ STANDINGS LIE EARLY. A team can post the second-highest score in the
        league and be 0-2 because it drew the top scorer twice. All-play asks
        what the record would be against EVERYONE every week, and the gap
        between that and the real record is the schedule's contribution —
        measured rather than argued about.
      */}
      <StatePanel
        title="Power board"
        help={
          data.powerBoard.available ? (
            <span className="af-lh-here">
              through {data.powerBoard.data.weeksCounted}{' '}
              {data.powerBoard.data.weeksCounted === 1 ? 'week' : 'weeks'}
            </span>
          ) : undefined
        }
        className="af-lh-power-panel"
        state={data.powerBoard}
      >
        {(pb) => (
          <ol className="af-pb-list">
            {pb.rows.map((r) => (
              <li key={r.rosterId} className="af-pb-row">
                <span className="af-pb-rank af-num">{r.powerRank}</span>
                {/*
                  Null movement renders as nothing at all. "Unchanged" for a
                  team that has never been ranked is an invented history.
                */}
                {r.powerRankChange != null && r.powerRankChange !== 0 ? (
                  <span
                    className="af-pb-move af-num"
                    data-dir={r.powerRankChange > 0 ? 'up' : 'down'}
                    title={`${Math.abs(r.powerRankChange)} place${
                      Math.abs(r.powerRankChange) === 1 ? '' : 's'
                    } ${r.powerRankChange > 0 ? 'up' : 'down'} since last week`}
                  >
                    {r.powerRankChange > 0 ? '▲' : '▼'}
                    {Math.abs(r.powerRankChange)}
                  </span>
                ) : (
                  <span className="af-pb-move af-pb-move--none" aria-hidden />
                )}
                <span className="af-pb-name">
                  {r.teamName ?? r.managerName ?? `Roster ${r.rosterId}`}
                </span>
                <span className="af-pb-rec af-num" title="Real head-to-head record">
                  {r.wins}-{r.losses}
                  {r.ties > 0 ? `-${r.ties}` : ''}
                </span>
                <span
                  className="af-pb-allplay af-num"
                  title="What the record would be playing everyone every week"
                >
                  {r.allPlayWins}-{r.allPlayLosses}
                  {r.allPlayTies > 0 ? `-${r.allPlayTies}` : ''}
                </span>
                {/*
                  Luck in WINS, because that is the unit people argue in.
                  Rounded to a tenth and only shown when it is worth a mention —
                  a 0.2-win swing is noise dressed as an insight.
                */}
                {Math.abs(r.luckWins) >= 0.5 ? (
                  <span
                    className="af-pb-luck af-num"
                    data-dir={r.luckWins > 0 ? 'lucky' : 'unlucky'}
                    title={
                      r.luckWins > 0
                        ? `${r.luckWins.toFixed(1)} wins better than they have played`
                        : `${Math.abs(r.luckWins).toFixed(1)} wins worse than they have played`
                    }
                  >
                    {r.luckWins > 0 ? '+' : ''}
                    {r.luckWins.toFixed(1)}
                  </span>
                ) : (
                  <span className="af-pb-luck af-pb-move--none" aria-hidden />
                )}
              </li>
            ))}
          </ol>
        )}
      </StatePanel>

      {/* ── Main / side ─────────────────────────────────────────────── */}
      <div className="af-lh-grid">
        <div className="af-lh-main">
          {/*
            ⚠ THE "THIS WEEK'S MATCHUP" PANEL WAS HERE AND HAS BEEN DELETED.
            The scoreboard above shows every game in the league with yours
            marked and sorted first, so this panel printed week 1 a second time
            a few hundred pixels lower.

            The one thing it had that the scoreboard did not is the win
            probability, which now renders on your own game up there rather
            than being lost with the panel.
          */}

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
                    {/*
                      The manager's own avatar. A feed of league activity should
                      read as people, not as rows — and until the attribution
                      was fixed every line here said "A manager", because it
                      joined on a column the writer hardcodes to null.
                    */}
                    {b.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="af-buzz-av" src={b.avatarUrl} alt="" width={22} height={22} />
                    ) : (
                      <span className="af-buzz-av af-buzz-av--none" aria-hidden>
                        {b.actor.charAt(0)}
                      </span>
                    )}
                    <span className="af-buzz-actor">{b.actor}</span>
                    <span className="af-buzz-text">{b.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </StatePanel>

          {/*
            Rivalry radar. Same `() => null` trap as the matchup strip above.
            The design also shows when a manager is usually online; nothing records
            that, so it is the one line omitted rather than invented.
           */}
          <StatePanel title="Rivalry radar · this league" state={data.rivalry}>
            {(rows) => (
              <div className="af-lh-rivals">
                {rows.map((r) => (
                  <div key={r.key} className="af-lh-rival">
                    <span className="af-lh-rival-body">
                      <b>{r.name}</b>
                      <em>
                        {r.meetings} {r.meetings === 1 ? 'meeting' : 'meetings'}
                        {r.lastResult ? ` · last: ${r.lastResult}` : ''}
                      </em>
                    </span>
                    <b className={r.wins >= r.losses ? 'af-lh-good' : 'af-lh-bad'}>
                      {r.wins}–{r.losses}
                    </b>
                  </div>
                ))}
              </div>
            )}
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
          <Link href="/core" className="af-lh-cardlink">
            Back to home →
          </Link>
        </section>
      ) : null}
    </div>
  )
}

export default LeagueHome
