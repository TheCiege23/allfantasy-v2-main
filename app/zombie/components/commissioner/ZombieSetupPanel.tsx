'use client'

import { useEffect, useState } from 'react'

type LeagueOverview = {
  name?: string | null
  sport?: string
  season?: number
  status?: string
  teamCount?: number
  totalWeeks?: number | null
  universeId?: string | null
  level?: { name?: string | null } | null
}

export function ZombieSetupPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [league, setLeague] = useState<LeagueOverview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLeague(null)
    setError('')
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load league structure.')
        return (await response.json()) as { league?: LeagueOverview }
      })
      .then((data) => {
        if (active) setLeague(data.league ?? null)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load league structure.')
      })
    return () => { active = false }
  }, [leagueId])

  if (error) return <p role="alert" className="px-4 py-6 text-sm text-red-200 sm:px-6">{error}</p>
  if (!league) return <p className="px-4 py-6 text-sm text-white/60 sm:px-6">Loading league structure…</p>

  const rows = [
    ['League', league.name || 'Zombie League'],
    ['Sport and season', `${league.sport ?? 'Unknown'} ${league.season ?? ''}`.trim()],
    ['Teams', String(league.teamCount ?? '—')],
    ['Scoring weeks', String(league.totalWeeks ?? '—')],
    ['Status', league.status ?? 'Unknown'],
    ['Universe', league.universeId ? (league.level?.name || 'Assigned') : 'Single league'],
  ]

  return (
    <div className="space-y-4 px-4 py-5 text-[13px] text-white/85 sm:px-6">
      <h3 className="font-semibold text-white">League structure</h3>
      <dl className="grid gap-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-h-[60px] rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <dt className="text-[11px] text-white/55">{label}</dt>
            <dd className="mt-1 font-medium text-white">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12px] text-white/60">
        {canEdit
          ? 'Team count, draft, and scoring are managed in the standard league settings before the season starts.'
          : 'Only the commissioner can change league settings.'}
      </p>
    </div>
  )
}
