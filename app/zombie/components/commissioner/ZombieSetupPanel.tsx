'use client'

import { useEffect, useState } from 'react'
import { ZombieReadinessPanel } from '@/components/zombie/ZombieReadinessPanel'
import { ZombieUniverseRenewalPanel } from '@/components/zombie/ZombieUniverseRenewalPanel'

type LeagueOverview = {
  name?: string | null
  sport?: string
  season?: number
  status?: string
  teamCount?: number
  totalWeeks?: number | null
  universeId?: string | null
  experienceMode?: 'simple' | 'enhanced'
  level?: { name?: string | null } | null
}

export function ZombieSetupPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [league, setLeague] = useState<LeagueOverview | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

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

  const mode = league.experienceMode === 'simple' ? 'simple' : 'enhanced'
  const editable = canEdit && ['setup', 'registering'].includes(league.status ?? '')

  async function saveMode(next: 'simple' | 'enhanced') {
    if (!editable) return
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/zombie/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ leagueId, experienceMode: next }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not save experience.')
      setLeague((current) => current ? { ...current, experienceMode: next } : current)
      setMessage(`${next === 'simple' ? 'Simple' : 'Enhanced'} Zombie saved for the upcoming draft.`)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not save experience.')
    } finally { setSaving(false) }
  }

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
      {canEdit && <ZombieReadinessPanel key={leagueId} leagueId={leagueId} />}
      {canEdit && !league.universeId && league.season != null && <ZombieUniverseRenewalPanel key={leagueId+':'+league.season} leagueId={leagueId} season={league.season} />}
      <h3 className="font-semibold text-white">League structure</h3>
      <fieldset className="rounded-xl border border-white/10 bg-white/[0.04] p-3" disabled={!editable || saving}>
        <legend className="px-1 font-semibold text-white">Experience</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['simple', 'enhanced'] as const).map((choice) => (
            <button key={choice} type="button" onClick={() => void saveMode(choice)}
              aria-pressed={mode === choice}
              className={`min-h-[48px] rounded-xl border p-3 text-left ${mode === choice ? 'border-red-400 bg-red-950/50' : 'border-white/15 bg-black/20'}`}>
              <span className="block font-semibold text-white">{choice === 'simple' ? 'Simple Zombie' : 'Enhanced Zombie'}</span>
              <span className="mt-1 block text-xs text-white/65">{choice === 'simple' ? 'Automatic revival, one serum to revive, no weapons or ambushes.' : 'Serums, defensive weapons, ambushes, and full weekly story.'}</span>
            </button>
          ))}
        </div>
        {!editable && <p className="mt-2 text-xs text-amber-200">Experience locks when the draft starts.</p>}
        {message && <p role="status" className="mt-2 text-xs text-white">{message}</p>}
      </fieldset>
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
          ? 'Team count is set at creation. Draft and scoring use the standard league settings before the season starts.'
          : 'Only the commissioner can change league settings.'}
      </p>
    </div>
  )
}
