'use client'

import { useEffect, useMemo, useState } from 'react'

/**
 * Clubs (as the roster spells them) with NO game today, for NG on the Team tab's roster rows. NBA,
 * NHL and MLB only; null whenever the server could not judge the day, which shows nothing rather than
 * marking a whole roster NG. Asks only about the roster's own clubs.
 */
export function useNoGameTeams(
  sport: string | null | undefined,
  season: number | null | undefined,
  rosterTeams: readonly (string | null | undefined)[],
): ReadonlySet<string> | null {
  const s = String(sport ?? '').toUpperCase()
  const supported = s === 'NBA' || s === 'NHL' || s === 'MLB'
  const key = useMemo(
    () => [...new Set(rosterTeams.map((t) => String(t ?? '').trim().toUpperCase()).filter((t) => t && t !== 'FA'))].sort().join(','),
    [rosterTeams],
  )
  const [off, setOff] = useState<ReadonlySet<string> | null>(null)
  useEffect(() => {
    if (!supported || !season || !key) {
      setOff(null)
      return
    }
    let cancelled = false
    fetch(`/api/sports/teams-playing?sport=${s}&season=${season}&teams=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { judged?: boolean; notPlaying?: unknown } | null) => {
        if (cancelled) return
        if (!json?.judged || !Array.isArray(json.notPlaying)) {
          setOff(null)
          return
        }
        setOff(new Set(json.notPlaying.filter((t): t is string => typeof t === 'string').map((t) => t.toUpperCase())))
      })
      .catch(() => {
        if (!cancelled) setOff(null)
      })
    return () => {
      cancelled = true
    }
  }, [supported, s, season, key])
  return off
}
