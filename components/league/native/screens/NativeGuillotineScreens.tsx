'use client'

import { useEffect, useMemo, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { buildChopLine, tierLabel, type DangerTierRow } from '@/components/guillotine/guillotineHomeModel'
import { buildSurvivalTable } from '@/lib/guillotine/nativeGuillotineScreens'
import { Card, ScreenHead } from './NativeScreenParts'

/**
 * The Matchup and Standings tabs of a guillotine league (see lib/guillotine/nativeGuillotineScreens.ts).
 * Both read the Guilly tab's own summary, so the chop line here is the one drawn there.
 */

type Summary = {
  weekOrPeriod: number
  myRosterId?: string | null
  dangerTiers?: DangerTierRow[]
  survivalStandings?: Array<{ rosterId: string; displayName?: string; rank: number; seasonPointsCumul: number }>
  chopWatch?: { live: true; week: number; chopCount: number; chopLine: number | null } | null
  home?: {
    scores?: Record<string, number>
    teamCount?: number
    aliveCount?: number
    chopLabel?: string | null
    chopped?: Array<{ rosterId: string; name: string; week: number | null; points: number | null }>
  } | null
  config?: { eliminationStartWeek?: number; eliminationEndWeek?: number | null } | null
}

type Load = { summary: Summary | null; loading: boolean; error: string | null }

function useGuillotineSummary(leagueId: string): Load {
  const [state, setState] = useState<Load>({ summary: null, loading: true, error: null })
  useEffect(() => {
    const ac = new AbortController()
    setState({ summary: null, loading: true, error: null })
    void (async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`, { signal: ac.signal, cache: 'no-store' })
        if (!res.ok) throw new Error()
        setState({ summary: (await res.json()) as Summary, loading: false, error: null })
      } catch {
        if (!ac.signal.aborted) setState({ summary: null, loading: false, error: 'We could not load the chop line. Please retry.' })
      }
    })()
    return () => ac.abort()
  }, [leagueId])
  return state
}

const pts = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—')

/** Matchup tab: there is no opponent, so this is the week's scores against the chop line. */
export function GuillotineMatchupScreen({ league, onSelectTab }: { league: UserLeague; onSelectTab: (id: string) => void }) {
  const { summary, loading, error } = useGuillotineSummary(league.id)
  const line = useMemo(() => buildChopLine(summary?.dangerTiers, summary?.myRosterId, summary?.home?.scores), [summary])
  const week = summary?.chopWatch?.week ?? summary?.weekOrPeriod ?? null
  const chops = summary?.chopWatch?.chopCount ?? 1
  const scored = line.rows.some((r) => r.points != null)
  const me = line.me
  return (
    <div className="nls" data-testid="native-guillotine-matchup">
      <ScreenHead
        eyebrow={`${league.name} · Matchup`}
        title={week ? `Week ${week} · The chop` : 'The chop'}
        sub="There is no head-to-head in a guillotine league. Every team plays the whole field, and the lowest score is chopped."
      />
      {error ? <p className="nls-error" role="alert">{error}</p> : null}
      {me && scored ? (
        <p className="nls-gl-me" data-tier={me.tier} data-testid="guillotine-my-margin">
          {me.tier === 'chop_zone'
            ? `You are in the chop zone with ${pts(me.points)}.`
            : `You are ${me.margin.toFixed(1)} above the chop line with ${pts(me.points)}.`}
        </p>
      ) : null}
      <section className="nls-card nls-card-flush" aria-label="This week against the chop line">
        <h3 className="nls-label nls-card-head">
          {line.alive ? `${line.alive} teams alive` : 'This week'}
          {chops !== 1 ? ` · ${chops === 0 ? 'no chop this week' : `${chops} chopped this week`}` : ''}
        </h3>
        {loading ? (
          <p className="nls-empty">Loading the chop line…</p>
        ) : line.rows.length === 0 ? (
          <p className="nls-empty" data-testid="guillotine-matchup-empty">The chop line appears once the season has started.</p>
        ) : (
          <ul className="nls-rows nls-gl-rows">
            {line.rows.map((r) => (
              <li key={r.rosterId} data-cut={r.cutAbove || undefined}>
                {r.cutAbove ? <div className="nls-gl-cut" data-testid="guillotine-chop-line"><span>Chop line</span></div> : null}
                <div className="nls-gl-row" data-tier={r.tier} data-me={r.isMe || undefined} data-testid={`guillotine-row-${r.rosterId}`}>
                  <span className="nls-gl-rank">{r.rank}</span>
                  <span className="nls-gl-name">
                    <strong>{r.name}{r.isMe ? <em> you</em> : null}</strong>
                    <small>{r.immune ? 'Immune this week' : tierLabel(r.tier)}{scored && r.tier !== 'chop_zone' ? ` · +${r.margin.toFixed(1)}` : ''}</small>
                  </span>
                  <span className="nls-gl-pts">{pts(r.points)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!loading && line.rows.length > 0 && !scored ? <p className="nls-table-note">Scores appear here once this week&rsquo;s games start.</p> : null}
        <div className="nls-card-foot">
          <span className="nls-muted nls-mono">{summary?.home?.chopLabel ? `Chop after stat corrections · ${summary.home.chopLabel}` : 'Chop after stat corrections'}</span>
          <span className="nls-actions">
            <button type="button" className="nls-btn" onClick={() => onSelectTab('guillotine')}>Open Guilly</button>
            <button type="button" className="nls-btn" onClick={() => onSelectTab('roster')}>Edit my lineup</button>
          </span>
        </div>
      </section>
    </div>
  )
}

/** Standings tab: who is still in, by season points, then who has been chopped and when. */
export function GuillotineStandingsScreen({ league, onSelectTab }: { league: UserLeague; onSelectTab: (id: string) => void }) {
  const { summary, loading, error } = useGuillotineSummary(league.id)
  const table = useMemo(() => buildSurvivalTable(summary ?? {}), [summary])
  const anySeason = table.alive.some((r) => r.seasonPoints != null)
  return (
    <div className="nls" data-testid="native-guillotine-standings">
      <ScreenHead
        eyebrow={`${league.name} · Standings`}
        title="Survival standings"
        sub={`${table.alive.length} alive${table.chopped.length ? ` · ${table.chopped.length} chopped` : ''}. A guillotine league has no wins, losses or playoffs: the last team standing wins.`}
      />
      {error ? <p className="nls-error" role="alert">{error}</p> : null}
      <section className="nls-card nls-card-flush" aria-label="Teams still alive">
        <h3 className="nls-label nls-card-head">Still alive</h3>
        {loading ? (
          <p className="nls-empty">Loading standings…</p>
        ) : table.alive.length === 0 ? (
          <p className="nls-empty" data-testid="guillotine-standings-empty">Standings appear once the season has started.</p>
        ) : (
          <table className="nls-table">
            <thead>
              <tr><th data-align="left">#</th><th data-align="left">Team</th><th>This week</th><th>Season</th></tr>
            </thead>
            <tbody>
              {table.alive.map((r) => (
                <tr key={r.rosterId} data-viewer={r.isMe || undefined} data-testid={`guillotine-alive-${r.rosterId}`}>
                  <td data-align="left">{r.rank}</td>
                  <td data-align="left">{r.name}</td>
                  <td>{pts(r.weekPoints)}</td>
                  <td>{pts(r.seasonPoints)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && table.alive.length > 0 && !anySeason ? <p className="nls-table-note">Season totals appear after the first week is chopped.</p> : null}
      </section>
      {table.chopped.length > 0 ? (
        <Card label="Chopped" flush>
          <table className="nls-table" data-testid="guillotine-chopped-table">
            <thead>
              <tr><th data-align="left">Team</th><th>Week</th><th>Score</th></tr>
            </thead>
            <tbody>
              {table.chopped.map((r) => (
                <tr key={r.rosterId} data-viewer={r.isMe || undefined}>
                  <td data-align="left">{r.name}</td>
                  <td>{r.week ?? '—'}</td>
                  <td>{pts(r.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      <div className="nls-actions">
        <button type="button" className="nls-btn" onClick={() => onSelectTab('guillotine')}>Open Guilly</button>
      </div>
    </div>
  )
}
