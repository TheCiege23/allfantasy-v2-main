'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ZombieStatusCadence } from '@/lib/zombie/zombie-status-cadence'

type ResolutionRow = {
  week: number
  status: string
  hordeSize: number
  survivorCount: number
  weeklyWinningsPool: number
  resolvedAt: string | null
}

type Payload = {
  sport: string
  tierLabel: string | null
  currentWeek: number
  totalWeeks: number
  cadence: ZombieStatusCadence
  scheduleHint: string
  weeklyUpdate: {
    day: number | null
    hour: number | null
    autoPost: boolean
    approval: boolean
  }
  recentResolutions: ResolutionRow[]
}

export function ZombieStatusBoardCard({ leagueId }: { leagueId: string }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/zombie/status-board?leagueId=${encodeURIComponent(leagueId)}`, {
        credentials: 'include',
      })
      if (!res.ok) {
        setErr('Could not load status board.')
        return
      }
      setData((await res.json()) as Payload)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return <p className="text-[12px] text-white/45">Loading weekly status context…</p>
  }
  if (err || !data) {
    return <p className="text-[12px] text-red-300/90">{err ?? 'Unavailable'}</p>
  }

  const c = data.cadence

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-[#0a1228]/70 p-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-200/85">Sport-aware cadence</p>
        <p className="mt-1 text-[12px] leading-relaxed text-white/65">
          <span className="text-white/85">{data.sport}</span> · scoring window:{' '}
          <span className="text-white/85">{c.scoringPeriod}</span>
        </p>
        <p className="mt-2 text-[11px] text-white/50">{c.lineupSummary}</p>
        <p className="mt-1 text-[11px] text-white/45">{c.statCorrectionWindow}</p>
        <p className="mt-2 text-[11px] text-white/45">{c.boardCadenceSummary}</p>
        <p className="mt-2 text-[11px] text-amber-100/70">{data.scheduleHint}</p>
      </div>
      <div className="grid gap-2 text-[11px] text-white/55 md:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <span className="text-white/40">Current week</span>{' '}
          <span className="text-white/85">
            {data.currentWeek} / {data.totalWeeks}
          </span>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <span className="text-white/40">Auto-post</span>{' '}
          <span className="text-white/85">{data.weeklyUpdate.autoPost ? 'on' : 'off'}</span> ·{' '}
          <span className="text-white/40">approval</span>{' '}
          <span className="text-white/85">{data.weeklyUpdate.approval ? 'required' : 'off'}</span>
        </div>
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/45">Recent weekly resolutions</p>
        {data.recentResolutions.length === 0 ? (
          <p className="mt-1 text-[11px] text-white/40">No resolutions stored yet — they appear as weeks finalize.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-[11px] text-white/65">
            {data.recentResolutions.map((r) => (
              <li key={r.week} className="flex flex-wrap gap-2 border-b border-white/5 pb-1.5">
                <span className="font-mono text-cyan-100/90">W{r.week}</span>
                <span className="text-white/45">{r.status}</span>
                <span>horde {r.hordeSize}</span>
                <span>alive {r.survivorCount}</span>
                {r.weeklyWinningsPool > 0 && <span className="text-emerald-200/80">${r.weeklyWinningsPool.toFixed(2)} pool</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
