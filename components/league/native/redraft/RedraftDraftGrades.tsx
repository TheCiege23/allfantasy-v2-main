'use client'

import { useEffect, useState } from 'react'
import { buildDraftGrades, type DraftGradeLine, type DraftGradeRow, type DraftGradeTeam } from '@/lib/league-media/redraftLeagueHome'
import '@/components/league/native/redraft-home.css'

/**
 * Post-draft grades for Draft HQ: the persisted `DraftGrade` rows (`GET /api/leagues/[id]/draft-grades`,
 * a DB read — this never triggers the POST that computes them). Rows that name no team of this league
 * are dropped; with nothing left the card does not render.
 */
export function RedraftDraftGrades({ leagueId, season, teams, userTeamId }: { leagueId: string; season: string; teams: readonly DraftGradeTeam[]; userTeamId: string | null }) {
  const [lines, setLines] = useState<DraftGradeLine[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setLines(null)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft-grades?season=${encodeURIComponent(season)}`, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ rows?: DraftGradeRow[] }>) : null))
      .then((d) => {
        if (!cancelled && d) setLines(buildDraftGrades(d.rows ?? null, teams, userTeamId))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [leagueId, season, teams, userTeamId])

  if (!lines) return null
  return (
    <section className="rdh-card rdh-grades" aria-label="Draft grades" data-testid="redraft-draft-grades">
      <div className="rdh-card-head">
        <h2 className="rdh-label">Draft grades</h2>
        <span className="rdh-card-note">{season} draft</span>
      </div>
      <ol className="rdh-grade-list">
        {lines.map((line) => (
          <li key={line.teamId} data-own-team={line.isYou}>
            <span className="rdh-grade-letter" data-grade={line.grade[0]}>{line.grade}</span>
            <strong>{line.teamName}</strong>
            {line.isYou ? <span className="rdh-tag rdh-tag-you">You</span> : null}
            <span className="rdh-grade-score">{line.score}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
