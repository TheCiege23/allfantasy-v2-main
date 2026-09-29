'use client'

import Link from 'next/link'
import { useState, useCallback, useEffect } from 'react'

type RivalryView = {
  id: string
  leagueId: string
  sport: string
  sportLabel: string
  managerAId: string
  managerBId: string
  rivalryScore: number
  rivalryTier: string
  tierBadgeColor: string
  firstDetectedAt: string
  updatedAt: string
  eventCount?: number
}

export function RivalryEngineList({
  leagueId,
  sport,
  season,
  onExplain,
  onViewTimeline,
}: {
  leagueId: string
  sport?: string
  season?: number | null
  onExplain?: (rivalryId: string) => void
  onViewTimeline?: (rivalryId: string) => void
}) {
  const [rivalries, setRivalries] = useState<RivalryView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [managerAFilter, setManagerAFilter] = useState('')
  const [managerBFilter, setManagerBFilter] = useState('')

  const managerOptions = Array.from(
    new Set(rivalries.flatMap((r) => [r.managerAId, r.managerBId]).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b))

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (sport) params.set('sport', sport)
    if (season != null) params.set('season', String(season))
    if (managerAFilter && managerBFilter) {
      params.set('managerAId', managerAFilter)
      params.set('managerBId', managerBFilter)
    } else if (managerAFilter) {
      params.set('managerId', managerAFilter)
    } else if (managerBFilter) {
      params.set('managerId', managerBFilter)
    }
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/rivalries?${params}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load rivalries')
        return r.json()
      })
      .then((data: { rivalries?: RivalryView[] }) => setRivalries(Array.isArray(data.rivalries) ? data.rivalries : []))
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Error')
        setRivalries([])
      })
      .finally(() => setLoading(false))
  }, [leagueId, sport, season, managerAFilter, managerBFilter])

  useEffect(() => {
    load()
  }, [load])

  const runEngine = useCallback(() => {
    setRunning(true)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/rivalries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(sport ? { sport } : {}),
        ...(season != null ? { seasons: [season] } : {}),
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to run engine')
        return r.json()
      })
      .then(() => load())
      .catch((e) => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setRunning(false))
  }, [leagueId, sport, season, load])

  const clearFilters = useCallback(() => {
    setManagerAFilter('')
    setManagerBFilter('')
  }, [])

  if (loading) return <p className="text-sm text-white/60">Loading rivalries…</p>
  if (error) return <p className="text-sm text-red-300">{error}</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runEngine}
          disabled={running}
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run rivalry engine'}
        </button>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10"
        >
          Refresh
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <select
          value={managerAFilter}
          onChange={(e) => setManagerAFilter(e.target.value)}
          className="rounded-lg border border-white/20 bg-black/30 px-2.5 py-1.5 text-xs text-white/80"
          aria-label="Rivalry manager selector A"
        >
          <option value="">All managers (A)</option>
          {managerOptions.map((m) => (
            <option key={`a-${m}`} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={managerBFilter}
          onChange={(e) => setManagerBFilter(e.target.value)}
          className="rounded-lg border border-white/20 bg-black/30 px-2.5 py-1.5 text-xs text-white/80"
          aria-label="Rivalry manager selector B"
        >
          <option value="">All managers (B)</option>
          {managerOptions.map((m) => (
            <option key={`b-${m}`} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10"
        >
          Clear manager filters
        </button>
      </div>
      {rivalries.length === 0 ? (
        <p className="text-sm text-white/50">No rivalries yet. Run the engine to detect from matchup history.</p>
      ) : (
        <ul className="space-y-2">
          {rivalries.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2"
            >
              <span
                className={
                  r.tierBadgeColor === 'amber'
                    ? 'rounded px-1.5 py-0.5 text-[11px] font-bold text-amber-300 border border-amber-500/20 bg-amber-500/10'
                    : r.tierBadgeColor === 'red'
                      ? 'rounded px-1.5 py-0.5 text-[11px] font-bold text-red-300 border border-red-500/20 bg-red-500/10'
                      : r.tierBadgeColor === 'orange'
                        ? 'rounded px-1.5 py-0.5 text-[11px] font-bold text-orange-300 border border-orange-500/20 bg-orange-500/10'
                        : 'rounded px-1.5 py-0.5 text-[11px] font-bold text-blue-300 border border-blue-500/20 bg-blue-500/10'
                }
              >
                {r.rivalryTier}
              </span>
              <span className="text-sm text-white/90">{r.managerAId}</span>
              <span className="text-white/40">vs</span>
              <span className="text-sm text-white/90">{r.managerBId}</span>
              <span className="text-xs text-white/40 tabular-nums">({r.rivalryScore.toFixed(1)})</span>
              {r.eventCount != null && r.eventCount > 0 && (
                <span className="text-[11px] text-white/35">{r.eventCount} events</span>
              )}
              <div className="ml-auto flex gap-1">
                <Link
                  href={`/app/league/${encodeURIComponent(leagueId)}/rivalries/${encodeURIComponent(r.id)}${
                    sport || season != null ? "?" : ""
                  }${sport ? `sport=${encodeURIComponent(sport)}${season != null ? "&" : ""}` : ""}${
                    season != null ? `season=${encodeURIComponent(String(season))}` : ""
                  }`}
                  className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
                >
                  Details
                </Link>
                <Link
                  href={`/app/league/${encodeURIComponent(leagueId)}/rivalries/${encodeURIComponent(
                    r.id
                  )}?tab=h2h${sport ? `&sport=${encodeURIComponent(sport)}` : ""}${
                    season != null ? `&season=${encodeURIComponent(String(season))}` : ""
                  }`}
                  className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
                >
                  H2H
                </Link>
                {onViewTimeline && (
                  <button
                    type="button"
                    onClick={() => onViewTimeline(r.id)}
                    className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
                  >
                    Timeline
                  </button>
                )}
                {onExplain && (
                  <button
                    type="button"
                    onClick={() => onExplain(r.id)}
                    className="rounded border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/20"
                  >
                    Explain
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
