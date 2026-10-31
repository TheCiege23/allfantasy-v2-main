'use client'

import { useEffect, useState } from 'react'
import { buildLastWeekRecap, type LastWeekRecap, type WeekResultRow } from '@/lib/league-media/redraftLeagueHome'
import '@/components/league/native/redraft-home.css'

/**
 * Last week's recap: top score, closest finish, biggest win — from the finalized `TeamWeekResult`
 * rows `/api/leagues/[id]/scoring/matchups` already serves (a DB read, no provider call). Renders
 * nothing until a complete, final week loads; the caller only mounts it for a points league past
 * week 1.
 */
export function RedraftLastWeekRecap({ leagueId, season, week }: { leagueId: string; season: number; week: number }) {
  const [recap, setRecap] = useState<LastWeekRecap | null>(null)

  useEffect(() => {
    let cancelled = false
    setRecap(null)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/scoring/matchups?season=${season}&week=${week}`, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ week?: number; matchups?: WeekResultRow[] }>) : null))
      .then((d) => {
        // The route clamps a bad week to 1; only trust rows for the week that was asked for.
        if (!cancelled && d && d.week === week) setRecap(buildLastWeekRecap(week, d.matchups ?? null))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [leagueId, season, week])

  if (!recap) return null
  return (
    <section className="rdh-card rdh-recap" aria-label={`Week ${recap.week} recap`} data-testid="redraft-last-week">
      <h2 className="rdh-label">Week {recap.week} recap</h2>
      <div className="rdh-recap-grid">
        <div>
          <span className="rdh-recap-label">Top score</span>
          <strong className="rdh-recap-value rdh-accent-text">{recap.topScore.points.toFixed(1)}</strong>
          <span className="rdh-recap-team">{recap.topScore.team}</span>
        </div>
        {recap.closest ? (
          <div>
            <span className="rdh-recap-label">Closest finish</span>
            <strong className="rdh-recap-value">By {recap.closest.margin.toFixed(1)}</strong>
            <span className="rdh-recap-team">{recap.closest.winner} over {recap.closest.loser}</span>
          </div>
        ) : null}
        {recap.biggest ? (
          <div>
            <span className="rdh-recap-label">Biggest win</span>
            <strong className="rdh-recap-value">By {recap.biggest.margin.toFixed(1)}</strong>
            <span className="rdh-recap-team">{recap.biggest.winner} over {recap.biggest.loser}</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
