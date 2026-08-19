'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupportedSport } from '@/lib/sport-scope'

type SubTab = 'lineup' | 'roster' | 'contest' | 'history'

type BestBallApiResponse = {
  league: {
    id: string
    name: string
    sport: string
    season: number
    summary: string
    settings: {
      mode: 'standard' | 'underdog'
      draftMode: string
      contestStructure: string
      matchupFormat: string
      waiversEnabled: boolean
      tradesEnabled: boolean
      substitutionsEnabled: boolean
      playoffTeams: number
    }
    profile: {
      label: string
      scoringPeriod: string
      recommendedRosterSize: number
      lineupSlots: Array<{ code: string; count: number }>
      notes: string[]
    }
  }
  selectedWeek: number
  weeksAvailable: number[]
  lineups: Array<{
    rosterId: string
    teamName: string
    totalPoints: number
    winLoss: string | null
    starters: Array<{ playerId: string; name: string; position: string; team: string | null; points: number; slot: string | null }>
    bench: Array<{ playerId: string; name: string; position: string; team: string | null; points: number }>
  }>
  rosterComposition: Array<{ rosterId: string; teamName: string; playerCount: number }>
  standings: Array<{ rosterId: string; rank: number | null; teamName: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }>
  history: Array<{ rosterId: string; week: number; totalPoints: number }>
}

export type BestBallTabProps = {
  leagueId: string
  sport: SupportedSport | string
}

export function BestBallTab({ leagueId, sport }: BestBallTabProps) {
  const [sub, setSub] = useState<SubTab>('lineup')
  const [week, setWeek] = useState(1)
  const [data, setData] = useState<BestBallApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/bestball?week=${week}`, {
          cache: 'no-store',
        })
        const json = (await res.json()) as BestBallApiResponse | { error?: string }
        if (!res.ok) {
          const message =
            typeof json === 'object' && json !== null && 'error' in json && typeof json.error === 'string'
              ? json.error
              : 'Failed to load Best Ball data'
          throw new Error(message)
        }
        if (!cancelled) {
          setData(json as BestBallApiResponse)
          setWeek((current) => (current === week ? (json as BestBallApiResponse).selectedWeek : current))
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load Best Ball data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [leagueId, week])

  const historyByRoster = useMemo(() => {
    const map = new Map<string, Array<{ week: number; totalPoints: number }>>()
    for (const row of data?.history ?? []) {
      const list = map.get(row.rosterId) ?? []
      list.push({ week: row.week, totalPoints: row.totalPoints })
      map.set(row.rosterId, list)
    }
    return map
  }, [data])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 text-[#e6edf3]">
      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {(['lineup', 'roster', 'contest', 'history'] as const).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`bestball-sub-${id}`}
            onClick={() => setSub(id)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
              sub === id ? 'bg-[#ff3d81]/20 text-[#ffb8d1]' : 'bg-white/5 text-white/50 hover:text-white/80'
            }`}
          >
            {id === 'lineup' ? 'Optimized Lineups' : id.charAt(0).toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/45">
        <span>Sport: {String(sport)}</span>
        <span className="text-white/25">|</span>
        <label className="flex items-center gap-1">
          Week
          <select
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
            className="rounded border border-white/15 bg-[#0a1228] px-2 py-1 text-white"
          >
            {(data?.weeksAvailable?.length ? data.weeksAvailable : [week]).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {data?.league ? <span className="rounded-full border border-[#ff3d81]/20 bg-[#ff3d81]/10 px-2 py-1 text-[11px] text-[#ffd7e5]">{data.league.summary}</span> : null}
      </div>

      {loading ? <div className="rounded-xl border border-white/10 bg-[#0a1228]/60 p-4 text-sm text-white/60">Loading Best Ball data...</div> : null}
      {error ? <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}

      {!loading && !error && data && sub === 'lineup' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.lineups.map((lineup) => (
            <article key={lineup.rosterId} className="rounded-xl border border-white/10 bg-[#0a1228]/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">{lineup.teamName}</h2>
                  <p className="text-[11px] text-white/45">
                    {lineup.winLoss ? `Week ${data.selectedWeek} | ${lineup.winLoss}` : `Week ${data.selectedWeek} | cumulative`}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-[#ffb8d1]">{lineup.totalPoints.toFixed(2)}</div>
                  <div className="text-[11px] text-white/40">{lineup.starters.length} optimized starters</div>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {lineup.starters.map((starter) => (
                  <div key={starter.playerId} className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-xs">
                    <div>
                      <div className="font-medium text-white">{starter.name}</div>
                      <div className="text-white/45">
                        {starter.slot ?? starter.position} | {starter.position}
                        {starter.team ? ` | ${starter.team}` : ''}
                      </div>
                    </div>
                    <div className="font-semibold text-[#ffd7e5]">{starter.points.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && !error && data && sub === 'roster' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.rosterComposition.map((roster) => (
            <article key={roster.rosterId} className="rounded-xl border border-white/10 bg-[#0a1228]/70 p-4">
              <h2 className="text-sm font-semibold text-white">{roster.teamName}</h2>
              <p className="mt-1 text-xs text-white/45">{roster.playerCount} drafted players</p>
              <p className="mt-3 text-xs text-white/60">
                Recommended roster size: {data.league.profile.recommendedRosterSize}. Best Ball automatically optimizes legal starters every {data.league.profile.scoringPeriod} scoring period.
              </p>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && !error && data && sub === 'contest' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-[#0a1228]/80 p-4">
            <h2 className="text-sm font-semibold text-white">League Rules</h2>
            <div className="mt-3 space-y-2 text-xs text-white/60">
              <p>Mode: <span className="text-white">{data.league.settings.mode}</span></p>
              <p>Draft mode: <span className="text-white">{data.league.settings.draftMode}</span></p>
              <p>Contest structure: <span className="text-white">{data.league.settings.contestStructure}</span></p>
              <p>Scoring: <span className="text-white">{data.league.settings.matchupFormat}</span></p>
              <p>Waivers: <span className="text-white">{data.league.settings.waiversEnabled ? 'On' : 'Off'}</span></p>
              <p>Trades: <span className="text-white">{data.league.settings.tradesEnabled ? 'On' : 'Off'}</span></p>
              <p>Manual substitutions: <span className="text-white">{data.league.settings.substitutionsEnabled ? 'On' : 'Off'}</span></p>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0a1228]/80 p-4">
            <h2 className="text-sm font-semibold text-white">Standings</h2>
            <div className="mt-3 space-y-2 text-xs">
              {data.standings.map((row) => (
                <div key={row.rosterId} className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
                  <div>
                    <div className="font-medium text-white">#{row.rank ?? '-'} {row.teamName}</div>
                    <div className="text-white/45">{row.wins}-{row.losses}-{row.ties}</div>
                  </div>
                  <div className="font-semibold text-[#ffd7e5]">{row.pointsFor.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {!loading && !error && data && sub === 'history' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.lineups.map((lineup) => (
            <article key={lineup.rosterId} className="rounded-xl border border-white/10 bg-[#0a1228]/70 p-4">
              <h2 className="text-sm font-semibold text-white">{lineup.teamName}</h2>
              <div className="mt-3 space-y-2 text-xs">
                {(historyByRoster.get(lineup.rosterId) ?? []).map((row) => (
                  <div key={`${lineup.rosterId}-${row.week}`} className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
                    <span className="text-white/60">Week {row.week}</span>
                    <span className="font-semibold text-[#ffd7e5]">{row.totalPoints.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}
