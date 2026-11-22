'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ProjectionData } from '@/components/sports/ProjectionCard'

/** Fetch projections for a single player by name. */
export function usePlayerProjection(playerName: string, sport: string) {
  const [data, setData] = useState<ProjectionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!playerName) { setLoading(false); return }
    let active = true
    fetch('/api/player-card-analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName, sport }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return
        if (d) {
          setData({
            playerName: d.playerName ?? playerName,
            position: d.position,
            team: d.team,
            projectedPoints: d.matchupPrediction?.expectedPoints ?? d.expectedFantasyPoints ?? null,
            projectedPointsPerGame: d.matchupPrediction?.expectedPointsPerGame ?? d.expectedFantasyPointsPerGame ?? null,
            ceiling: d.careerProjection?.ceilingScore ?? null,
            floor: d.careerProjection?.floorScore ?? null,
            restOfSeasonPoints: null,
            delta: null,
          })
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [playerName, sport])

  return { data, loading }
}

/** Fetch projections for multiple players (batch from SportsDataCache). */
export function useProjectionsList(sport: string, options?: { position?: string; limit?: number }) {
  const [data, setData] = useState<ProjectionData[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ sport: sport.toLowerCase(), limit: String(options?.limit ?? 50), sortBy: 'value' })
      if (options?.position) params.set('position', options.position)
      const res = await fetch(`/api/player-valuations?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
      setData(rows.map((r: any) => ({
        playerName: r.name ?? r.n ?? '',
        position: r.position ?? r.pos ?? '',
        team: r.team ?? r.tm ?? 'FA',
        projectedPoints: r.expectedPoints ?? r.projectedPoints ?? null,
        projectedPointsPerGame: r.expectedPointsPerGame ?? null,
        ceiling: null,
        floor: null,
        restOfSeasonPoints: null,
        delta: r.trend ?? r.tr ?? null,
      })))
    } catch {} finally {
      setLoading(false)
    }
  }, [sport, options?.position, options?.limit])

  useEffect(() => { fetchData() }, [fetchData])

  return { data, loading, refresh: fetchData }
}
