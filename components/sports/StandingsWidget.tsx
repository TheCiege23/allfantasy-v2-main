'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Trophy, ChevronRight } from 'lucide-react'

type StandingTeam = {
  rank: number
  teamName: string
  wins: number
  losses: number
  ties?: number
  pointsFor?: number
}

export function StandingsWidget({ leagueId, sport }: { leagueId?: string; sport?: string }) {
  const [teams, setTeams] = useState<StandingTeam[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!leagueId) { setLoading(false); return }
    let active = true
    fetch(`/api/sports?sport=${encodeURIComponent(sport ?? 'NFL')}&dataType=standings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active) return
        const rows = Array.isArray(data?.data) ? data.data : []
        setTeams(
          rows.slice(0, 5).map((t: any, i: number) => ({
            rank: i + 1,
            teamName: t.name ?? t.teamName ?? t.team ?? `Team ${i + 1}`,
            wins: Number(t.wins ?? 0),
            losses: Number(t.losses ?? 0),
            ties: t.ties != null ? Number(t.ties) : undefined,
            pointsFor: t.pointsFor != null ? Number(t.pointsFor) : undefined,
          }))
        )
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId, sport])

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-5">
        <div className="mb-3 h-4 w-24 animate-pulse rounded bg-white/[0.06]" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="mb-2 h-8 animate-pulse rounded-lg bg-white/[0.04]" />
        ))}
      </div>
    )
  }

  if (teams.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-5">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-white/30">
          <Trophy className="h-3.5 w-3.5" /> Standings
        </div>
        <p className="mt-3 text-xs text-white/40">No standings data yet. Import a league to see standings.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-white/30">
          <Trophy className="h-3.5 w-3.5" /> Standings
        </div>
        {leagueId && (
          <Link
            href={`/league/${leagueId}?tab=standings`}
            className="flex items-center gap-0.5 text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
          >
            Full <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="space-y-1">
        {teams.map((t) => (
          <div key={t.rank} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[12px] hover:bg-white/[0.03]">
            <span className="w-5 text-center font-bold text-white/30">{t.rank}</span>
            <span className="flex-1 truncate font-medium text-white/80">{t.teamName}</span>
            <span className="text-white/50">
              {t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ''}
            </span>
            {t.pointsFor != null && (
              <span className="text-[11px] text-white/30">{t.pointsFor.toFixed(1)} PF</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
