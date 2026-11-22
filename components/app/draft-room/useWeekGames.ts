'use client'

/**
 * This week's games per team for an NBA / NHL / MLB draft room's "My team" panel. Football and
 * every other sport skip the request entirely. A failed read leaves the panel as it was.
 */
import { useEffect, useState } from 'react'
import { scheduleSport } from '@/lib/draft-room/proTeamKey'
import type { WeekGamesByTeam } from '@/lib/draft-room/weekGames'

export function useWeekGames(sport: string | null | undefined): WeekGamesByTeam | null {
  const s = scheduleSport(sport)
  const [teams, setTeams] = useState<WeekGamesByTeam | null>(null)
  useEffect(() => {
    setTeams(null)
    if (!s) return
    let cancelled = false
    fetch(`/api/draft-room/week-games?sport=${s}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { teams?: WeekGamesByTeam } | null) => {
        if (!cancelled && body?.teams) setTeams(body.teams)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [s])
  return teams
}
