'use client'

import { useEffect, useState } from 'react'

/**
 * Clubs on bye in `week` (upper-case abbreviations), for BYE on the Team tab's roster rows. NFL only;
 * any failure yields an empty set, which shows scores rather than a wrong BYE.
 */
export function useByeTeams(sport: string | null | undefined, season: number | null | undefined, week: number | null | undefined): ReadonlySet<string> | null {
  const [teams, setTeams] = useState<ReadonlySet<string> | null>(null)
  const nfl = String(sport ?? '').toUpperCase() === 'NFL'
  useEffect(() => {
    if (!nfl || !season || !week) {
      setTeams(null)
      return
    }
    let cancelled = false
    fetch(`/api/sports/bye-teams?sport=NFL&season=${season}&week=${week}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { teams?: unknown } | null) => {
        if (cancelled) return
        const list = Array.isArray(json?.teams) ? json!.teams.filter((t): t is string => typeof t === 'string') : []
        setTeams(new Set(list.map((t) => t.toUpperCase())))
      })
      .catch(() => {
        if (!cancelled) setTeams(null)
      })
    return () => {
      cancelled = true
    }
  }, [nfl, season, week])
  return teams
}
