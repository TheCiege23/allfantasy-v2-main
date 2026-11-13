"use client"

import { useEffect, useRef } from "react"
import { trackDiscoveryLeagueView } from "@/lib/discovery-analytics/client"
import type { DiscoverySource } from "@/lib/discovery-analytics"

interface DiscoveryViewTrackerProps {
  leagueId: string
  source: DiscoverySource
  leagueName?: string | null
  sport?: string | null
}

/**
 * Renders nothing; on mount, tracks a discovery_league_view event.
 * Use on league detail pages (bracket or creator) to count league views.
 */
export function DiscoveryViewTracker({
  leagueId,
  source,
  leagueName,
  sport,
}: DiscoveryViewTrackerProps) {
  const tracked = useRef(false)
  useEffect(() => {
    if (tracked.current || !leagueId) return
    tracked.current = true
    trackDiscoveryLeagueView({ leagueId, source, leagueName, sport })
  }, [leagueId, source, leagueName, sport])
  return null
}
