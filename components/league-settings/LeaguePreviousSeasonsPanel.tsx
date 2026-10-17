'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Calendar, Trophy, ChevronRight } from 'lucide-react'

type SeasonRow = {
  season: number
  championName: string | null
  championAvatar: string | null
  runnerUpName: string | null
  regularSeasonWinnerName: string | null
  teamCount: number | null
  scoringFormat: string | null
  isDynasty: boolean
  status: string | null
}

interface Props {
  leagueId: string
  sportLabel?: string
  /** e.g. redraft, keeper, dynasty — shown for all league formats */
  leagueFormatLabel?: string | null
}

export function LeaguePreviousSeasonsPanel({ leagueId, sportLabel, leagueFormatLabel }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [leagueName, setLeagueName] = useState<string>('')
  const [seasons, setSeasons] = useState<SeasonRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/history`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load history')
        return
      }
      setLeagueName(typeof data.leagueName === 'string' ? data.leagueName : '')
      setSeasons(Array.isArray(data.seasons) ? data.seasons : [])
    } catch {
      setError('Could not load history')
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="space-y-3 px-1 py-4">
        <div className="h-8 animate-pulse rounded-lg bg-white/[0.06]" />
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-950/20 px-4 py-3 text-[13px] text-red-200">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-white">Previous Leagues</h3>
        <p className="mt-0.5 text-xs text-white/50">
          Seasons linked to this league{leagueName ? ` · ${leagueName}` : ''}
          {sportLabel ? ` · ${sportLabel}` : ''}
          {leagueFormatLabel ? ` · ${leagueFormatLabel}` : ''}.
        </p>
      </div>

      <div className="space-y-2">
        {seasons.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-8 text-center text-[13px] text-white/40">
            No archived seasons yet. History appears after seasons complete or when imports include past years.
          </div>
        ) : (
          seasons.map((s) => {
            const isLive = s.status === 'active'
            return (
              <Link
                key={s.season}
                href={`/league/${encodeURIComponent(leagueId)}/standings?season=${encodeURIComponent(String(s.season))}`}
                className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#0d1526]/80 px-3 py-3 transition hover:border-cyan-500/25 hover:bg-white/[0.03]"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                  <Calendar className="h-5 w-5 text-cyan-300/80" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-white">{s.season}</span>
                    {isLive ? (
                      <span className="rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-[11px] font-bold uppercase text-cyan-200">
                        Current
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45">
                    {s.championName ? (
                      <span className="inline-flex items-center gap-1 text-amber-200/90">
                        <Trophy className="h-3 w-3 shrink-0" />
                        {s.championName}
                      </span>
                    ) : (
                      <span className="text-white/35">Champion TBD</span>
                    )}
                    {s.runnerUpName ? <span>Runner-up · {s.runnerUpName}</span> : null}
                    {s.teamCount != null ? <span>{s.teamCount} teams</span> : null}
                    {s.scoringFormat ? <span className="truncate">{s.scoringFormat}</span> : null}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-white/25" />
              </Link>
            )
          })
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-white/35">
        Full brackets, draft recaps, and transaction logs continue to live on league tools (standings, matchups,
        draft room) for the active season.
      </p>
    </div>
  )
}
