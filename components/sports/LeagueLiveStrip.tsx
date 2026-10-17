'use client'

import { useEffect, useState } from 'react'
import type { LiveScoreGame } from '@/hooks/usePhase1Data'

function gameStatusColor(status: string): string {
  const s = status.toLowerCase()
  if (s.includes('live') || s.includes('in progress') || s.includes('in_progress')) return 'text-red-400'
  if (s.includes('final')) return 'text-white/40'
  return 'text-cyan-300'
}

function isLive(status: string): boolean {
  const s = status.toLowerCase()
  return s.includes('live') || s.includes('in progress') || s.includes('in_progress')
}

function GameCard({ game }: { game: LiveScoreGame }) {
  const live = isLive(game.status)
  return (
    <div className={`flex shrink-0 flex-col items-center gap-1 rounded-xl border px-3 py-2 text-center ${
      live ? 'border-red-500/30 bg-red-500/5' : 'border-white/[0.06] bg-white/[0.03]'
    }`} style={{ minWidth: 120 }}>
      {live && (
        <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-red-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Live
        </span>
      )}
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <span className="text-white/80">{game.awayTeam}</span>
        <span className="text-white/50">{game.awayScore}</span>
      </div>
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <span className="text-white/80">{game.homeTeam}</span>
        <span className="text-white/50">{game.homeScore}</span>
      </div>
      <span className={`text-[11px] font-medium ${gameStatusColor(game.status)}`}>
        {game.quarter ? `${game.quarter} ${game.clock ?? ''}` : game.status}
      </span>
    </div>
  )
}

export function LeagueLiveStrip({ sport }: { sport: string }) {
  const [games, setGames] = useState<LiveScoreGame[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const res = await fetch(`/api/sports/live-scores?sport=${encodeURIComponent(sport)}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (active) setGames(Array.isArray(data.games) ? data.games : Array.isArray(data) ? data : [])
      } catch {} finally {
        if (active) setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => { active = false; clearInterval(interval) }
  }, [sport])

  if (loading) {
    return (
      <div className="flex gap-2 overflow-x-auto px-4 py-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 w-28 shrink-0 animate-pulse rounded-xl bg-white/[0.04]" />
        ))}
      </div>
    )
  }

  if (games.length === 0) return null

  return (
    <div className="border-b border-white/[0.06] bg-[#0a0e1a]">
      <div className="flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {games.map((g, i) => (
          <GameCard key={`${g.homeTeam}-${g.awayTeam}-${i}`} game={g} />
        ))}
      </div>
    </div>
  )
}
