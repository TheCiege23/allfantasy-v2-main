'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { OutlookLeague, SwingMatchup } from '@/lib/core-app/seasonOutlook'
import type { FreshnessMeta } from '@/lib/sports-os/freshness'
import { describeTeamOutlook, ordinal, pct, rangeLabel, signedPts, band } from '@/lib/core-app/outlookCopy'
import { FreshnessChip } from '@/components/sports-os/FreshnessChip'
import {
  AssumptionsPanel,
  DriverList,
  DurabilityPanel,
  MilestonePanel,
  MoveList,
  OddsTile,
  SchedulePanel,
  StatusPill,
} from '@/components/core-app/outlook/OutlookParts'
import { OutlookScenarioPanel } from '@/components/core-app/outlook/OutlookScenarioPanel'
import '@/components/core-app/af-season-outlook-league.css'
import '@/components/core-app/af-outlook.css'

/**
 * Screen 38a·5 — Season Outlook, scoped to one league.
 *
 * ── THE LAYOUT IS THE MOBILE BRIEF ────────────────────────────────────────────
 * The forecast leads: your odds (playoffs, bye, title, missing out — each with its range), the next
 * action, and the three factors that move your season most. Everything else sits behind one tab row,
 * so a phone shows the answer first and the working second.
 *
 * ⚠ ALMOST NOTHING HERE IS NEW MATHS ON THE CLIENT. The odds, ranges, milestones, drivers and moves
 * all arrive computed. The one thing this file runs is the what-if panel, which calls the SAME pure
 * simulation the server used (`outlookSim.ts`).
 *
 * The clinch scenario's named help is a conditional probability out of the lose-branch simulation —
 * P(you make it | this rival misses) − P(you make it) — not a read of who sits next to you in the
 * table. Seeding depends on points for as well as record, so the team directly above you is
 * frequently NOT the one whose loss helps you most.
 */

export type SeasonOutlookLeagueProps = {
  league: OutlookLeague
  /** This league's own swing game. Null when the season has nothing left to swing. */
  swing: SwingMatchup | null
  /** Printed verbatim — a simulated number without its basis is a guess. */
  basis: string
  /** The cross-league attention ranking, shown here for the OTHER leagues. */
  priorities?: Array<{ leagueName: string; reason: string; href: string }>
  /** The board's age. Null when it was computed on this request. */
  freshness?: { meta: FreshnessMeta; initialLabel: string; initialWarn: boolean } | null
}

const TABS = [
  { key: 'path', label: 'Path to playoffs' },
  { key: 'whatif', label: 'What-if' },
  { key: 'moves', label: 'Moves & drivers' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'roster', label: 'Roster risk' },
  { key: 'standings', label: 'Standings' },
  { key: 'basis', label: 'Assumptions' },
] as const

type TabKey = (typeof TABS)[number]['key']

const TAB_PARAM = 'so_tab'

function readTab(): TabKey | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get(TAB_PARAM)
  return TABS.some((t) => t.key === v) ? (v as TabKey) : null
}

export function SeasonOutlookLeague({ league, swing, basis, priorities = [], freshness = null }: SeasonOutlookLeagueProps) {
  const you = league.you
  const focus = league.focus
  const [tab, setTab] = useState<TabKey>('path')
  const [nowMs, setNowMs] = useState<number | null>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  /* The tab lives in the URL so a reload or a shared link lands on it. Read after mount, so SSR agrees. */
  useEffect(() => {
    const initial = readTab()
    if (initial) setTab(initial)
    setNowMs(Date.now())
  }, [])

  const choose = (key: TabKey, focusIt = false) => {
    setTab(key)
    try {
      const url = new URL(window.location.href)
      if (key === 'path') url.searchParams.delete(TAB_PARAM)
      else url.searchParams.set(TAB_PARAM, key)
      window.history.replaceState(window.history.state, '', url)
    } catch {
      /* A URL we cannot rewrite only costs the deep link. */
    }
    if (focusIt) tabRefs.current[TABS.findIndex((t) => t.key === key)]?.focus()
  }

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1
    const next =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null
    if (next == null) return
    e.preventDefault()
    choose(TABS[next].key, true)
  }

  /* The attention ranking minus the league already on screen. */
  const elsewhere = priorities.filter((p) => p.leagueName !== league.leagueName).slice(0, 4)

  if (!you) {
    return (
      <div className="af-sol af-olk">
        <Header league={league} freshness={freshness} />
        <div className="af-sol-empty">
          <p className="af-sol-empty-t">We cannot tell which team is yours in this league.</p>
          <p className="af-sol-empty-b">
            Every number on this screen is about your position in the field, so none of it can be
            shown until the roster is matched to your account. The league&apos;s own standings are
            still below.
          </p>
        </div>
        <Standings league={league} />
      </div>
    )
  }

  const cutTeam = league.teams.find((t) => t.seed === league.playoffTeams) ?? null
  const gamesFromCut = cutTeam ? you.wins - cutTeam.wins : null
  const topMove = focus?.moves.find((m) => m.playoffDelta > 0) ?? null

  return (
    <div className="af-sol af-olk">
      <Header league={league} freshness={freshness} />

      {/* ── The forecast ─────────────────────────────────────────────── */}
      <section className="af-olk-hero" aria-labelledby="so-forecast">
        <header className="af-olk-hero-head">
          <h2 id="so-forecast" className="af-label">
            Your forecast · {ordinal(you.seed)} seed, {you.wins}–{you.losses}
          </h2>
          <StatusPill status={you.status} />
          <span className="af-olk-g">
            {gamesFromCut == null
              ? ''
              : gamesFromCut > 0
                ? `${gamesFromCut} clear of the cut · `
                : gamesFromCut === 0
                  ? 'level with the cut · '
                  : `${Math.abs(gamesFromCut)} back of the cut · `}
            {league.weeksRemaining === 0 ? 'regular season over' : `${league.weeksRemaining} to play`}
          </span>
        </header>

        <div className="af-olk-odds-row">
          <OddsTile
            label="Playoffs"
            value={you.playoffPct}
            range={you.range?.playoff ?? null}
            sub={`top ${league.playoffTeams} of ${league.teams.length}`}
          />
          {league.byeTeams > 0 ? (
            <OddsTile
              label="First-round bye"
              value={you.byePct}
              range={you.range?.bye ?? null}
              sub={`top ${league.byeTeams} seed${league.byeTeams === 1 ? '' : 's'}`}
              tone="neutral"
            />
          ) : null}
          <OddsTile label="Title" value={you.titlePct} range={you.range?.title ?? null} sub="win the bracket" tone="neutral" />
          <OddsTile
            label={you.status === 'eliminated' ? 'Eliminated' : 'Miss the playoffs'}
            value={you.missPct}
            range={you.range ? { lo: 100 - you.range.playoff.hi, hi: 100 - you.range.playoff.lo } : null}
            sub="season ends without a berth"
            tone="invert"
          />
        </div>

        <p className="af-olk-decides">{league.whatDecidesIt}</p>

        <div className="af-olk-hero-grid">
          <div className="af-olk-next">
            <h3 className="af-label">Next action</h3>
            {topMove ? (
              <>
                <p className="af-olk-next-t">{topMove.title}</p>
                <p className="af-olk-next-d">
                  {topMove.detail} <b className="af-num">{signedPts(topMove.playoffDelta)} playoff pts</b>
                </p>
                <Link className="af-btn af-olk-next-cta" href={topMove.href}>
                  {topMove.kind === 'lineup' ? 'Set your lineup' : 'Open waivers'}
                </Link>
              </>
            ) : swing ? (
              <>
                <p className="af-olk-next-t">
                  Win week {swing.week}
                  {swing.opponentName ? ` against ${swing.opponentName}` : ''}
                </p>
                <p className="af-olk-next-d">
                  It is worth <b className="af-num">{swing.swing.toFixed(0)} points</b> of playoff odds —{' '}
                  {pct(swing.ifWin)}% with a win, {pct(swing.ifLose)}% with a loss.
                </p>
                <Link className="af-btn af-olk-next-cta" href={`/core/matchup?league=${encodeURIComponent(league.leagueId)}`}>
                  Open that matchup
                </Link>
              </>
            ) : elsewhere[0] ? (
              <>
                <p className="af-olk-next-t">Nothing here needs you — {elsewhere[0].leagueName} does.</p>
                <p className="af-olk-next-d">{elsewhere[0].reason}</p>
                <Link className="af-btn af-olk-next-cta" href={elsewhere[0].href}>
                  Open {elsewhere[0].leagueName}
                </Link>
              </>
            ) : (
              <p className="af-olk-next-d">Nothing in this league needs a decision right now.</p>
            )}
          </div>

          <div className="af-olk-drivebox">
            <h3 className="af-label">What moves your season most</h3>
            {focus ? (
              <DriverList drivers={focus.drivers} limit={3} />
            ) : (
              <p className="af-olk-empty">Drivers are worked out when this league is open on its own.</p>
            )}
            {focus && focus.drivers.length > 0 ? (
              <p className="af-olk-note">Points of playoff probability, against a league-average version of each factor.</p>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── The working ──────────────────────────────────────────────── */}
      <div className="af-olk-tabs" role="tablist" aria-label="Season Outlook detail">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`so-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="so-panel"
            tabIndex={tab === t.key ? 0 : -1}
            className="af-olk-tab"
            onClick={() => choose(t.key)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="so-panel" role="tabpanel" aria-labelledby={`so-tab-${tab}`} className="af-olk-panel" tabIndex={0}>
        {tab === 'path' ? (
          <>
            <Clinch league={league} swing={swing} />
            {league.milestones ? (
              <MilestonePanel m={league.milestones} playoffTeams={league.playoffTeams} />
            ) : (
              <p className="af-olk-empty">Your team has too few completed weeks to project a record.</p>
            )}
          </>
        ) : tab === 'whatif' ? (
          focus ? (
            <OutlookScenarioPanel model={focus.scenario} />
          ) : (
            <p className="af-olk-empty">What-ifs could not be prepared for this league just now.</p>
          )
        ) : tab === 'moves' ? (
          <>
            <h3 className="af-label">Recommended moves</h3>
            {focus ? (
              <MoveList moves={focus.moves} />
            ) : (
              <p className="af-olk-empty">Moves could not be prepared for this league just now.</p>
            )}
            <p className="af-olk-note">
              Each move is simulated against the same season with and without it
              {focus ? `, ${focus.branchIterations.toLocaleString('en-US')} times each` : ''}. Trades are not suggested
              here — try one in What-if.
            </p>
            <h3 className="af-label">Every factor we measured</h3>
            {focus ? <DriverList drivers={focus.drivers} /> : null}
          </>
        ) : tab === 'schedule' ? (
          <SchedulePanel teams={league.teams} />
        ) : tab === 'roster' ? (
          focus?.durability ? (
            <DurabilityPanel d={focus.durability} />
          ) : (
            <p className="af-olk-empty">
              {focus?.scenario.refusal ?? focus?.notes[0] ?? 'Roster risk could not be read for this league.'}
            </p>
          )
        ) : tab === 'standings' ? (
          <Standings league={league} />
        ) : (
          <>
            <p className="af-sol-basis">{basis}</p>
            <AssumptionsPanel
              a={league.assumptions}
              nowMs={nowMs}
              extra={{
                branchIterations: focus?.branchIterations,
                basisWeek: focus?.scenario.basisWeek ?? null,
                notes: focus?.notes,
              }}
            />
          </>
        )}
      </div>

      {elsewhere.length > 0 ? (
        <section className="af-sol-attention">
          <header className="af-sol-attention-head">
            <h2 className="af-label">Where to spend your attention</h2>
            <span className="af-sol-attention-note">your other leagues, most urgent first</span>
          </header>
          <ul className="af-sol-attention-rows">
            {elsewhere.map((p) => (
              <li key={p.href}>
                <Link className="af-sol-attention-row" href={p.href}>
                  <span className="af-sol-attention-league">{p.leagueName}</span>
                  <span className="af-sol-attention-reason">{p.reason}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function Header({
  league,
  freshness,
}: {
  league: OutlookLeague
  freshness: SeasonOutlookLeagueProps['freshness']
}) {
  return (
    <header className="af-sol-head">
      <p className="af-label af-sol-eyebrow">{league.leagueName}</p>
      <div className="af-olk-titlerow">
        <h1 className="af-display af-sol-title">Season Outlook</h1>
        {freshness ? (
          <FreshnessChip meta={freshness.meta} initialLabel={freshness.initialLabel} initialWarn={freshness.initialWarn} />
        ) : null}
      </div>
      <p className="af-sol-sub">
        Playoff, bye and title odds, simulated against this league&apos;s own schedule, scoring and
        playoff field — not a generic model.
      </p>
    </header>
  )
}

function Clinch({ league, swing }: { league: OutlookLeague; swing: SwingMatchup | null }) {
  if (!swing) {
    return (
      <section className="af-sol-clinch" data-empty="true">
        <h3 className="af-label">How you clinch</h3>
        <p className="af-sol-clinch-why">
          {league.weeksRemaining === 0
            ? 'The regular season is over in this league — there is nothing left to clinch.'
            : 'We could not find your next unplayed game in this league, so there is no single result to branch on.'}
        </p>
      </section>
    )
  }
  return (
    <section className="af-sol-clinch">
      <header className="af-sol-clinch-head">
        <h3 className="af-label">How you clinch</h3>
        <span className="af-sol-clinch-note">
          Week {swing.week}
          {swing.opponentName ? ` · vs ${swing.opponentName}` : ''}
        </span>
      </header>

      <div className="af-sol-branches">
        <div className="af-sol-branch" data-tone="good">
          <span className="af-label">If you win</span>
          <span className="af-sol-branch-v af-num">{pct(swing.ifWin)}%</span>
          <p className="af-sol-branch-b">
            {swing.clinchOnWin
              ? 'You are in. Win this and the rest is about seeding.'
              : 'Still not decided, but this is the single biggest move available to you.'}
          </p>
        </div>

        <div className="af-sol-branch" data-tone="bad">
          <span className="af-label">If you lose</span>
          <span className="af-sol-branch-v af-num">{pct(swing.ifLose)}%</span>
          <p className="af-sol-branch-b">
            {/* An empty help list is a real finding — no one other result moves your odds enough. */}
            {swing.helpIfLose.length === 0
              ? 'No single other result rescues this — you would need the run of play to go your way across several games, not one.'
              : swing.helpIfLose.length === 1
                ? `You would need ${swing.helpIfLose[0]} to miss out too. That one absence lifts your odds more than any other result on the board.`
                : `You would need ${swing.helpIfLose[0]} or ${swing.helpIfLose[1]} to miss out too — those two absences move your number more than anything else you do not control.`}
          </p>
        </div>

        <div className="af-sol-branch" data-tone="accent">
          <span className="af-label">Swing</span>
          <span className="af-sol-branch-v af-num">{swing.swing.toFixed(0)} pts</span>
          <p className="af-sol-branch-b">of playoff probability rest on this one result.</p>
        </div>
      </div>

      <Link href={`/core/matchup?league=${encodeURIComponent(league.leagueId)}`} className="af-btn af-sol-clinch-cta">
        Open that matchup
      </Link>
    </section>
  )
}

function Standings({ league }: { league: OutlookLeague }) {
  const showBye = league.byeTeams > 0
  return (
    <div className="af-sol-tablewrap">
      <table className="af-sol-table">
        <caption className="af-sol-caption">
          Every team in {league.leagueName}, ordered by current seed. The line marks the playoff cut.
          Hover a playoff figure for its range.
        </caption>
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col" className="af-sol-n">
              Record
            </th>
            <th scope="col" className="af-sol-n">
              Points for
            </th>
            <th scope="col" className="af-sol-n">
              Playoffs
            </th>
            {showBye ? (
              <th scope="col" className="af-sol-n">
                Bye
              </th>
            ) : null}
            <th scope="col" className="af-sol-n">
              Title
            </th>
            <th scope="col">What decides it</th>
          </tr>
        </thead>
        <tbody>
          {league.teams.map((t) => (
            <tr key={t.rosterId} data-you={t.isYou} data-cut={t.seed === league.playoffTeams}>
              <th scope="row">
                <span className="af-sol-seed af-num">{t.seed}</span>
                <span className="af-sol-name">{t.name ?? 'Unnamed team'}</span>
                {t.isYou ? <span className="af-sol-you af-label">You</span> : null}
              </th>
              <td className="af-sol-n af-num">
                {t.wins}—{t.losses}
              </td>
              <td className="af-sol-n af-num">{t.pointsFor.toFixed(1)}</td>
              {/* An unmodelled team showing "0%" would read as eliminated rather than as unknown. */}
              <td className="af-sol-n">
                {t.modelled ? (
                  <span
                    className="af-sol-pct"
                    data-band={band(t.playoffPct)}
                    title={t.range ? `Range ${rangeLabel(t.range.playoff)}` : undefined}
                  >
                    {pct(t.playoffPct)}%
                  </span>
                ) : (
                  <span className="af-sol-pct" data-band="none">
                    —
                  </span>
                )}
              </td>
              {showBye ? <td className="af-sol-n af-num">{t.modelled ? `${pct(t.byePct)}%` : '—'}</td> : null}
              <td className="af-sol-n">
                {t.modelled ? (
                  <span className="af-sol-pct" data-band={band(t.titlePct)}>
                    {pct(t.titlePct)}%
                  </span>
                ) : (
                  <span className="af-sol-pct" data-band="none">
                    —
                  </span>
                )}
              </td>
              <td className="af-sol-decides">{describeTeamOutlook(t, league.weeksRemaining, league.playoffTeams)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default SeasonOutlookLeague
