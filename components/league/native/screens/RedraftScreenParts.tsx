'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { resolveRedraftIdentity, type RedraftIdentity } from '@/lib/league-media/redraftIdentity'
import {
  MATCHUP_STATE_LABEL,
  type BracketColumn,
  type FaabMeter,
  type RedraftGameState,
  type TradeDeadlineState,
  sideGameCounts,
  tradeDeadlineLabel,
} from '@/lib/league-media/redraftScreens'
import { fmt1, formatRecord, initialsOf } from '@/lib/league/native/nativeScreenModels'
import type { MatchupCenterPayload } from '@/lib/matchup-center/types'
import './redraft-native-screens.css'

/**
 * Redraft native screens (batch A2): the pieces only a redraft league renders. Every screen asks
 * `useRedraftScreen(league)`; `null` means "not a redraft league" and the screen renders exactly as
 * before. The CSS (redraft-native-screens.css) is scoped to the workspace's `data-format=redraft`
 * as well, so the two gates agree: the markup appears only where its styles apply.
 */
const RedraftScreenContext = createContext<RedraftIdentity | null>(null)

/** The league's redraft identity, or null for every other format (and for an unthemed sport). */
export function useRedraftScreen(league: Pick<UserLeague, 'platform' | 'sport' | 'leagueType' | 'leagueVariant' | 'isDynasty' | 'bestBallMode' | 'guillotineMode' | 'keeperPhaseActive'>): RedraftIdentity | null {
  const { platform, sport, leagueType, leagueVariant, isDynasty, bestBallMode, guillotineMode, keeperPhaseActive } = league
  return useMemo(
    () => resolveRedraftIdentity({ platform, sport, leagueType, leagueVariant, isDynasty, bestBallMode, guillotineMode, keeperPhaseActive }),
    [platform, sport, leagueType, leagueVariant, isDynasty, bestBallMode, guillotineMode, keeperPhaseActive],
  )
}

/** Puts the identity where PosPill can read it, and marks the screen for the capture script. */
export function RedraftScreen({ identity, children }: { identity: RedraftIdentity | null; children: ReactNode }) {
  return <RedraftScreenContext.Provider value={identity}>{children}</RedraftScreenContext.Provider>
}

export function useRedraftScreenContext(): RedraftIdentity | null {
  return useContext(RedraftScreenContext)
}

/** A small mono badge beside a player name: bye week, off day, or a claim / trade state. */
export function RedraftBadge({ tone, children, testId }: { tone?: string; children: ReactNode; testId?: string }) {
  return (
    <span className="nls-rd-badge" data-tone={tone} data-testid={testId}>
      {children}
    </span>
  )
}

/* ── Matchup ───────────────────────────────────────────────────────────────────────────────────── */

function countsLine(slots: MatchupCenterPayload['left']['starters']): string | null {
  const c = sideGameCounts(slots)
  const bits = [c.live ? `${c.live} playing` : null, c.final ? `${c.final} done` : null, c.upcoming ? `${c.upcoming} to play` : null].filter(Boolean)
  return bits.length ? bits.join(' · ') : null
}

/**
 * The broadcast score bug. Every number is the matchup-center payload's own: totals, records, the
 * starters' game states, and the win probability — which is dropped (not estimated) when the payload
 * has none, and the projected line is dropped when either side's projection used a fallback.
 */
export function RedraftScoreBug({ payload, week }: { payload: MatchupCenterPayload; week: number }) {
  const { left, right } = payload
  const state: RedraftGameState = payload.matchupStatus
  const prob = payload.winProbabilityLeft
  const leftLeads = left.totalPoints > right.totalPoints
  const rightLeads = right.totalPoints > left.totalPoints
  const projected = !left.projectedTotalIncludesFallback && !right.projectedTotalIncludesFallback
  const side = (s: MatchupCenterPayload['left'], which: 'left' | 'right', lead: boolean) => {
    const line = countsLine(s.starters)
    return (
      <div className="nls-rd-bug-side" data-side={which}>
        <div className="nls-rd-bug-name">
          <span className="nls-avatar" aria-hidden>{initialsOf(s.teamName)}</span>
          <strong title={s.teamName}>{s.teamName}</strong>
        </div>
        <b className="nls-rd-bug-pts" data-lead={lead}>{s.totalPoints.toFixed(1)}</b>
        <small>
          {formatRecord(s.record)}
          {line ? ` · ${line}` : ''}
        </small>
      </div>
    )
  }
  return (
    <section className="nls-rd-bug" aria-label="Score" data-state={state} data-testid="redraft-score-bug">
      {payload.conceptOverlay ? <p className="nls-rd-bug-overlay">{payload.conceptOverlay}</p> : null}
      <div className="nls-rd-bug-top">
        <span>Week {week}</span>
        <span className="nls-rd-bug-state" data-state={state} data-testid="redraft-score-bug-state">
          {MATCHUP_STATE_LABEL[state]}
          {prob != null && state !== 'final' ? ` · ${Math.round(prob * 100)}% to win` : ''}
        </span>
      </div>
      <div className="nls-rd-bug-main" aria-label={`${left.teamName} ${left.totalPoints.toFixed(1)}, ${right.teamName} ${right.totalPoints.toFixed(1)}`}>
        {side(left, 'left', leftLeads)}
        <span className="nls-rd-bug-vs" aria-hidden>vs</span>
        {side(right, 'right', rightLeads)}
      </div>
      {prob != null && state !== 'final' ? (
        <div className="nls-rd-bug-meter">
          <div className="nls-probbar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prob * 100)} aria-label={`${left.teamName} win probability`}>
            <span style={{ width: `${(prob * 100).toFixed(1)}%` }} />
            <span />
          </div>
          <p>
            <span>
              AF win prob <b>{Math.round(prob * 100)}%</b>
            </span>
            {projected ? <span>Proj {fmt1(left.projectedTotal)} – {fmt1(right.projectedTotal)}</span> : null}
          </p>
        </div>
      ) : null}
    </section>
  )
}

/* ── Players & waivers ─────────────────────────────────────────────────────────────────────────── */

/** Claim type + FAAB budget + run time + priority, each cell dropped when its value is unknown. */
export function RedraftWaiverHeader({ claimType, faab, faabRemaining, runLabel, priority, teamCount }: { claimType: string | null; faab: FaabMeter | null; faabRemaining: number | null; runLabel: string | null; priority: number | null; teamCount: number | null | undefined }) {
  const cells: ReactNode[] = []
  if (claimType) cells.push(<div key="type"><dt>Claim type</dt><dd data-testid="redraft-waiver-claim-type">{claimType}</dd></div>)
  // A balance with no known budget is still real: show it, without the bar it cannot draw.
  if (!faab && faabRemaining != null) cells.push(<div key="faab"><dt>FAAB left</dt><dd className="nls-rd-faab" data-testid="redraft-waiver-faab">${faabRemaining}</dd></div>)
  if (faab)
    cells.push(
      <div key="faab">
        <dt>FAAB budget</dt>
        <dd className="nls-rd-faab" data-testid="redraft-waiver-faab">${faab.remaining}<small> / ${faab.budget}</small></dd>
        <span className="nls-rd-meter" role="meter" aria-label="FAAB left" aria-valuemin={0} aria-valuemax={faab.budget} aria-valuenow={Math.min(faab.budget, Math.max(0, faab.remaining))}><i style={{ width: `${faab.pct}%` }} /></span>
      </div>,
    )
  if (runLabel) cells.push(<div key="run"><dt>Next waiver run</dt><dd>{runLabel}</dd></div>)
  if (priority != null) cells.push(<div key="prio"><dt>Your priority</dt><dd>{priority}{teamCount ? <small> of {teamCount}</small> : null}</dd></div>)
  if (!cells.length) return null
  return (
    <dl className="nls-rd-wire" aria-label="Waiver settings" data-testid="redraft-waiver-header" style={{ gridTemplateColumns: cells.length < 4 ? `repeat(${cells.length}, minmax(0, 1fr))` : undefined }}>
      {cells}
    </dl>
  )
}

/* ── Trades ────────────────────────────────────────────────────────────────────────────────────── */

/** The trade deadline from settings, with how far through the window the league is when it can say. */
export function RedraftDeadlineBar({ state, currentWeek }: { state: TradeDeadlineState; currentWeek: number | null | undefined }) {
  const fill = state.kind === 'open' && currentWeek ? Math.round((currentWeek / state.week) * 100) : state.kind === 'final' || state.kind === 'passed' ? 100 : null
  return (
    <div className="nls-rd-deadline" data-state={state.kind} data-testid="redraft-trade-deadline" role="status">
      <strong>{tradeDeadlineLabel(state)}</strong>
      {fill != null ? (
        <span className="nls-rd-meter" aria-hidden>
          <i style={{ width: `${fill}%` }} />
        </span>
      ) : null}
      {state.kind === 'passed' ? <span>Trades are closed for the rest of the season.</span> : state.kind === 'final' ? <span>This is the last week to make a deal.</span> : null}
    </div>
  )
}

/* ── Standings & playoffs ──────────────────────────────────────────────────────────────────────── */

export function RedraftBracket({ columns }: { columns: BracketColumn[] }) {
  return (
    <div className="nls-rd-bracket" data-testid="redraft-playoff-bracket-view" aria-label="Playoff bracket">
      {columns.map(col => (
        <section key={col.id} className="nls-rd-round" aria-label={col.name}>
          <h4>{col.name}</h4>
          <ol>
            {col.games.map(g => (
              <li key={g.id} className="nls-rd-game" data-state={g.state} data-viewer={g.viewer || undefined}>
                {[g.home, ...(g.away ? [g.away] : [])].map((s, i) => (
                  <div key={i} className="nls-rd-slot" data-won={s.won || undefined} data-tbd={!s.name || undefined}>
                    <span>{s.seed ?? ''}</span>
                    <strong>{s.name ?? 'TBD'}</strong>
                    <b>{s.score != null ? fmt1(s.score) : ''}</b>
                  </div>
                ))}
                {g.bye ? <p className="nls-rd-game-bye">First-round bye</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
