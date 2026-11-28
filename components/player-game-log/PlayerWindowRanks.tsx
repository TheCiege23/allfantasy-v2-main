'use client'

import { useEffect, useState } from 'react'
import {
  playerStatQuery,
  type GameLogScoring,
  type GameLogScoringContext,
  type PlayerGameLogKey,
} from './PlayerGameLogTable'
import './af-game-log.css'

/**
 * Rank over the last 7 / 14 / 30 days and the season — overall and at his position, on the league's
 * scoring when there is one. "Average rank over different time periods is probably the single most
 * useful metric for start/sit and waiver decisions" (r/fantasyhockey, on Yahoo's 2026 redesign
 * removing it). Data: /api/players/window-ranks. Hidden, never empty: no ranks, no strip.
 */

type WindowRank = {
  key: string
  label: string
  rank: number | null
  positionRank: number | null
  points: number | null
  games: number
  perGame: number | null
  population: number
}
type Payload = { ranks: { position: string | null; windows: WindowRank[] } | null; scoring?: GameLogScoring; asOf?: string }

function fmt(v: number | null): string {
  return v == null ? '—' : String(Math.round(v * 10) / 10)
}

export default function PlayerWindowRanks({
  sport,
  playerKey,
  scoringContext,
}: {
  sport: string
  playerKey: PlayerGameLogKey
  scoringContext?: GameLogScoringContext
}) {
  const [data, setData] = useState<Payload | null>(null)
  const query = playerStatQuery(sport, playerKey, null, scoringContext)

  useEffect(() => {
    let alive = true
    fetch(`/api/players/window-ranks?${query}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Payload | null) => {
        if (alive && j && j.ranks && Array.isArray(j.ranks.windows)) setData(j)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [query])

  const windows = data?.ranks?.windows ?? []
  if (!windows.some((w) => w.rank != null)) return null
  const pos = data?.ranks?.position && data.ranks.position !== '—' ? data.ranks.position : null
  const scoringLabel =
    data?.scoring?.kind === 'league' ? (data.scoring.leagueName ? `${data.scoring.leagueName} scoring` : 'your league’s scoring') : 'default scoring'

  return (
    <section className="af-gl af-gl-ranks" data-testid="af-window-ranks" aria-label="Fantasy rank by time window">
      <p className="af-gl-note">
        Fantasy rank, {scoringLabel}. Games before today.
      </p>
      <div className="af-gl-ranks-grid">
        {windows.map((w) => (
          <div key={w.key} className="af-gl-rank" data-testid={`af-window-rank-${w.key}`}>
            <span className="af-gl-rank-label">{w.label}</span>
            <span className="af-gl-rank-value">{w.rank != null ? `#${w.rank}` : '—'}</span>
            <span className="af-gl-rank-sub">{w.rank != null && pos && w.positionRank != null ? `${pos} #${w.positionRank}` : w.rank == null ? 'no games' : ''}</span>
            <span className="af-gl-rank-sub" title={w.games ? `${fmt(w.points)} points in ${w.games} games` : undefined}>
              {w.games ? `${fmt(w.perGame)}/g · ${w.games} GP` : ''}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
