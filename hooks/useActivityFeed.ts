"use client"

import { useCallback, useEffect, useState } from "react"
import type { ActivityFeedItem } from "@/lib/activity/types"

export function useActivityFeed(options?: { limit?: number; leagueId?: string; enabled?: boolean }) {
  const limit = options?.limit ?? 50
  const leagueId = options?.leagueId ?? undefined
  /** Opt-out for callers rendered per-league in a list: one mounted hook = one fetch every 90s
   *  forever, so N cards cost N polls/90s indefinitely even while idle. Defaults to true. */
  const enabled = options?.enabled ?? true
  const [items, setItems] = useState<ActivityFeedItem[]>([])
  /** Disabled callers never fetch, so they must not start life in a loading state. */
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      if (leagueId) params.set("leagueId", leagueId)
      const res = await fetch(`/api/shared/activity?${params}`, { cache: "no-store" })
      const json = await res.json().catch(() => ({}))
      const raw = Array.isArray(json?.items) ? json.items : []
      setItems(raw)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [limit, leagueId, enabled])

  useEffect(() => {
    if (!enabled) return
    load()
    const timer = setInterval(load, 90_000)
    return () => clearInterval(timer)
  }, [load, enabled])

  return { items, loading, error, refresh: load }
}
