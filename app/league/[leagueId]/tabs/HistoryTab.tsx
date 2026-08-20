'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { History } from 'lucide-react'
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { UserLeague } from '@/app/dashboard/types'
import type { ManagerAllTime } from '@/lib/league/history-aggregates'
import type { LeagueSeason } from '@prisma/client'
import { SeasonDetailView } from '@/components/league/SeasonDetailView'

export type HistoryTabProps = {
  league: UserLeague
}

type SortKey = 'championships' | 'winPct' | 'points'

function avatarUrlFromId(avatar: string | null | undefined): string | null {
  if (!avatar) return null
  if (avatar.startsWith('http')) return avatar
  return `https://sleepercdn.com/avatars/${avatar}`
}

function getSeasonAccent(index: number) {
  if (index === 0) {
    return {
      pill: 'border-[#ff3d81]/30 bg-[#ff3d81]/12 text-[#ffd7e5]',
      card: 'border-[#ff3d81]/18 bg-[linear-gradient(135deg,rgba(255,61,129,0.12),rgba(255,255,255,0.03))]',
      label: 'Current import layer',
    }
  }
  if (index === 1) {
    return {
      pill: 'border-indigo-400/30 bg-indigo-400/12 text-indigo-100',
      card: 'border-indigo-400/18 bg-[linear-gradient(135deg,rgba(99,102,241,0.12),rgba(255,255,255,0.03))]',
      label: 'Previous season layer',
    }
  }
  return {
    pill: 'border-amber-300/25 bg-amber-300/10 text-amber-50',
    card: 'border-white/[0.06] bg-white/[0.04]',
    label: 'Archive layer',
  }
}

export function HistoryTab({ league }: HistoryTabProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seasons, setSeasons] = useState<LeagueSeason[]>([])
  const [standings, setStandings] = useState<ManagerAllTime[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('championships')
  const [syncing, setSyncing] = useState(false)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [detailExpanded, setDetailExpanded] = useState<Record<number, boolean>>({})
  const historicalBackfillStatus =
    league.settings && typeof league.settings === 'object'
      ? String((league.settings as Record<string, unknown>).historicalBackfillStatus ?? '')
      : ''

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/league/history?leagueId=${encodeURIComponent(league.id)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load history')
      setSeasons(data.seasons ?? [])
      setStandings(data.allTimeStandings ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [league.id])

  useEffect(() => {
    void load()
  }, [load])

  const sortedStandings = useMemo(() => {
    const copy = [...standings]
    copy.sort((a, b) => {
      if (sortKey === 'championships') {
        if (b.championships !== a.championships) return b.championships - a.championships
        return b.winPct - a.winPct
      }
      if (sortKey === 'winPct') {
        if (b.winPct !== a.winPct) return b.winPct - a.winPct
        return b.championships - a.championships
      }
      return b.avgPointsPerSeason - a.avgPointsPerSeason
    })
    return copy
  }, [standings, sortKey])

  const chartData = useMemo(() => {
    return sortedStandings.slice(0, 12).map((m) => ({
      name: m.managerName.length > 12 ? `${m.managerName.slice(0, 11)}…` : m.managerName,
      fullName: m.managerName,
      winPct: Math.round(m.winPct * 100),
      championships: m.championships,
    }))
  }, [sortedStandings])

  const sortedSeasons = useMemo(
    () => [...seasons].sort((a, b) => b.season - a.season),
    [seasons]
  )

  const barColor = (pct: number) => {
    if (pct >= 60) return '#10b981'
    if (pct >= 40) return '#6366f1'
    return '#f43f5e'
  }

  const handleSync = async () => {
    if (league.platform !== 'sleeper') return
    setSyncing(true)
    try {
      const res = await fetch(`/api/league/sync-history?leagueId=${encodeURIComponent(league.id)}`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 p-5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.06]" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 text-sm text-rose-300/90">
        {error}
      </div>
    )
  }

  if (seasons.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <History className="mb-3 text-white/20" size={32} strokeWidth={1.25} />
        <p className="text-sm font-medium text-white/70">No historical data yet</p>
        <p className="mt-2 max-w-sm text-xs text-white/40">
          Import your leagues to build this league&apos;s history. Current season and the previous year land first, then older seasons are layered into the archive tab automatically.
        </p>
        <Link
          href="/import?returnTo=/dashboard"
          className="mt-6 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/[0.1]"
        >
          Import Leagues →
        </Link>
        {league.platform === 'sleeper' ? (
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="mt-3 text-xs font-semibold text-[#ff3d81]/90 hover:text-[#ff9ec0] disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Try sync from Sleeper'}
          </button>
        ) : null}
      </div>
    )
  }

  const topManager = sortedStandings[0]?.managerKey

  return (
    <div className="space-y-8 p-5 pb-12">
      <section className="overflow-hidden rounded-2xl bg-white/[0.03]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-white/40">All-Time Standings</h2>
          {league.platform === 'sleeper' ? (
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/60 hover:bg-white/[0.08] disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync History'}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 border-b border-white/[0.06] px-4 py-2">
          {(['championships', 'winPct', 'points'] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSortKey(k)}
              className={`rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wide ${
                sortKey === k ? 'bg-white/10 text-white' : 'text-white/35 hover:text-white/55'
              }`}
            >
              {k === 'championships' ? 'Titles' : k === 'winPct' ? 'Win %' : 'Pts/Season'}
            </button>
          ))}
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-white/40">
              <th className="px-4 py-2 font-medium">Manager</th>
              <th className="px-2 py-2 font-medium">Seasons</th>
              <th className="px-2 py-2 font-medium">W-L</th>
              <th className="px-2 py-2 font-medium">Win%</th>
              <th className="px-2 py-2 font-medium">Pts/Szn</th>
              <th className="px-2 py-2 font-medium text-center">🏆</th>
              <th className="px-2 py-2 font-medium text-center">🥈</th>
            </tr>
          </thead>
          <tbody className="text-[12px] text-white/85">
            {sortedStandings.map((m) => {
              const isTop = m.managerKey === topManager
              const pct = m.winPct * 100
              const pctColor = pct >= 50 ? 'text-emerald-400' : 'text-rose-400'
              return (
                <tr
                  key={m.managerKey}
                  className={`border-t border-white/[0.05] hover:bg-white/[0.04] ${
                    isTop ? 'border-l-2 border-l-amber-400/80' : ''
                  }`}
                >
                  <td className="flex items-center gap-2 px-4 py-2">
                    {m.managerAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarUrlFromId(m.managerAvatar) ?? ''}
                        alt=""
                        className="h-6 w-6 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/50">
                        {m.managerName.slice(0, 1)}
                      </div>
                    )}
                    <span className="truncate">{m.managerName}</span>
                  </td>
                  <td className="px-2 py-2 text-white/55">{m.yearRange}</td>
                  <td className="px-2 py-2 text-white/70">
                    {m.totalWins}-{m.totalLosses}
                    {m.totalTies ? `-${m.totalTies}` : ''}
                  </td>
                  <td className={`px-2 py-2 font-medium ${pctColor}`}>{pct.toFixed(0)}%</td>
                  <td className="px-2 py-2 text-white/65">{m.avgPointsPerSeason.toFixed(1)}</td>
                  <td className="px-2 py-2 text-center text-amber-300/90">{m.championships || '—'}</td>
                  <td className="px-2 py-2 text-center text-slate-300/90">{m.runnerUps || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-white/40">Season History</h2>
          {historicalBackfillStatus === 'pending' ? (
            <span className="rounded-full border border-[#ff3d81]/25 bg-[#ff3d81]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#ffd7e5]">
              Layering prior seasons…
            </span>
          ) : null}
        </div>
        <div className="space-y-3">
          {sortedSeasons.map((s, index) => {
            const recs = (s.teamRecords as unknown[]) ?? []
            const open = expanded[s.season] ?? false
            const sorted = [...(recs as { wins?: number; pointsFor?: number; managerName?: string }[])].sort(
              (a, b) => (b.wins ?? 0) - (a.wins ?? 0),
            )
            const mostPts = sorted.reduce(
              (best, cur) => ((cur.pointsFor ?? 0) > (best?.pointsFor ?? 0) ? cur : best),
              sorted[0],
            )
            const accent = getSeasonAccent(index)
            return (
              <div
                key={s.id}
                className={`rounded-2xl border p-4 ${accent.card}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] ${accent.pill}`}>
                    {s.season}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">{accent.label}</span>
                  <span className="text-white/35">·</span>
                  <span className="text-white/55">{league.sport}</span>
                  <span className="text-white/35">·</span>
                  <span className="text-white/55">{s.teamCount ?? league.teamCount} teams</span>
                  <span className="text-white/35">·</span>
                  <span className="text-white/55">{s.scoringFormat ?? league.scoring}</span>
                </div>

                {s.championName ? (
                  <div className="mt-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-3 py-2">
                    <div className="flex items-center gap-3">
                      {s.championAvatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={avatarUrlFromId(s.championAvatar) ?? ''}
                          alt=""
                          className="h-8 w-8 rounded-lg object-cover"
                        />
                      ) : null}
                      <div>
                        <p className="text-sm font-bold text-amber-100">{s.championName}</p>
                        <p className="text-[11px] text-amber-200/70">🏆 {s.season} Champion</p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {s.runnerUpName ? (
                  <p className="mt-2 text-[12px] text-slate-300/90">
                    🥈 Runner-up: {s.runnerUpName}
                  </p>
                ) : null}

                {mostPts?.managerName ? (
                  <p className="mt-1 text-[11px] text-white/50">
                    📊 Most points: {mostPts.managerName} ({(mostPts.pointsFor ?? 0).toFixed(1)} pts)
                  </p>
                ) : null}

                <div className="mt-3 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [s.season]: !open }))}
                    className="text-[11px] font-semibold text-[#ff3d81]/80 hover:text-[#ff9ec0]"
                  >
                    Standings {open ? '▲' : '▼'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDetailExpanded((prev) => ({ ...prev, [s.season]: !(prev[s.season] ?? false) }))
                    }
                    className="text-[11px] font-semibold text-indigo-300/80 hover:text-indigo-200"
                  >
                    {detailExpanded[s.season] ? 'Hide Details ▲' : 'Full Details ▼'}
                  </button>
                </div>
                {detailExpanded[s.season] ? (
                  <SeasonDetailView leagueId={league.id} season={s.season} />
                ) : null}
                {open ? (
                  <ul className="mt-2 space-y-1 border-t border-white/[0.06] pt-2 text-[11px] text-white/70">
                    {sorted.map((row, idx) => (
                      <li key={idx} className="flex items-center justify-between gap-2">
                        <span className="text-white/45">
                          {idx + 1}. {row.managerName}
                        </span>
                        <span>
                          {row.wins ?? 0}-{((row as { losses?: number }).losses ?? 0)} ·{' '}
                          {((row as { pointsFor?: number }).pointsFor ?? 0).toFixed(1)} pts
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      {chartData.length > 0 ? (
        <section>
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-white/40">
            Historical Win % by Manager
          </h2>
          <div className="h-56 rounded-2xl border border-white/[0.06] bg-[#0c0c1e]/80 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload as { fullName?: string; winPct?: number }
                    return (
                      <div className="rounded border border-white/10 bg-[#0a0a1f] px-2 py-1 text-[11px] text-white/90">
                        {p.fullName ?? ''}: {p.winPct ?? 0}%
                      </div>
                    )
                  }}
                />
                <Bar dataKey="winPct" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={barColor(entry.winPct)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {seasons.length >= 3 ? (
        <section>
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-white/40">
            Championship Timeline
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/60">
            {[...seasons]
              .sort((a, b) => a.season - b.season)
              .map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1">
                  <span className="text-white/35">{s.season}</span>
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{
                      background: s.championName
                        ? `hsl(${(s.championName.charCodeAt(0) * 13) % 360}, 55%, 45%)`
                        : 'rgba(255,255,255,0.15)',
                    }}
                    title={s.championName ? `${s.championName} — ${s.season}` : String(s.season)}
                  />
                </span>
              ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
