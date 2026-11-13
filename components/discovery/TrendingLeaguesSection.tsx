"use client"

import { useCallback, useEffect, useState } from "react"
import { TrendingUp, Loader2 } from "lucide-react"
import { LeagueDiscoveryCard } from "./LeagueDiscoveryCard"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

interface TrendingLeaguesSectionProps {
  sport?: string | null
  limit?: number
}

export function TrendingLeaguesSection({ sport = null, limit = 6 }: TrendingLeaguesSectionProps) {
  const [leagues, setLeagues] = useState<DiscoveryCard[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTrending = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (sport) params.set("sport", sport)
    params.set("limit", String(limit))
    fetch(`/api/discover/trending?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && Array.isArray(d.leagues)) setLeagues(d.leagues)
        else setLeagues([])
      })
      .catch(() => setLeagues([]))
      .finally(() => setLoading(false))
  }, [sport, limit])

  useEffect(() => {
    fetchTrending()
  }, [fetchTrending])

  if (loading) {
    return (
      <section
        className="rounded-xl border p-6"
        style={{ borderColor: "var(--border)" }}
        data-testid="trending-leagues-section"
      >
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--text)" }}>
          <TrendingUp className="h-5 w-5" style={{ color: "var(--muted)" }} />
          Trending leagues
        </h2>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--muted)" }} />
        </div>
      </section>
    )
  }

  if (leagues.length === 0) return null

  return (
    <section
      className="rounded-xl border p-6"
      style={{ borderColor: "var(--border)" }}
      data-testid="trending-leagues-section"
    >
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--text)" }}>
        <TrendingUp className="h-5 w-5" style={{ color: "var(--muted)" }} />
        Trending leagues
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {leagues.map((league) => (
          <LeagueDiscoveryCard key={`${league.source}-${league.id}`} league={league} />
        ))}
      </div>
    </section>
  )
}
