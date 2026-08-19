'use client'

import { useEffect, useState } from 'react'
import type { UserLeague } from '../../types'

/** Mirrors lib/league-health/league-health-engine.ts's OverallStatus. */
export type HealthStatus = 'excellent' | 'healthy' | 'watch' | 'at_risk' | 'critical' | 'unknown'

const KNOWN_STATUSES: HealthStatus[] = ['excellent', 'healthy', 'watch', 'at_risk', 'critical']

/**
 * Shared fetch for /api/league-health — used by MyLeagueCard (every league) and
 * CommissionerHub (commissioned leagues only) so the POST-body assembly and status
 * normalization only lives in one place.
 *
 * Deliberately NOT gated on `hasUnifiedRecord` like MyLeagueCard's other fetches: this route's
 * non-`decision_os` branch is `monitorLeagueHealth(parsed.data)` — a pure function over the POST
 * body that never touches the DB — so it returns a real status for AF Legacy rows too and adds no
 * database load.
 */
export function useLeagueHealth(league: UserLeague): { status: HealthStatus } | null {
  const [health, setHealth] = useState<{ status: HealthStatus } | null>(null)

  useEffect(() => {
    let cancelled = false

    void fetch('/api/league-health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leagueId: league.id,
        sport: league.sport,
        leagueType: league.leagueType ?? league.format ?? 'redraft',
        numTeams: league.teamCount ?? 12,
        currentWeek: league.currentWeek ?? 1,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { data?: { overallStatus?: string } } | null) => {
        if (cancelled || !data?.data?.overallStatus) return
        const raw = data.data.overallStatus.toLowerCase()
        const status: HealthStatus = (KNOWN_STATUSES as string[]).includes(raw) ? (raw as HealthStatus) : 'unknown'
        setHealth({ status })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [league.id, league.sport, league.leagueType, league.format, league.teamCount, league.currentWeek])

  return health
}
