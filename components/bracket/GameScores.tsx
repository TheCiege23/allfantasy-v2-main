"use client"

import { useMemo } from "react"
import { Eye } from "lucide-react"

type Game = {
  id: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: string | null
}

function teamAbbrev(name: string) {
  if (!name) return "TBD"
  const words = name.trim().split(/\s+/)
  if (words.length === 1) {
    return name.length <= 4 ? name.toUpperCase() : name.slice(0, 3).toUpperCase()
  }
  if (words.length === 2 && name.length <= 5) return name.toUpperCase()
  return words.map((w) => w[0]).join("").toUpperCase().slice(0, 4)
}

function formatTime(dateStr: string | null) {
  if (!dateStr) return "TBD"
  try {
    const d = new Date(dateStr)
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase()
  } catch {
    return "TBD"
  }
}

export function GameScores({ games }: { games: Game[] }) {
  const todayGames = useMemo(() => {
    const now = new Date()
    const today = now.toDateString()
    const filtered = games.filter((g) => {
      if (!g.startTime) return false
      return new Date(g.startTime).toDateString() === today
    })
    if (filtered.length > 0) return filtered
    return games.slice(0, 6)
  }, [games])

  if (todayGames.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-base">🏀</span>
          <span className="text-sm font-semibold text-white">Game Scores</span>
        </div>
        <button className="text-xs font-semibold text-cyan-400 hover:text-cyan-300">
          ALL GAMES
        </button>
      </div>
      <div className="text-[11px] font-bold text-red-400 uppercase tracking-wider px-1">Today</div>

      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
        {todayGames.map((g) => {
          const isLive = g.status === "in_progress"
          const isFinal = g.status === "final"
          return (
            <div
              key={g.id}
              className="flex-shrink-0 w-[140px] rounded-xl border border-white/10 bg-black/30 p-3 space-y-2"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLive ? "bg-green-400 animate-pulse" : "bg-transparent"}`} />
                  <span className="text-xs font-semibold text-white truncate">
                    {teamAbbrev(g.homeTeam)}
                  </span>
                  {isFinal && g.homeScore != null && (
                    <span className="ml-auto text-xs font-bold text-white tabular-nums">{g.homeScore}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 flex-shrink-0" />
                  <span className="text-xs font-semibold text-white truncate">
                    {teamAbbrev(g.awayTeam)}
                  </span>
                  {isFinal && g.awayScore != null && (
                    <span className="ml-auto text-xs font-bold text-white tabular-nums">{g.awayScore}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-white/5 pt-1.5">
                <span className="text-[11px] text-white/40">
                  {isFinal ? "Final" : isLive ? "Live" : formatTime(g.startTime)}
                </span>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-white/30">
                <span className="flex items-center gap-0.5">
                  <Eye className="h-2.5 w-2.5" />
                  &lt;1k
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
