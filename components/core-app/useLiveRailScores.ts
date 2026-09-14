'use client'

import { useEffect, useState } from 'react'
import type { RailLeague, RailMatchupSummary } from './AfCoreShell'

type LiveScore = RailMatchupSummary & { season: number; week: number; updatedAt: string; fieldStanding?: RailMatchupSummary['standing'] }

export function useLiveRailScores(leagues: RailLeague[], enabled: boolean) {
  const [scores, setScores] = useState<Record<string, LiveScore>>({})
  const [delayed, setDelayed] = useState<string[]>([])
  const idsKey = JSON.stringify(leagues.filter(league => league.platform.toLowerCase() === 'sleeper').map(league => league.id))
  useEffect(() => {
    if (!enabled) return
    const ids: string[] = JSON.parse(idsKey)
    const controller = new AbortController()
    let busy = false
    async function refresh() {
      if (busy || document.visibilityState === 'hidden' || !ids.length) return
      busy = true
      try {
        for (let start = 0; start < ids.length && !controller.signal.aborted; start += 8) {
          const batch = ids.slice(start, start + 8)
          try {
            const query = new URLSearchParams(batch.map(id => ['league', id]))
            const response = await fetch(`/api/core/rail-scores?${query}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) })
            if (!response.ok) throw new Error('Refresh unavailable')
            const data = await response.json() as { updates: Record<string, LiveScore>; unavailable: string[] }
            if (controller.signal.aborted) return
            setScores(previous => ({ ...previous, ...data.updates }))
            setDelayed(previous => [...previous.filter(id => !batch.includes(id)), ...data.unavailable])
          } catch {
            if (!controller.signal.aborted) setDelayed(previous => [...new Set([...previous, ...batch])])
          }
        }
      } finally { busy = false }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 30_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [idsKey, enabled])
  return { scores, delayed }
}
