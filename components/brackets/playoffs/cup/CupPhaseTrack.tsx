"use client"

import type { PlayoffSeriesView } from "@/lib/playoffs/types"
import { pointsForSeries } from "@/lib/playoffs/playoffScoring"
import { cupGameState } from "@/lib/playoffs/nbaCupBoard"
import "./af-nba-cup.css"

const PHASES = [
  { round: "cup_group_play", label: "Group Play", note: "6 groups of 5" },
  { round: "cup_quarterfinals", label: "Quarterfinals", note: "higher seed hosts" },
  { round: "cup_semifinals", label: "Semifinals", note: null },
  { round: "cup_championship", label: "Championship", note: null },
] as const

function fmt(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(ms))
}

/**
 * The tournament's four phases across the pool header, with the current one
 * lit. Dates and the knockout venue come from the synced game rows; a phase
 * with no scheduled game says "Dates TBA" rather than borrowing last season's.
 */
export default function CupPhaseTrack({ series, sport }: { series: PlayoffSeriesView[]; sport: string }) {
  const phases = PHASES.map((phase) => {
    const rows = series.filter((row) => row.round === phase.round)
    const times = rows.map((row) => Date.parse(row.startsAt ?? "")).filter(Number.isFinite).sort((a, b) => a - b)
    const dates = times.length ? (fmt(times[0]) === fmt(times[times.length - 1]) ? fmt(times[0]) : `${fmt(times[0])} – ${fmt(times[times.length - 1])}`) : "Dates TBA"
    const live = rows.some((row) => cupGameState(row) === "live")
    const done = rows.length > 0 && rows.every((row) => cupGameState(row) === "final")
    const place = phase.note ?? rows.find((row) => row.location)?.location ?? null
    return { ...phase, dates, live, done, place, points: pointsForSeries({ round: phase.round } as PlayoffSeriesView, sport), started: rows.some((row) => cupGameState(row) !== "scheduled") }
  })
  // The current phase is the first one not yet finished.
  const current = phases.findIndex((p) => !p.done)

  return (
    <ol className="af-cup-phases af-cup" aria-label="Tournament phases">
      {phases.map((p, i) => (
        <li key={p.round} data-state={i === current ? "now" : p.done ? "done" : "next"} data-final={p.round === "cup_championship" ? "true" : undefined}>
          <span className="af-cup-phase-label">
            {i === current ? (p.live ? <><span className="af-cup-dot" aria-hidden="true" />Live · </> : "Now · ") : p.done ? "Done · " : ""}
            {p.label}
          </span>
          <strong>{p.dates}</strong>
          <span className="af-cup-phase-note">{p.points} pt{p.points === 1 ? "" : "s"} per pick{p.place ? ` · ${p.place}` : ""}</span>
        </li>
      ))}
    </ol>
  )
}
