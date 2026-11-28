'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { MatchupCenterPayload } from '@/lib/matchup-center/types'
import { fmt1, initialsOf } from '@/lib/league/native/nativeScreenModels'
import { formatWinProbabilityPercents } from '@/lib/matchup-center/winProbability'
import { useLeagueRealtimeRefresh } from '@/hooks/useLeagueRealtimeRefresh'

/**
 * The Team tab's week, Sleeper-style (owner report, 2026-11-28: "Team tab needs a sleeper visual and
 * functional update"). Sleeper opens a team on one card — the team, its record, this week's score with
 * the projection under it, and the win chance against the opponent — and then the starters. Ours opened
 * on a page title, three buttons, a paragraph of instructions and automation cards before the first
 * player.
 *
 * Reads the same DB-backed route the Matchup tab does (`/api/leagues/[id]/matchup-center`), so the score,
 * projection and win chance here are the numbers the Matchup tab shows, and each starter's points this
 * week come with it. A failed read simply leaves the card without the week; the roster still works.
 */
export type TeamWeek = {
  week: number | null
  score: number
  projected: number | null
  opponentName: string | null
  opponentScore: number | null
  /** 0–100, this team's chance; null when either side's projection is incomplete. */
  winPct: number | null
  /** Each starter's points this week and his game state, keyed by player id. */
  points: Map<string, { points: number; state: 'upcoming' | 'live' | 'final' | string }>
  /** True once any starter on either side has played: a 0.0 before that is not a score. */
  started: boolean
}

export function useTeamWeek(leagueId: string, season: number | string | null | undefined): TeamWeek | null {
  const [week, setWeek] = useState<TeamWeek | null>(null)
  const load = useCallback(async () => {
    const y = Number(season)
    const seasonQuery = Number.isFinite(y) && y > 0 ? `?season=${y}` : ''
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/matchup-center${seasonQuery}`, { credentials: 'include', cache: 'no-store' })
      if (!res.ok) return
      const body = (await res.json().catch(() => null)) as { payload?: MatchupCenterPayload } | null
      const p = body?.payload
      if (!p?.left) return
      const points = new Map<string, { points: number; state: string }>()
      for (const s of p.left.starters ?? []) points.set(s.playerId, { points: s.currentPoints ?? 0, state: s.gameStatus })
      const all = [...(p.left.starters ?? []), ...(p.right?.starters ?? [])]
      const projected = p.left.projectedTotalIncludesFallback ? (p.left.afProjectedTotal ?? null) : p.left.projectedTotal
      setWeek({
        week: typeof p.week === 'number' ? p.week : null,
        score: p.left.totalPoints ?? 0,
        projected: projected != null && Number.isFinite(projected) ? projected : null,
        opponentName: p.right?.teamName ?? null,
        opponentScore: p.right ? p.right.totalPoints ?? 0 : null,
        winPct: formatWinProbabilityPercents(p.winProbabilityLeft ?? null)?.leftPct ?? null,
        points,
        started: all.some((s) => s.gameStatus !== 'upcoming'),
      })
    } catch {
      // The week is extra; the roster below never depends on it.
    }
  }, [leagueId, season])
  useEffect(() => {
    void load()
  }, [load])
  useLeagueRealtimeRefresh(leagueId, (env) => {
    const t = String(env.eventType ?? '')
    if (t.includes('score') || t === 'player_changed') void load()
  })
  return week
}

export function TeamWeekCard({
  teamName,
  avatarUrl,
  line,
  week,
  actions,
}: {
  teamName: string
  avatarUrl?: string | null
  /** "0-1 · 7th place · PF 0.0" */
  line: string
  week: TeamWeek | null
  actions: ReactNode
}) {
  const winPct = week?.winPct ?? null
  return (
    <section className="nls-teamcard" aria-label={`${teamName}, this week`} data-testid="team-week-card">
      <div className="nls-teamcard-top">
        <span className="nls-teamcard-avatar" aria-hidden>
          {avatarUrl ? <img src={avatarUrl} alt="" loading="lazy" /> : initialsOf(teamName)}
        </span>
        <div className="nls-teamcard-id">
          <p className="nls-eyebrow">My team{week?.week ? ` · Week ${week.week}` : ''}</p>
          <h2 className="nls-title">{teamName}</h2>
          <p className="nls-sub">{line}</p>
        </div>
        {week ? (
          <div className="nls-teamcard-score" data-testid="team-week-score">
            <strong>{week.started ? fmt1(week.score) : '—'}</strong>
            {week.projected != null ? <small>Proj {fmt1(week.projected)}</small> : null}
          </div>
        ) : null}
      </div>
      {week && (week.opponentName || winPct != null) ? (
        <div className="nls-teamcard-vs">
          <span>
            {week.opponentName ? <>vs <b>{week.opponentName}</b>{week.started && week.opponentScore != null ? ` · ${fmt1(week.opponentScore)}` : ''}</> : 'No opponent this week'}
          </span>
          {winPct != null ? <span data-testid="team-week-win" data-tone={winPct >= 50 ? 'good' : 'bad'}>{winPct}% win</span> : null}
        </div>
      ) : null}
      {winPct != null ? (
        <div className="nls-teamcard-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={winPct} aria-label={`${teamName} win chance`}>
          <span style={{ width: `${winPct}%` }} data-tone={winPct >= 50 ? 'good' : 'bad'} />
        </div>
      ) : null}
      <div className="nls-teamcard-actions">{actions}</div>
    </section>
  )
}
