"use client"

import { useEffect, type Dispatch, type SetStateAction } from "react"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import type { NbaCupPublicLive, NbaCupPublicScore } from "@/lib/playoffs/nbaCupPublicLive"

/** Only merge score fields. Never replace names, draft/finalization state or the viewer's picks. */
export function mergeCupLiveView(current: PlayoffChallengeView, update: NbaCupPublicLive): PlayoffChallengeView {
  if (current.nbaCupLastSyncedAt && (!update.syncedAt || Date.parse(update.syncedAt) < Date.parse(current.nbaCupLastSyncedAt))) return current
  const scores = new Map(update.scores.map((score) => [score.entryId, score]))
  const fields = (score: NbaCupPublicScore) => ({ rank: score.rank, totalScore: score.totalScore,
    potentialTotal: score.potentialTotal, correctPicks: score.correctPicks, resolvedPicks: score.resolvedPicks })
  const active = current.activeEntry ? scores.get(current.activeEntry.id) : null
  return { ...current, series: update.series, nbaCupLastSyncedAt: update.syncedAt,
    entries: current.entries.map((entry) => { const score = scores.get(entry.id); return score ? { ...entry, ...fields(score) } : entry }),
    activeEntry: current.activeEntry && active ? { ...current.activeEntry, ...fields(active) } : current.activeEntry }
}

export function useNbaCupLiveView(challengeId: string, enabled: boolean, setView: Dispatch<SetStateAction<PlayoffChallengeView>>) {
  useEffect(() => {
    if (!enabled) return
    let stopped = false, pending = false
    const controller = new AbortController()
    const refresh = async () => {
      if (stopped || pending || document.visibilityState !== "visible") return
      pending = true
      try {
        const response = await fetch(`/api/brackets/playoffs/${encodeURIComponent(challengeId)}/live`, { cache: "no-store", signal: controller.signal })
        if (!response.ok) return
        const update = await response.json() as NbaCupPublicLive
        if (!stopped && Array.isArray(update.series) && Array.isArray(update.scores)) setView((current) => mergeCupLiveView(current, update))
      } catch { /* Preserve last verified scores and their source timestamp on a feed failure. */ }
      finally { pending = false }
    }
    const timer = setInterval(() => { void refresh() }, 15_000)
    const visible = () => { void refresh() }
    document.addEventListener("visibilitychange", visible)
    return () => { stopped = true; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible) }
  }, [challengeId, enabled, setView])
}
