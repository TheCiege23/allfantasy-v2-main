'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { OutlookLeague, SwingMatchup } from '@/lib/core-app/seasonOutlook'
import type { FreshnessMeta } from '@/lib/sports-os/freshness'
import type { StandingsLineups } from '@/lib/core-app/standingsLineups'
import { WeekLineupsTable } from '@/components/core-app/standings/WeekLineupsTable'
import { describeTeamOutlook, pct, rangeLabel, signedPts, band } from '@/lib/core-app/outlookCopy'
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
import { FirstPickExplainerBlock } from '@/components/scenario-explainer/WhatDoINeed'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { outlookText, seasonOutlookSentence } from '@/lib/core-app/outlookSpanish'
import { seasonOutlookLeagueMessages } from '@/lib/core-app/messages/seasonOutlookLeague'
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
 *
 * ── LANGUAGE ──────────────────────────────────────────────────────────────────
 * A live Spanish sweep (2026-10-05) found this whole screen English. Fixed copy lives in
 * `lib/core-app/messages/seasonOutlookLeague.ts`; the
 * loader's sentences go through `outlookText` (drivers, moves, flags, notes) and then the cross-league
 * page's own `seasonOutlookSentence` (what decides it, the attention reasons, the basis), so one
 * sentence is never translated two different ways on two screens.
 */

function useOutlookLanguage() {
  const { language } = useOptionalLanguage()
  const say = (english: string) => {
    const t = outlookText(english, language)
    return t !== english ? t : seasonOutlookSentence(english, language)
  }
  return { say }
}

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
  /**
   * Every team's lineup for this week, AF beside API. DISPLAY ONLY — the odds above are simulated
   * without AF and nothing here feeds them. Null draws no section.
   */
  lineups?: StandingsLineups | null
}

const TABS = [
  { key: 'path', label: 'tabPath' },
  { key: 'whatif', label: 'tabWhatif' },
  { key: 'moves', label: 'tabMoves' },
  { key: 'schedule', label: 'tabSchedule' },
  { key: 'roster', label: 'tabRoster' },
  { key: 'standings', label: 'tabStandings' },
  { key: 'basis', label: 'tabBasis' },
] as const

type TabKey = (typeof TABS)[number]['key']

const TAB_PARAM = 'so_tab'

function readTab(): TabKey | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get(TAB_PARAM)
  return TABS.some((t) => t.key === v) ? (v as TabKey) : null
}

export function SeasonOutlookLeague({ league, swing, basis, priorities = [], freshness = null, lineups = null }: SeasonOutlookLeagueProps) {
  const { say } = useOutlookLanguage()
  const m = useMessages(seasonOutlookLeagueMessages)
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
          <p className="af-sol-empty-t">{m.noTeamTitle}</p>
          <p className="af-sol-empty-b">
            {m.noTeamBody}
          </p>
        </div>
        <Standings league={league} lineups={lineups} />
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
            {m.forecastHeading(you.seed)}, {you.wins}–{you.losses}
            {you.ties ? `–${you.ties}` : ''}
          </h2>
          {/* Beside the heading, not in it: the section is labelled by it. */}
          <TopicTip topic="outlookPlayoffOdds" />
          <StatusPill status={you.status} />
          <span className="af-olk-g">
            {gamesFromCut == null
              ? ''
              : gamesFromCut > 0
                ? m.clearOfCut(gamesFromCut)
                : gamesFromCut === 0
                  ? m.levelWithCut
                  : m.backOfCut(Math.abs(gamesFromCut))}
            {league.weeksRemaining === 0
              ? m.regularSeasonOver
              : m.toPlay(league.weeksRemaining)}
          </span>
        </header>

        <div className="af-olk-odds-row">
          <OddsTile
            label="Playoffs"
            value={you.playoffPct}
            range={you.range?.playoff ?? null}
            sub={m.playoffsSub(league.playoffTeams, league.teams.length)}
          />
          {league.byeTeams > 0 ? (
            <OddsTile
              label={m.byeLabel}
              value={you.byePct}
              range={you.range?.bye ?? null}
              sub={m.byeSub(league.byeTeams)}
              tone="neutral"
            />
          ) : null}
          <OddsTile
            label={m.title}
            value={you.titlePct}
            range={you.range?.title ?? null}
            sub={m.titleSub}
            tone="neutral"
          />
          <OddsTile
            label={you.status === 'eliminated' ? m.eliminated : m.missPlayoffs}
            value={you.missPct}
            range={you.range ? { lo: 100 - you.range.playoff.hi, hi: 100 - you.range.playoff.lo } : null}
            sub={m.missSub}
            tone="invert"
          />
        </div>

        <p className="af-olk-decides">{say(league.whatDecidesIt)}</p>

        <div className="af-olk-hero-grid">
          <div className="af-olk-next">
            <h3 className="af-label">{m.nextAction}</h3>
            {topMove ? (
              <>
                <p className="af-olk-next-t">{say(topMove.title)}</p>
                <p className="af-olk-next-d">
                  {say(topMove.detail)}{' '}
                  <b className="af-num">
                    {signedPts(topMove.playoffDelta)} {m.playoffPts}
                  </b>
                </p>
                <Link className="af-btn af-olk-next-cta" href={topMove.href}>
                  {topMove.kind === 'lineup' ? m.setLineup : m.openWaivers}
                </Link>
              </>
            ) : swing ? (
              <>
                <p className="af-olk-next-t">
                  {m.winWeek(swing.week)}
                  {swing.opponentName ? m.againstOpponent(swing.opponentName) : ''}
                </p>
                <p className="af-olk-next-d">
                  {m.worthPrefix}
                  <b className="af-num">
                    {swing.swing.toFixed(0)} {m.points}
                  </b>
                  {m.swingOdds(pct(swing.ifWin), pct(swing.ifLose))}
                </p>
                <Link className="af-btn af-olk-next-cta" href={`/core/matchup?league=${encodeURIComponent(league.leagueId)}`}>
                  {m.openThatMatchup}
                </Link>
              </>
            ) : elsewhere[0] ? (
              <>
                <p className="af-olk-next-t">
                  {m.nothingHereElsewhere(elsewhere[0].leagueName)}
                </p>
                <p className="af-olk-next-d">{say(elsewhere[0].reason)}</p>
                <Link className="af-btn af-olk-next-cta" href={elsewhere[0].href}>
                  {m.open} {elsewhere[0].leagueName}
                </Link>
              </>
            ) : (
              <p className="af-olk-next-d">
                {m.nothingNeedsDecision}
              </p>
            )}
          </div>

          <div className="af-olk-drivebox">
            <h3 className="af-label">{m.whatMovesSeason}</h3>
            {focus ? (
              <DriverList drivers={focus.drivers} limit={3} />
            ) : (
              <p className="af-olk-empty">
                {m.driversLater}
              </p>
            )}
            {focus && focus.drivers.length > 0 ? (
              <p className="af-olk-note">
                {m.driversNote}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── The working ──────────────────────────────────────────────── */}
      <div className="af-olk-tabs" role="tablist" aria-label={m.tabsAria}>
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
            {m[t.label]}
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
              <p className="af-olk-empty">
                {m.tooFewWeeks}
              </p>
            )}
            {/* The #1 pick from the same simulated seasons (lib/scenario-explainer). Hidden when the league has no standings-based order. */}
            <FirstPickExplainerBlock leagueId={league.leagueId} />
          </>
        ) : tab === 'whatif' ? (
          focus ? (
            <OutlookScenarioPanel model={focus.scenario} />
          ) : (
            <p className="af-olk-empty">
              {m.whatIfsUnavailable}
            </p>
          )
        ) : tab === 'moves' ? (
          <>
            <h3 className="af-label">
              {m.recommendedMoves} <TopicTip topic="playoffPts" />
            </h3>
            {focus ? (
              <MoveList moves={focus.moves} />
            ) : (
              <p className="af-olk-empty">
                {m.movesUnavailable}
              </p>
            )}
            <p className="af-olk-note">
              {m.movesNote(focus ? focus.branchIterations : null)}
            </p>
            <h3 className="af-label">{m.everyFactor}</h3>
            {focus ? <DriverList drivers={focus.drivers} /> : null}
          </>
        ) : tab === 'schedule' ? (
          <SchedulePanel teams={league.teams} />
        ) : tab === 'roster' ? (
          focus?.durability ? (
            <DurabilityPanel d={focus.durability} />
          ) : (
            <p className="af-olk-empty">
              {focus?.scenario.refusal ?? focus?.notes[0]
                ? say((focus?.scenario.refusal ?? focus?.notes[0])!)
                : m.rosterRiskUnavailable}
            </p>
          )
        ) : tab === 'standings' ? (
          <Standings league={league} lineups={lineups} />
        ) : (
          <>
            <p className="af-sol-basis">{say(basis)}</p>
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
            <h2 className="af-label">{m.whereAttention}</h2>
            <span className="af-sol-attention-note">{m.attentionNote}</span>
          </header>
          <ul className="af-sol-attention-rows">
            {elsewhere.map((p) => (
              <li key={p.href}>
                <Link className="af-sol-attention-row" href={p.href}>
                  <span className="af-sol-attention-league">{p.leagueName}</span>
                  <span className="af-sol-attention-reason">{say(p.reason)}</span>
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
  const m = useMessages(seasonOutlookLeagueMessages)
  return (
    <header className="af-sol-head">
      <p className="af-label af-sol-eyebrow">{league.leagueName}</p>
      <div className="af-olk-titlerow">
        <h1 className="af-display af-sol-title">{m.seasonOutlookTitle}</h1>
        {freshness ? (
          <FreshnessChip meta={freshness.meta} initialLabel={freshness.initialLabel} initialWarn={freshness.initialWarn} />
        ) : null}
      </div>
      <p className="af-sol-sub">
        {m.seasonOutlookSub}
      </p>
    </header>
  )
}

function Clinch({ league, swing }: { league: OutlookLeague; swing: SwingMatchup | null }) {
  const m = useMessages(seasonOutlookLeagueMessages)
  if (!swing) {
    return (
      <section className="af-sol-clinch" data-empty="true">
        <h3 className="af-label">{m.howYouClinch}</h3>
        <p className="af-sol-clinch-why">
          {league.weeksRemaining === 0
            ? m.seasonOverClinch
            : m.noNextGame}
        </p>
      </section>
    )
  }
  return (
    <section className="af-sol-clinch">
      <header className="af-sol-clinch-head">
        <h3 className="af-label">
          {m.howYouClinch} <TopicTip topic="swingGame" />
        </h3>
        <span className="af-sol-clinch-note">
          {m.week} {swing.week}
          {swing.opponentName ? ` · vs ${swing.opponentName}` : ''}
        </span>
      </header>

      <div className="af-sol-branches">
        <div className="af-sol-branch" data-tone="good">
          <span className="af-label">{m.ifYouWin}</span>
          <span className="af-sol-branch-v af-num">{pct(swing.ifWin)}%</span>
          <p className="af-sol-branch-b">
            {swing.clinchOnWin
              ? m.clinchOnWin
              : m.notDecided}
          </p>
        </div>

        <div className="af-sol-branch" data-tone="bad">
          <span className="af-label">
            {m.ifYouLose} <TopicTip topic="clinchHelp" />
          </span>
          <span className="af-sol-branch-v af-num">{pct(swing.ifLose)}%</span>
          <p className="af-sol-branch-b">
            {/* An empty help list is a real finding — no one other result moves your odds enough. */}
            {swing.helpIfLose.length === 0
              ? m.noSingleRescue
              : swing.helpIfLose.length === 1
                ? m.needOne(swing.helpIfLose[0])
                : m.needTwo(swing.helpIfLose[0], swing.helpIfLose[1])}
          </p>
        </div>

        <div className="af-sol-branch" data-tone="accent">
          <span className="af-label">{m.swing}</span>
          <span className="af-sol-branch-v af-num">{swing.swing.toFixed(0)} pts</span>
          <p className="af-sol-branch-b">
            {m.swingNote}
          </p>
        </div>
      </div>

      <Link href={`/core/matchup?league=${encodeURIComponent(league.leagueId)}`} className="af-btn af-sol-clinch-cta">
        {m.openThatMatchup}
      </Link>
    </section>
  )
}

function Standings({ league, lineups }: { league: OutlookLeague; lineups: StandingsLineups | null }) {
  const { say } = useOutlookLanguage()
  const m = useMessages(seasonOutlookLeagueMessages)
  const showBye = league.byeTeams > 0
  return (
    <div className="af-sol-tablewrap">
      <table className="af-sol-table">
        <caption className="af-sol-caption">
          {m.standingsCaption(league.leagueName)}
        </caption>
        <thead>
          <tr>
            <th scope="col">{m.team}</th>
            <th scope="col" className="af-sol-n">
              {m.record}
            </th>
            <th scope="col" className="af-sol-n">
              {m.pointsFor}
            </th>
            <th scope="col" className="af-sol-n">
              Playoffs <TopicTip topic="outlookPlayoffOdds" />
            </th>
            {showBye ? (
              <th scope="col" className="af-sol-n">
                {m.bye}
              </th>
            ) : null}
            <th scope="col" className="af-sol-n">
              {m.title}
            </th>
            <th scope="col">
              {m.whatDecides} <TopicTip topic="whatDecidesIt" />
            </th>
          </tr>
        </thead>
        <tbody>
          {league.teams.map((t) => (
            <tr key={t.rosterId} data-you={t.isYou} data-cut={t.seed === league.playoffTeams}>
              <th scope="row">
                <span className="af-sol-seed af-num">{t.seed}</span>
                <span className="af-sol-name">{t.name ?? m.unnamedTeam}</span>
                {t.isYou ? <span className="af-sol-you af-label">{m.you}</span> : null}
              </th>
              <td className="af-sol-n af-num">
                {t.wins}—{t.losses}{t.ties ? `—${t.ties}` : ''}
              </td>
              <td className="af-sol-n af-num">{t.pointsFor.toFixed(1)}</td>
              {/* An unmodelled team showing "0%" would read as eliminated rather than as unknown. */}
              <td className="af-sol-n">
                {t.modelled ? (
                  <span
                    className="af-sol-pct"
                    data-band={band(t.playoffPct)}
                    title={t.range ? `${m.range} ${rangeLabel(t.range.playoff)}` : undefined}
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
              <td className="af-sol-decides">{say(describeTeamOutlook(t, league.weeksRemaining, league.playoffTeams))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lineups ? (
        <WeekLineupsTable lineups={lineups} caveat="the playoff and title odds above are simulated without AF." />
      ) : null}
    </div>
  )
}

export default SeasonOutlookLeague
