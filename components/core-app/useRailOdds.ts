'use client'

import { useEffect, useState } from 'react'

/**
 * Your win probability per league, for the league list's odds bar — from `/api/core/rail-odds`,
 * which reads the same matchup board the Matchup screen draws (see that route).
 *
 * ⚠ ASKED ONCE PER FEW MINUTES, NOT POLLED. The board reads the whole portfolio, so the list asks
 * when it opens and reuses the answer across every /core screen until it ages out. While games are
 * live it ages out sooner, so the bar follows the score. A failed read draws no bar, never a stale
 * guess presented as fresh: the last good answer is kept only within its own age limit.
 */
const IDLE_TTL_MS = 5 * 60_000
const LIVE_TTL_MS = 90_000

type OddsAnswer = { at: number; odds: Record<string, number>; liveNow: boolean }
let shared: OddsAnswer | null = null
let inflight: Promise<OddsAnswer | null> | null = null

function fresh(answer: OddsAnswer | null, now: number): answer is OddsAnswer {
  return answer != null && now - answer.at < (answer.liveNow ? LIVE_TTL_MS : IDLE_TTL_MS)
}

async function fetchOdds(): Promise<OddsAnswer | null> {
  try {
    const res = await fetch('/api/core/rail-odds', { credentials: 'same-origin' })
    if (!res.ok) return null
    const body = (await res.json()) as { odds?: Record<string, unknown>; liveNow?: unknown }
    const odds: Record<string, number> = {}
    for (const [id, p] of Object.entries(body.odds ?? {})) {
      if (typeof p === 'number' && p > 0 && p < 1) odds[id] = p
    }
    return { at: Date.now(), odds, liveNow: body.liveNow === true }
  } catch {
    return null
  }
}

/** Test seam: forget the shared answer between cases. */
export function resetRailOddsCache(): void {
  shared = null
  inflight = null
}

export function useRailOdds(enabled: boolean): Record<string, number> {
  const [odds, setOdds] = useState<Record<string, number>>(() => (fresh(shared, Date.now()) ? shared.odds : {}))
  useEffect(() => {
    if (!enabled) return
    let live = true
    const read = () => {
      if (fresh(shared, Date.now())) {
        setOdds(shared.odds)
        return
      }
      // A background tab keeps what it has; it asks again when it is looked at.
      if (document.visibilityState === 'hidden') return
      inflight ??= fetchOdds().finally(() => {
        inflight = null
      })
      void inflight.then((answer) => {
        if (answer) shared = answer
        if (live) setOdds(fresh(shared, Date.now()) ? shared.odds : {})
      })
    }
    read()
    // Re-read when the shared answer ages out, while the list stays open.
    const timer = window.setInterval(read, LIVE_TTL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [enabled])
  return odds
}
