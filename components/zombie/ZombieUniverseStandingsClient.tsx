'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Search, TrendingDown, TrendingUp } from 'lucide-react'
import { ZombieStatusBadge } from '@/app/zombie/components/ZombieStatusBadge'
import type { ZombieMovementProjection, ZombieUniverseStandingsRow } from './types'

export interface ZombieUniverseStandingsClientProps {
  universeId: string
  season?: number
}

function movementTone(reason?: string) {
  const value = (reason ?? '').toLowerCase()
  if (value.includes('promot')) return 'text-emerald-200 bg-emerald-500/10 border-emerald-500/20'
  if (value.includes('relegat') || value.includes('drop')) return 'text-rose-100 bg-rose-500/10 border-rose-500/20'
  return 'text-white/75 bg-white/5 border-white/10'
}

export function ZombieUniverseStandingsClient({ universeId, season }: ZombieUniverseStandingsClientProps) {
  const [standings, setStandings] = useState<ZombieUniverseStandingsRow[]>([])
  const [movement, setMovement] = useState<ZombieMovementProjection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterLevel, setFilterLevel] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const url = new URL(`/api/zombie-universe/${encodeURIComponent(universeId)}/standings`, window.location.origin)
        if (season != null) url.searchParams.set('season', String(season))
        const res = await fetch(url.toString(), { cache: 'no-store' })
        if (!active) return
        if (!res.ok) {
          setError('Failed to load standings')
          return
        }
        const data = await res.json()
        setStandings(Array.isArray(data.standings) ? data.standings : [])
        setMovement(Array.isArray(data.movementProjections) ? data.movementProjections : [])
      } catch {
        if (active) setError('Request failed')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [universeId, season])

  const movementByRoster = useMemo(() => {
    const map = new Map<string, ZombieMovementProjection>()
    for (const row of movement) map.set(row.rosterId, row)
    return map
  }, [movement])

  const filtered = useMemo(() => {
    let list = standings
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((row) => {
        const display = (row.displayName ?? row.rosterId).toLowerCase()
        return (
          display.includes(q) ||
          row.rosterId.toLowerCase().includes(q) ||
          row.levelName.toLowerCase().includes(q) ||
          (row.leagueName ?? '').toLowerCase().includes(q)
        )
      })
    }
    if (filterLevel) list = list.filter((row) => row.levelId === filterLevel || row.levelName === filterLevel)
    if (filterStatus) list = list.filter((row) => row.status === filterStatus)
    return list
  }, [standings, search, filterLevel, filterStatus])

  const levels = useMemo(() => [...new Set(standings.map((row) => row.levelName))].sort(), [standings])
  const statuses = useMemo(() => [...new Set(standings.map((row) => row.status))].sort(), [standings])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, row) => {
        const status = row.status.toLowerCase()
        if (status.includes('zombie')) acc.zombies += 1
        if (status.includes('survivor') || status.includes('revived')) acc.survivors += 1
        if (status.includes('whisperer')) acc.whisperers += 1
        return acc
      },
      { survivors: 0, zombies: 0, whisperers: 0 },
    )
  }, [filtered])

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-3xl border border-white/10 bg-white/[0.03] p-8">
        <p className="text-sm text-white/60">Loading standings...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4">
        <p className="text-sm text-amber-200">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Survivors</p>
          <p className="mt-2 text-2xl font-black text-emerald-200">{totals.survivors}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Zombies</p>
          <p className="mt-2 text-2xl font-black text-rose-100">{totals.zombies}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Whisperers</p>
          <p className="mt-2 text-2xl font-black text-amber-200">{totals.whisperers}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            placeholder="Search teams, levels, leagues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-white/20 bg-white/5 py-3 pl-10 pr-3 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
          />
        </div>
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value)}
          className="min-h-[44px] rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/40"
        >
          <option value="">All levels</option>
          {levels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="min-h-[44px] rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/40"
        >
          <option value="">All statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 lg:hidden">
        {filtered.map((row) => {
          const projection = movementByRoster.get(row.rosterId)
          return (
            <article key={`${row.leagueId}-${row.rosterId}`} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">{row.levelName}</p>
                  <h3 className="truncate text-lg font-black text-white">{row.displayName ?? row.rosterId}</h3>
                  <p className="mt-1 text-xs text-white/50">{row.leagueName ?? row.leagueId}</p>
                </div>
                <ZombieStatusBadge status={row.status} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Points</p>
                  <p className="mt-2 font-bold text-white">{row.totalPoints.toFixed(1)}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Winnings</p>
                  <p className="mt-2 font-bold text-white">{row.winnings.toFixed(1)}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Items</p>
                  <p className="mt-2 font-bold text-white">{row.serums} serums | {row.weapons} weapons</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Week killed</p>
                  <p className="mt-2 font-bold text-white">{row.weekKilled ?? '-'}</p>
                </div>
              </div>
              <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${movementTone(projection?.reason)}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{projection?.reason ?? 'Holding current tier'}</span>
                  <span className="inline-flex items-center gap-1">
                    {projection?.reason?.toLowerCase().includes('relegat') ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                    {projection?.projectedLevelId ?? row.levelName}
                  </span>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-3xl border border-white/10 bg-white/[0.03] lg:block">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="p-3 font-medium text-white/80">Level</th>
              <th className="p-3 font-medium text-white/80">Team</th>
              <th className="p-3 font-medium text-white/80">Status</th>
              <th className="p-3 font-medium text-white/80 text-right">Points</th>
              <th className="p-3 font-medium text-white/80 text-right">Winnings</th>
              <th className="p-3 font-medium text-white/80 text-right">Serums</th>
              <th className="p-3 font-medium text-white/80 text-right">Weapons</th>
              <th className="p-3 font-medium text-white/80">Week killed</th>
              <th className="p-3 font-medium text-white/80">Projected tier</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const projection = movementByRoster.get(row.rosterId)
              return (
                <tr key={`${row.leagueId}-${row.rosterId}`} className="border-b border-white/5 align-top">
                  <td className="p-3 text-white/90">{row.levelName}</td>
                  <td className="p-3">
                    <p className="font-semibold text-white">{row.displayName ?? row.rosterId}</p>
                    <p className="mt-1 text-xs text-white/45">{row.leagueName ?? row.leagueId}</p>
                  </td>
                  <td className="p-3">
                    <ZombieStatusBadge status={row.status} />
                  </td>
                  <td className="p-3 text-right tabular-nums text-white/80">{row.totalPoints.toFixed(1)}</td>
                  <td className="p-3 text-right tabular-nums text-white/80">{row.winnings.toFixed(1)}</td>
                  <td className="p-3 text-right tabular-nums text-white/80">{row.serums}</td>
                  <td className="p-3 text-right tabular-nums text-white/80">{row.weapons}</td>
                  <td className="p-3 text-white/70">{row.weekKilled ?? '-'}</td>
                  <td className="p-3">
                    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${movementTone(projection?.reason)}`}>
                      <span>{projection?.projectedLevelId ?? row.levelName}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                      <span>{projection?.reason ?? 'Holding'}</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && <p className="py-8 text-center text-sm text-white/50">No rows match your filters.</p>}
    </div>
  )
}
