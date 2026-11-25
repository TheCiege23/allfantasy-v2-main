'use client'

import { useEffect, useMemo, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import type { DangerTierRow } from '@/components/guillotine/guillotineHomeModel'
import { GuillySurvivalBoard } from '@/components/guillotine/GuillySurvivalBoard'
import { boardFromNativeSummary } from '@/lib/guillotine/survivalBoardModel'
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
  /** The league's calendar week; behind the chop week before chops start (lib/guillotine/survivalBoardModel.ts). */
  calendarWeek?: number | null
}

type Load = { summary: Summary | null; loading: boolean; error: string | null }

function useGuillotineSummary(leagueId: string, opts: { outlook?: boolean } = {}): Load {
  const [state, setState] = useState<Load>({ summary: null, loading: true, error: null })
  useEffect(() => {
    const ac = new AbortController()
    setState({ summary: null, loading: true, error: null })
    void (async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary${opts.outlook ? '?outlook=1' : ''}`, { signal: ac.signal, cache: 'no-store' })
        if (!res.ok) throw new Error()
        setState({ summary: (await res.json()) as Summary, loading: false, error: null })
      } catch {
        if (!ac.signal.aborted) setState({ summary: null, loading: false, error: 'We could not load the chop line. Please retry.' })
      }
    })()
    return () => ac.abort()
  }, [leagueId, opts.outlook])
  return state
}

const pts = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—')

/**
 * Matchup tab: there is no opponent. It is you against the whole league, scored against the chop line
 * (components/guillotine/GuillySurvivalBoard.tsx — the same board an imported Guilly league shows).
 */
export function GuillotineMatchupScreen({ league, onSelectTab }: { league: UserLeague; onSelectTab: (id: string) => void }) {
  const { summary, loading, error } = useGuillotineSummary(league.id, { outlook: true })
  const board = useMemo(() => (summary ? boardFromNativeSummary(summary) : null), [summary])
  const alive = board?.status !== 'chopped' && board?.status !== 'spectator'
  return (
    <div className="nls" data-testid="native-guillotine-matchup">
      <GuillySurvivalBoard
        board={board}
        loading={loading}
        error={error}
        actions={[
          ...(alive ? [{ label: 'Set my lineup', onClick: () => onSelectTab('roster'), primary: true }] : []),
          { label: 'Guilly hub', onClick: () => onSelectTab('guillotine') },
        ]}
      />
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
