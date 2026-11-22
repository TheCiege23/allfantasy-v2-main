"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Users, Loader2 } from "lucide-react"
import { LeagueDiscoveryCard } from "./LeagueDiscoveryCard"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

interface CreatorDiscoverySectionProps {
  sport?: string | null
  limit?: number
}

export function CreatorDiscoverySection({ sport = null, limit = 6 }: CreatorDiscoverySectionProps) {
  const [leagues, setLeagues] = useState<DiscoveryCard[]>([])
  const [loading, setLoading] = useState(true)

  const fetchCreatorLeagues = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("format", "creator")
    if (sport) params.set("sport", sport)
    params.set("limit", String(limit))
    params.set("sort", "popularity")
    fetch(`/api/discover/leagues?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.leagues)) setLeagues(d.leagues)
        else setLeagues([])
      })
      .catch(() => setLeagues([]))
      .finally(() => setLoading(false))
  }, [sport, limit])

  useEffect(() => {
    fetchCreatorLeagues()
  }, [fetchCreatorLeagues])

  if (loading) {
    return (
      <section
        className="rounded-xl border p-6"
        style={{ borderColor: "var(--border)" }}
        data-testid="creator-discovery-section"
      >
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--text)" }}>
          <Users className="h-5 w-5" style={{ color: "var(--muted)" }} />
          Creator leagues
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
      data-testid="creator-discovery-section"
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
          <Users className="h-5 w-5" style={{ color: "var(--muted)" }} />
          Creator leagues
        </h2>
        <Link
          href="/creators"
          className="text-sm font-medium"
          style={{ color: "var(--accent)" }}
        >
          Browse all creators →
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {leagues.map((league) => (
          <LeagueDiscoveryCard key={league.id} league={league} />
        ))}
      </div>
    </section>
  )
}
