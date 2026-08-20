'use client'

/**
 * useProjectedStandings — shared client hook for the pre-season projected
 * week-1 ranking (LeagueInfoRail standings + DecideHome KPIs).
 *
 * Only activates while `enabled` (i.e. isPreseason: no wins, no losses, no
 * points anywhere) and only keeps a payload the server ALSO marked preseason —
 * double gate so projections can never displace real results.
 */

import { useEffect, useState } from 'react'
import type { LeagueTeamSlot } from '@/app/dashboard/types'
import type { ProjectedStandingsPayload } from '@/lib/projections/projectedStandingsService'

type ProjectedApiResponse =
  | { supported: false; platform: string }
  | {
      supported: true
      viewerSleeperUserId: string | null
      standings: ProjectedStandingsPayload | null
      error?: string
    }

/** True while nothing real has been scored — the only state projections rank. */
export function isPreseason(teams: LeagueTeamSlot[]): boolean {
  return (
    teams.length > 0 &&
    teams.every(
      (t) =>
        (t.wins ?? 0) === 0 && (t.losses ?? 0) === 0 && (t.ties ?? 0) === 0 && (t.pointsFor ?? 0) === 0,
    )
  )
}

export function useProjectedStandings(
  leagueId: string | null,
  enabled: boolean,
): ProjectedStandingsPayload | null {
  const [data, setData] = useState<ProjectedStandingsPayload | null>(null)
  useEffect(() => {
    if (!enabled || !leagueId) {
      setData(null)
      return
    }
    let cancelled = false
    void fetch(`/api/league/projected-standings?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => res.json() as Promise<ProjectedApiResponse>)
      .then((payload) => {
        if (!cancelled && payload.supported && payload.standings?.preseason) {
          setData(payload.standings)
        }
      })
      .catch(() => {
        /* projections unavailable → surfaces keep their honest empty states */
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, enabled])
  return data
}
