'use client'

import { useEffect, useState } from 'react'
import { Calendar } from 'lucide-react'
import type { PlayerIdentity } from '../PlayerProfileClient'

type StatLine = {
  season: number
  gamesPlayed?: number
  fantasyPoints?: number
  fantasyPointsPerGame?: number
  stats?: Record<string, unknown>
}

export function GameLogTab({ player }: { player: PlayerIdentity }) {
  const [seasons, setSeasons] = useState<StatLine[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch via player-card-analytics which includes season stats
    fetch('/api/player-card-analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: player.name, sport: player.sport }),
    } as any)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.seasonStats && Array.isArray(d.seasonStats)) {
          setSeasons(d.seasonStats)
        } else if (d?.stats) {
          setSeasons([{ season: new Date().getFullYear(), stats: d.stats }])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [player.name, player.sport])

  if (loading) {
    return <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-white/[0.04]" />)}</div>
  }

  if (seasons.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <Calendar className="h-8 w-8 text-white/10" />
        <p className="mt-3 text-sm text-white/40">No game log data available for {player.name}.</p>
        <p className="mt-1 text-xs text-white/25">Game logs are populated after your league imports player stats.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {seasons.map((s) => {
        const st = (s.stats ?? {}) as Record<string, unknown>
        return (
          <div key={s.season} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-bold text-white">{s.season} Season</p>
              {s.gamesPlayed != null && <span className="text-[11px] text-white/40">{s.gamesPlayed} GP</span>}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              {s.fantasyPoints != null && <LogStat label="Fantasy Pts" value={Number(s.fantasyPoints).toFixed(1)} />}
              {s.fantasyPointsPerGame != null && <LogStat label="Pts/Game" value={Number(s.fantasyPointsPerGame).toFixed(1)} />}
              {st.passing_yards != null && <LogStat label="Pass Yds" value={String(st.passing_yards)} />}
              {st.rushing_yards != null && <LogStat label="Rush Yds" value={String(st.rushing_yards)} />}
              {st.receiving_yards != null && <LogStat label="Rec Yds" value={String(st.receiving_yards)} />}
              {st.receptions != null && <LogStat label="Rec" value={String(st.receptions)} />}
              {st.passing_touchdowns != null && <LogStat label="Pass TD" value={String(st.passing_touchdowns)} />}
              {st.rushing_touchdowns != null && <LogStat label="Rush TD" value={String(st.rushing_touchdowns)} />}
              {st.receiving_touchdowns != null && <LogStat label="Rec TD" value={String(st.receiving_touchdowns)} />}
              {st.interceptions != null && <LogStat label="INT" value={String(st.interceptions)} />}
              {st.fumbles != null && <LogStat label="Fum" value={String(st.fumbles)} />}
              {st.targets != null && <LogStat label="Targets" value={String(st.targets)} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LogStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-0.5">
      <span className="text-[11px] uppercase text-white/30">{label}: </span>
      <span className="text-[12px] font-semibold text-white/70">{value}</span>
    </div>
  )
}
