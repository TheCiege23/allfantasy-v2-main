"use client"

import { useEffect, useState } from "react"
import { useUserTimezone } from "@/hooks/useUserTimezone"

export type FeedScope = "global" | "league"

export type BustedFeedEvent = {
  id: string
  scope: FeedScope
  leagueId?: string | null
  tournamentId: string
  gameId?: string | null
  type:
    | "MASS_BUST"
    | "UPSET_SHOCK"
    | "PERFECT_BRACKET_ALERT"
    | "LEADERBOARD_EARTHQUAKE"
    | "CHAMPIONSHIP_DEATH_BLOW"
  title: string
  message: string
  impactPct?: number | null
  createdAt: string
}

const EVENT_ICONS: Record<string, string> = {
  MASS_BUST: "💥",
  UPSET_SHOCK: "😱",
  PERFECT_BRACKET_ALERT: "🏆",
  LEADERBOARD_EARTHQUAKE: "📊",
  CHAMPIONSHIP_DEATH_BLOW: "💀",
}

const EVENT_COLORS: Record<string, string> = {
  MASS_BUST: "#ef4444",
  UPSET_SHOCK: "#f59e0b",
  PERFECT_BRACKET_ALERT: "#22c55e",
  LEADERBOARD_EARTHQUAKE: "#3b82f6",
  CHAMPIONSHIP_DEATH_BLOW: "#a855f7",
}

export function BracketsBustedFeed({
  scope,
  leagueId,
  tournamentId,
}: {
  scope: FeedScope
  leagueId?: string
  tournamentId: string
}) {
  const { formatInTimezone } = useUserTimezone()
  const [events, setEvents] = useState<BustedFeedEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      const params = new URLSearchParams({ scope, tournamentId })
      if (leagueId) params.set("leagueId", leagueId)

      try {
        const res = await fetch(`/api/feed?${params.toString()}`)
        const data = await res.json()
        if (!mounted) return
        setEvents(data.events ?? [])
      } catch {}
      if (mounted) setLoading(false)
    }

    load()
    const id = setInterval(load, 5000)

    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [scope, leagueId, tournamentId])

  return (
    <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <div className="text-sm font-bold flex items-center gap-2">
            <span>Brackets Busted</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{
              background: scope === "global" ? "rgba(139,92,246,0.12)" : "rgba(251,146,60,0.12)",
              color: scope === "global" ? "#a78bfa" : "#fb923c",
            }}>
              {scope === "global" ? "Global" : "League"}
            </span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
            Auto-generated highlights from game results and leaderboard swings.
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center">
          <div className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>Loading highlights...</div>
        </div>
      ) : events.length === 0 ? (
        <div className="py-8 text-center">
          <div className="text-2xl mb-2">🏀</div>
          <div className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>No highlights yet</div>
          <div className="text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.25)" }}>
            Highlights appear automatically as games are played.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((e) => {
            const icon = EVENT_ICONS[e.type] || "📢"
            const accentColor = EVENT_COLORS[e.type] || "#fb923c"

            return (
              <div
                key={e.id}
                className="rounded-xl p-3.5 transition"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderLeft: `3px solid ${accentColor}`,
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="text-lg flex-shrink-0 mt-0.5">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold truncate">{e.title}</div>
                      {typeof e.impactPct === "number" && (
                        <span
                          className="flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full"
                          style={{
                            background: `${accentColor}15`,
                            color: accentColor,
                            border: `1px solid ${accentColor}30`,
                          }}
                        >
                          {Math.round(e.impactPct)}% impact
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
                      {e.message}
                    </div>
                    <div className="text-[11px] mt-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>
                      {formatInTimezone(e.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
