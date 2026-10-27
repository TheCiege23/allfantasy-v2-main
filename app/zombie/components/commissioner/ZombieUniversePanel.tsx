'use client'

import { useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Input } from '@/app/league/[leagueId]/tabs/settings/components'

type Universe = {
  id: string
  name: string
  promotionCount: number
  relegationCount: number
  levels: { id: string; name: string; rankOrder: number }[]
  leagues: { id: string; name: string | null; levelId: string | null; status: string }[]
}

export function ZombieUniversePanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [loading, setLoading] = useState(true)
  const [universe, setUniverse] = useState<Universe | null>(null)
  const [promotionCount, setPromotionCount] = useState(2)
  const [relegationCount, setRelegationCount] = useState(2)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setMessage('')
      setUniverse(null)
      try {
        const leagueRes = await fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
        if (!leagueRes.ok) throw new Error('Could not load Zombie league.')
        const leagueData = await leagueRes.json() as { league?: { universeId?: string | null } }
        const universeId = leagueData.league?.universeId
        if (!universeId) return
        if (!canEdit) {
          setMessage('Universe settings are available to its commissioner.')
          return
        }
        const res = await fetch(`/api/zombie/universe-hub?universeId=${encodeURIComponent(universeId)}`, { credentials: 'include' })
        const data = await res.json().catch(() => ({})) as { universe?: Universe; error?: string }
        if (!res.ok || !data.universe) throw new Error(data.error || 'Could not load universe.')
        if (!active) return
        setUniverse(data.universe)
        setPromotionCount(data.universe.promotionCount)
        setRelegationCount(data.universe.relegationCount)
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Could not load universe.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [leagueId, canEdit])

  const locked = universe?.leagues.some((league) => !['setup', 'registering'].includes(league.status)) ?? false

  async function save() {
    if (!universe || !canEdit) return
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/zombie/universe-hub', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ universeId: universe.id, promotionCount, relegationCount }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; universe?: Pick<Universe, 'promotionCount' | 'relegationCount'> }
      if (!res.ok || !data.universe) throw new Error(data.error || 'Universe settings could not be saved.')
      setUniverse({ ...universe, ...data.universe })
      setMessage('Universe movement rules saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Universe settings could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 px-4 py-5 text-[13px] text-white/85 sm:px-6">
      {loading ? <p className="text-white/60">Loading universe…</p> : universe ? (
        <>
          <p className="text-white/65">{universe.name} · {universe.leagues.length} leagues across {universe.levels.length} levels</p>
          <SettingsSection id="zm-uni" title="Season movement">
            <SettingsRow label="Promotion count" description="Managers moving up at season end."
              control={<Input type="number" min={0} max={5} className="w-24" value={promotionCount}
                disabled={!canEdit || locked || saving} onChange={(event) => setPromotionCount(Number(event.target.value))} />} />
            <SettingsRow label="Relegation count" description="Managers moving down at season end."
              control={<Input type="number" min={0} max={5} className="w-24" value={relegationCount}
                disabled={!canEdit || locked || saving} onChange={(event) => setRelegationCount(Number(event.target.value))} />} />
          </SettingsSection>
          {locked ? <p className="text-amber-200/80">Movement counts are locked after a league starts.</p> : (
            <button type="button" onClick={() => void save()} disabled={!canEdit || saving}
              className="min-h-[44px] rounded-lg bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save movement rules'}
            </button>
          )}
          <section aria-label="Universe levels" className="space-y-2">
            {universe.levels.map((level) => (
              <div key={level.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="font-semibold">{level.name}</p>
                <p className="text-[11px] text-white/60">
                  {universe.leagues.filter((league) => league.levelId === level.id).length} leagues
                </p>
              </div>
            ))}
          </section>
        </>
      ) : <p className="text-white/65">{message || 'This Zombie league is not part of a universe.'}</p>}
      {universe && <p role="status" aria-live="polite" className="text-[11px] text-amber-200">{message}</p>}
    </div>
  )
}
