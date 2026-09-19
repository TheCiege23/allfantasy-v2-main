'use client'

import { useEffect, useState } from 'react'
import { CORE_IDLE_REFRESH_MS } from '@/lib/core-app/coreRefreshPolicy'
import type { RailLeague, RailMatchupSummary } from './AfCoreShell'

type LiveScore = RailMatchupSummary & { season: number; week: number; updatedAt: string; fieldStanding?: RailMatchupSummary['standing'] }

/**
 * 🛑 NOT LESS THAN THIS, WHATEVER A CALLER PASSES. A missing argument arrives as `undefined`,
 * and `setInterval(fn, undefined)` is `setInterval(fn, 0)` — a tight polling loop against a
 * batched network route. This repo does not typecheck its tests (`tsconfig.json` excludes every
 * spec pattern), so a stale two-argument call in a suite would compile, run, and hammer.
 */
const MIN_RAIL_REFRESH_MS = 10_000

/**
 * Live rail scores, polled on the SHELL'S OWN REFRESH POLICY rather than a constant of its own.
 *
 * 🛑 THE POLICY EXISTED AND THIS POLL IGNORED IT. `coreRefreshIntervalMs` answers 20s while a
 * followed sport is live and 120s otherwise, and the shell's effect beside this one already
 * says what it is for: "The rail is a live surface. Refresh the server snapshot while games are
 * on, then back off between slates." This hook — the one that actually FETCHES the scores —
 * polled at a flat 30s.
 *
 * ⚠ AND ITS GATE IS `railOpen`, NOT "a game is on". On desktop the rail is expanded by default
 * (see `core-rail-default-open.test.tsx`), so in the offseason, on a Wednesday, an idle open tab
 * fetched every 30 seconds forever. The leagues are sent eight per request, so a sixty-league
 * account issued eight requests a poll — around 960 an hour, none of which could return a
 * changed score.
 *
 * Following the policy makes it FASTER when it matters (20s rather than 30s during a slate) and
 * four times quieter when it does not. The caller owns the decision, so there is one authority
 * for "is anything live" rather than a second copy here.
 */
export function useLiveRailScores(leagues: RailLeague[], enabled: boolean, refreshMs: number) {
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
            const response = await fetch(`/api/core/rail-scores?${query}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(40_000)]) })
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
    const everyMs = Math.max(
      MIN_RAIL_REFRESH_MS,
      Number.isFinite(refreshMs) && refreshMs > 0 ? refreshMs : CORE_IDLE_REFRESH_MS,
    )
    const interval = window.setInterval(() => void refresh(), everyMs)
    document.addEventListener('visibilitychange', refresh)
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [idsKey, enabled, refreshMs])
  return { scores, delayed }
}
