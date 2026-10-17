'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Shared state for following teams (the My Team prompt and Settings › Notifications), over
 * /api/user/team-follows. One implementation, so the two surfaces cannot disagree about what a
 * follow is or how a failed save behaves.
 *
 * Every toggle saves at once and is optimistic; a failed save reverts THAT team and reports it.
 * `available === false` means the server has no follows table yet — callers hide the feature
 * rather than show an empty list that reads as "you follow nobody".
 */

export type Team = { abbr: string; name: string }
export type Follow = { sport: string; teamAbbr: string; teamName: string }

const key = (sport: string, abbr: string) => `${sport}:${abbr}`

/** i18n key for a sport's display name ("College Football" for NCAAF, …). */
export function sportLabelKey(sport: string): string {
  return `follows.sport.${sport.toUpperCase()}`
}

export function useTeamFollows(initialSport = 'NFL') {
  const [sports, setSports] = useState<string[]>([])
  const [sport, setSport] = useState(initialSport)
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [follows, setFollows] = useState<Follow[] | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [max, setMax] = useState(30)
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async (s: string) => {
    setLoadError(false)
    setTeams(null)
    try {
      const res = await fetch(`/api/user/team-follows?sport=${encodeURIComponent(s)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { sports?: string[]; teams?: Team[]; follows?: Follow[] | null; max?: number }
      setSports(Array.isArray(data.sports) ? data.sports : [])
      setTeams(Array.isArray(data.teams) ? data.teams : [])
      setAvailable(data.follows !== null)
      setFollows(Array.isArray(data.follows) ? data.follows : [])
      if (typeof data.max === 'number') setMax(data.max)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void load(sport)
  }, [load, sport])

  const followed = useMemo(() => new Set((follows ?? []).map((f) => key(f.sport, f.teamAbbr))), [follows])

  const isFollowing = useCallback((s: string, abbr: string) => followed.has(key(s, abbr)), [followed])

  const toggle = useCallback(
    async (s: string, team: Team) => {
      if (!follows) return
      const wasFollowing = followed.has(key(s, team.abbr))
      const before = follows
      setSaveError(null)
      setFollows(
        wasFollowing
          ? follows.filter((f) => !(f.sport === s && f.teamAbbr === team.abbr))
          : [...follows, { sport: s, teamAbbr: team.abbr, teamName: team.name }],
      )
      try {
        const res = await fetch('/api/user/team-follows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: wasFollowing ? 'unfollow' : 'follow', sport: s, teamAbbr: team.abbr }),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: unknown }
          throw new Error(typeof data.error === 'string' ? data.error : '')
        }
      } catch (err) {
        setFollows(before)
        setSaveError(err instanceof Error && err.message ? err.message : 'save')
      }
    },
    [follows, followed],
  )

  return {
    sports,
    sport,
    setSport,
    teams,
    follows,
    available,
    max,
    loadError,
    saveError,
    isFollowing,
    toggle,
    reload: () => load(sport),
  }
}

/** Tell the server the prompt was seen ("Not now" or "Done"). Fire-and-forget; never blocks closing. */
export function dismissTeamFollowPrompt(): void {
  void fetch('/api/user/team-follows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dismissPrompt' }),
  }).catch(() => {})
}
