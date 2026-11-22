'use client'

import { createContext, useContext, useEffect } from 'react'
import type { RailMatchupSummary } from '@/components/core-app/AfCoreShell'

/**
 * The league rail's matchup scores, published up to the shell AFTER it paints (2026-11-22).
 *
 * WHY. Measured on the owner's 91-league account: the rail's matchup read was 12.5s of a 13.0s /core
 * shell, and the shell — rail, nav, topbar, and so the whole page — could not paint until it finished.
 * The owner agreed the rail may show names, crests and records first and fill in the scores a moment
 * later. The read still starts with the shell's other reads; only the WAIT moved.
 *
 * ⚠ SEPARATE FROM shellSignals.tsx ON PURPOSE. Those signals belong to one SCREEN: they are replaced
 * whole on every publish and cleared when the screen unmounts. The rail belongs to the SHELL, and two
 * publishers sharing one slot would overwrite each other's values.
 *
 * ⚠ NOT CLEARED ON UNMOUNT. On a tab click the slot re-streams; clearing would blank every score until
 * the new read lands. The previous scores stay until the new ones replace them — the same scores the
 * rail showed a second ago, never another account's (the shell is per signed-in viewer).
 */
export type RailScores = {
  byLeague: Record<string, RailMatchupSummary>
  weekLabel: string | null
}

type PublishScores = (scores: RailScores) => void

export const RailScoresContext = createContext<PublishScores | null>(null)

/** Rendered by the page once the rail's read lands. Renders nothing; publishes when the values change. */
export function PublishRailScores(scores: RailScores) {
  const publish = useContext(RailScoresContext)
  const serialised = JSON.stringify(scores)
  useEffect(() => {
    if (!publish) return
    publish(JSON.parse(serialised) as RailScores)
  }, [publish, serialised])
  return null
}

/** The shell's own rail props with the published scores laid over them (the props carry none now). */
export function withRailScores<P extends { railMatchups?: Record<string, RailMatchupSummary>; railWeekLabel?: string | null }>(
  props: P,
  scores: RailScores | null,
): P {
  if (!scores) return props
  return { ...props, railMatchups: scores.byLeague, railWeekLabel: scores.weekLabel }
}
