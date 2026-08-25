'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'

/**
 * Jump to another week.
 *
 * Writes `?week=` and lets the server re-read — no client fetch and no new API
 * route, which matters because the repo sits at the platform's route ceiling
 * and a week selector is not worth a route. It also makes the view shareable.
 *
 * Every other query param is preserved: this screen is reached with `?league=`
 * already set, and dropping it would bounce the viewer back to the league list
 * the moment they changed week.
 */
function WeekPicker({
  picker,
}: {
  picker: { weeks: number[]; selected: number; current: number | null; isFuture: boolean }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  return (
    <label className="af-weekpick">
      <span className="af-weekpick-label">Week</span>
      <select
        className="af-weekpick-select"
        value={picker.selected}
        onChange={(e) => {
          const next = new URLSearchParams(params?.toString() ?? '')
          next.set('week', e.target.value)
          router.push(`${pathname}?${next.toString()}`, { scroll: false })
        }}
      >
        {picker.weeks.map((w) => (
          <option key={w} value={w}>
            {/* The league's own position is marked, so "now" is findable in a
                list of eighteen identical numbers. */}
            {w === picker.current ? `${w} · now` : w}
          </option>
        ))}
      </select>
    </label>
  )
}

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
        title={
          data.weekPicker && data.weekPicker.isFuture
            ? `Week ${data.weekPicker.selected} in the league`
            : 'This week in the league'
        }
        className="af-lh-scoreboard-panel"
        state={data.scoreboard}
        help={data.weekPicker ? <WeekPicker picker={data.weekPicker} /> : null}
      >
        {(board) => (
          <>
            {/*
              ⚠ A FUTURE WEEK MUST NOT LOOK LIKE A LIVE ONE. Nothing in it has
              happened, and the projections behind it may not even be for the
              week on screen -- the feed only holds the week ahead, so asking
              for week 10 in September prices the right players in the wrong
              week. That is still the best available answer to "who looks
              strong in week 10", and it is a different claim from a week-10
              projection. Saying which is the whole point of this line.
            */}
            {data.weekPicker?.isFuture ? (
              <p className="af-lh-weeknote">
                Nothing in week {data.weekPicker.selected} has been played. Every number is
                projected from today&apos;s rosters
                {board.projectionBasis && !board.projectionBasis.matchesViewedWeek
                  ? `, using week ${board.projectionBasis.week} projections — the feed does not carry week ${data.weekPicker.selected} yet`
                  : ''}
                .
              </p>
            ) : null}
            <LeagueScoreboardPanel
              board={board}
              winProbability={data.matchup.available ? data.matchup.data.winProbability : null}
            />
          </>
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
              <div className="af-ch">
                <p className="af-ch-headline">{d.headline}</p>
                {d.detail ? <p className="af-ch-detail">{d.detail}</p> : null}
                {d.href && d.linkLabel ? (
                  <Link href={d.href} className="af-btn af-ch-open">
                    {d.linkLabel}
                  </Link>
                ) : null}
              </div>
            )}
          </StatePanel>

            <StatePanel
            title="Commissioner Hub"
            help={<span className="af-lh-scope">Commissioners only</span>}
            state={data.commissioner}
          >
            {(hub) => (
              <div className="af-ch">
                {/*
                  THE TWO FACTS A COMMISSIONER OPENS THE APP FOR: is anybody
                  checked out, and who. Everything else belongs behind the link
                  rather than crammed into a preview card.
                */}
                <div className="af-ch-tiles">
                  <div className="af-ch-tile" data-tone={hub.inactiveCount > 0 ? 'bad' : 'ok'}>
                    <span className="af-ch-n af-num">{hub.inactiveCount}</span>
                    <span className="af-label">Inactive</span>
                  </div>
                  <div className="af-ch-tile" data-tone={hub.atRiskCount > 0 ? 'warn' : 'ok'}>
                    <span className="af-ch-n af-num">{hub.atRiskCount}</span>
                    <span className="af-label">At risk</span>
                  </div>
                  <div className="af-ch-tile">
                    <span className="af-ch-n af-num">{hub.totalManagers}</span>
                    <span className="af-label">Managers</span>
                  </div>
                </div>

                {/*
                  Named rather than counted. "3 inactive" is a statistic; three
                  names is something to act on this afternoon.
                */}
                {hub.inactiveNames.length > 0 ? (
                  <p className="af-ch-names">
                    Not touched their team lately: {hub.inactiveNames.join(', ')}
                  </p>
                ) : (
                  <p className="af-ch-names af-ch-names--ok">
                    Every manager has touched their team inside the window.
                  </p>
                )}

                <Link href={hub.href} className="af-btn af-ch-open">
                  Open the commissioner hub
                </Link>
              </div>
            )}
          </StatePanel>
          </div>

          {/* Standings */}
          <StatePanel title="Standings" state={data.standings}>
            {(rows) => (
              <div className="af-standings-wrap">
                {/*
                  Column heads, because three numeric columns without them is a
                  guessing game. FAAB rather than "waiver": this league bids,
                  it does not queue, and the two words describe opposite systems.
                */}
                <div className="af-standings-head" aria-hidden>
                  <span />
                  <span />
                  <span className="af-label">W-L</span>
                  <span className="af-label">PF</span>
                  <span className="af-label">FAAB</span>
                </div>
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
                      <span className="af-standings-pf af-num">{Math.round(t.pointsFor)}</span>
                      {/*
                        ⚠ A DASH, NOT $0, WHEN WE DO NOT KNOW. The importer stores
                        null whenever it could not compute budget minus spend, and
                        a league that does not use FAAB stores null for everyone.
                        "$0" would tell a manager holding a full budget that they
                        are broke.
                      */}
                      <span className="af-standings-faab af-num">
                        {t.faabRemaining == null ? '\u2014' : `$${t.faabRemaining}`}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </StatePanel>
        </div>

        <aside className="af-lh-side">
          {/*
            ── Ask Chimmy ───────────────────────────────────────────────
            The handoff's open item resolves here: the screenshot label reads
            CHIMMY INTELLIGENCE, ship it as ASK CHIMMY to match the rest of the
            product.

            ⚠ THIS CARD SAID THE LINEUP AND MATCHUP READS "ARE NOT INGESTED FOR
            THIS LEAGUE", AND THAT STOPPED BEING TRUE. The panel it was pointing
            at is now the scoreboard, which resolves every game in the week and
            prices both lineups under the league's own scoring. Repeating the
            old sentence beneath a working scoreboard is the same failure as the
            buzz panel blaming the data for a query nobody had written.

            So the card now offers the question when there is something to
            reason about, and says what is missing when there is not.
          */}
          <Panel title="Ask Chimmy" help={<span className="af-lh-scope">This league only</span>}>
            {data.scoreboard.available ? (
              <>
                <p className="af-lh-chimmy-note">
                  Chimmy reasons about this league only from here — this week&rsquo;s games,
                  your lineup and the league&rsquo;s own scoring.
                </p>
                <button
                  type="button"
                  className="af-btn af-lh-ask"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent(COMMS_OPEN_EVENT, {
                        detail: {
                          tab: 'chimmy',
                          // Seeded, never sent — see the note on COMMS_OPEN_EVENT.
                          prefill: `Walk me through week ${data.scoreboard.available ? data.scoreboard.data.week : ''} in ${league.name}: which matchups are closest, who is most likely to be upset, and what should I be watching in my own game?`,
                        },
                      }),
                    )
                  }
                >
                  Ask about this week
                </button>
              </>
            ) : (
              <p className="af-lh-chimmy-note">
                Chimmy reasons about this league only from here. {data.scoreboard.reason} — so
                there is nothing to reason about this week yet.
              </p>
            )}
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
                    <span className="af-buzz-body">
                      <span className="af-buzz-line">
                        <span className="af-buzz-actor">{b.actor}</span>
                        <span className="af-buzz-text">{b.text}</span>
                        {/*
                          The bid, only when the provider recorded one. Rows
                          written before the emitter carried it have bid === null
                          and show nothing at all -- an unrecorded bid and a $0
                          bid are different facts, and $0 is a real, common bid.
                        */}
                        {b.bid != null ? <span className="af-buzz-bid">${b.bid}</span> : null}
                      </span>
                      {/*
                        Faces for who moved. The sentence above already names
                        them; this is so a claim is recognisable before it is
                        read. Capped at five so a twelve-player trade does not
                        push the rest of the feed off the panel.
                      */}
                      {b.players && b.players.length > 0 ? (
                        <span className="af-buzz-faces">
                          {b.players.slice(0, 5).map((pl) =>
                            pl.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={pl.id}
                                className="af-buzz-face"
                                src={pl.imageUrl}
                                alt={pl.name ?? ''}
                                title={pl.label}
                                width={26}
                                height={26}
                              />
                            ) : (
                              /*
                                No headshot on file. A labelled placeholder keeps
                                the row's shape and still says who it is on hover,
                                rather than silently dropping the player.
                              */
                              <span
                                key={pl.id}
                                className="af-buzz-face af-buzz-face--none"
                                title={pl.label}
                              >
                                {(pl.name ?? '?').charAt(0)}
                              </span>
                            ),
                          )}
                          {b.players.length > 5 ? (
                            <span className="af-buzz-more">+{b.players.length - 5}</span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
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
