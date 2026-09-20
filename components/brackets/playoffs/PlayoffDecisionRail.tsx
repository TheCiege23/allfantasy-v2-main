"use client"

import { useMemo } from "react"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import {
  abbreviate,
  roundLabel,
  seriesOdds,
  type BracketGraph,
} from "@/lib/playoffs/playoffBracketGraph"
import { isPlaceholderName } from "@/lib/playoffs/playoffTeamColors"

/**
 * The right rail: a per-series read, and the pool leaderboard.
 *
 * 🛑 THIS IS NOT A MODEL AND MUST NOT BE DRESSED AS ONE. The rows below are
 * arithmetic on two seed numbers — the design's own slope, four points per
 * seed of separation. The prototype's copy ("bullpen ERA is the widest gap in
 * the field", "Altuve's return slips past Game 1") implies scouting data this
 * app does not hold, and writing sentences like that from a seed comparison
 * would be fabrication at its most convincing.
 *
 * So every row says what it is, and the panel states its basis once at the
 * bottom. If a real model arrives later, it replaces the text AND the basis
 * line together.
 */

export type PlayoffDecisionRailProps = {
  view: PlayoffChallengeView
  graph: BracketGraph
  sport: string
}

/*
 * The rail's question is "is this a club", not "is this pickable" — a read on
 * "AL3 over AL6" is true and useless, so an unseeded pool gets the empty state
 * instead. `isPlaceholderName` is that test and lives in one place; the copy
 * of its regex that used to sit here was a second definition waiting to drift.
 */
const isPlaceholder = isPlaceholderName

export default function PlayoffDecisionRail({ view, graph, sport }: PlayoffDecisionRailProps) {
  const reads = useMemo(() => {
    return view.series
      .slice()
      .sort((a, b) => a.roundIndex - b.roundIndex || a.seriesNumber - b.seriesNumber)
      .filter((s) => !isPlaceholder(s.homeTeamName) && !isPlaceholder(s.awayTeamName))
      .map((s) => {
        const odds = seriesOdds(s)
        const favHome = odds.home >= odds.away
        const fav = favHome ? s.homeTeamName : s.awayTeamName
        const dog = favHome ? s.awayTeamName : s.homeTeamName
        const favSeed = favHome ? s.homeSeed : s.awaySeed
        const dogSeed = favHome ? s.awaySeed : s.homeSeed
        const edge = Math.abs(odds.home - odds.away)
        const text =
          edge === 0
            ? `${abbreviate(fav)} and ${abbreviate(dog)} are seeded level — no edge either way.`
            : `${abbreviate(fav)} over ${abbreviate(dog)} — seed ${favSeed} against seed ${dogSeed}, a ${edge}-point edge on seeding alone.`
        return { id: s.id, tag: roundLabel(sport, s.round), text, decided: !!s.winnerTeamName }
      })
  }, [sport, view.series])

  const standings = useMemo(() => {
    return view.entries
      .slice()
      .sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0) || a.name.localeCompare(b.name))
  }, [view.entries])

  const viewerId = view.viewerUserId ?? null

  return (
    <>
      <section className="af-pb-card" data-testid="pb-decision-rail">
        <div className="af-pb-rail-head">Series read</div>
        {reads.length === 0 ? (
          <p className="af-pb-basis" style={{ borderTop: 0 }}>
            Nothing to read yet — the field is set once the regular season ends and seeding runs.
          </p>
        ) : (
          reads.slice(0, 8).map((r) => (
            <div className="af-pb-reason" key={r.id}>
              <span className="af-pb-reason-tag af-pb-mono">{r.tag}</span>
              <span className="af-pb-reason-text">
                {r.text}
                {r.decided ? " (already decided)" : ""}
              </span>
            </div>
          ))
        )}
        <p className="af-pb-basis">
          Basis: seeding only. These lines compare two seed numbers on a fixed slope — they are not
          a scouting model, and they do not know about rotations, injuries or form.
        </p>
      </section>

      <section className="af-pb-card" data-testid="pb-leaderboard">
        <div className="af-pb-rail-head">Pool standings</div>
        {standings.length === 0 ? (
          <p className="af-pb-basis" style={{ borderTop: 0 }}>No entries yet.</p>
        ) : (
          standings.map((e, i) => (
            <div className="af-pb-lb-row" key={e.id} data-you={e.userId === viewerId ? "true" : undefined}>
              <span className="af-pb-lb-rank af-pb-mono">{i + 1}</span>
              <span className="af-pb-lb-name">
                {e.name}
                {e.userId === viewerId ? " · you" : ""}
              </span>
              <span className="af-pb-lb-pts af-pb-mono">{e.totalScore ?? 0}</span>
            </div>
          ))
        )}
      </section>
    </>
  )
}
