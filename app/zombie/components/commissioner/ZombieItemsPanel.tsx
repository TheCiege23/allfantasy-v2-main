'use client'

import { useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Input } from '@/app/league/[leagueId]/tabs/settings/components'

type Payload = {
  league?: {
    status?: string
    sport?: string
    config?: { serumReviveCount?: number; autoSerumRevive?: boolean } | null
  }
  viewerIsCommissioner?: boolean
}

export function ZombieItemsPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [beta, setBeta] = useState(false)
  const [cost, setCost] = useState(2)
  const [automatic, setAutomatic] = useState(false)
  const [commissioner, setCommissioner] = useState(false)
  const [locked, setLocked] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const editable = canEdit && commissioner && !locked && !loading && !saving && !beta

  useEffect(() => {
    let active = true
    setLoading(true)
    setMessage('')
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load serum settings.')
        return (await response.json()) as Payload
      })
      .then((data) => {
        if (!active) return
        setLocked(!['setup', 'registering'].includes(data.league?.status ?? ''))
        const isBeta = data.league?.sport?.toUpperCase() === 'NFL'
        setBeta(isBeta)
        setCost(isBeta ? 2 : data.league?.config?.serumReviveCount ?? 2)
        setAutomatic(isBeta || (data.league?.config?.autoSerumRevive ?? false))
        setCommissioner(Boolean(data.viewerIsCommissioner))
      })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : 'Could not load settings.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId])

  async function save() {
    if (!editable) return
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/zombie/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId, serumReviveCount: cost, autoSerumRevive: automatic }),
      })
      const result = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not save serum settings.')
      setMessage('Serum settings saved. Newly generated rules will use this cost.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save serum settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 px-4 py-5 text-[13px] text-white/85 sm:px-6">
      {beta && <p className="rounded-xl border border-teal-400/25 bg-teal-950/20 p-4 text-teal-100">2025 NFL rules: automatic revival requires two serums and cannot occur in the week of infection. Serums add +10 against Zombies; weapons equip automatically. These rules are fixed.</p>}
      <SettingsSection id="zm-serum" title="Serums">
        <SettingsRow
          label="Serums to revive"
          description="A Zombie spends exactly this many. Extra serums stay in their inventory."
          control={<Input aria-label="Serums to revive" type="number" min={1} max={5} value={cost} onChange={(event) => setCost(Number(event.target.value))} disabled={!editable} className="min-h-[44px] w-24" />}
        />
        <SettingsRow
          label="Automatic revival"
          description="After a week resolves, revive Zombies with enough serums. Leave off to require @Chimmy revive."
          control={<label className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center"><input aria-label="Automatic revival" type="checkbox" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} disabled={!editable} className="h-5 w-5 accent-red-500" /></label>}
        />
      </SettingsSection>
      {locked && !loading && <p className="text-amber-200">Competitive Zombie rules are locked for this season.</p>}
      <button type="button" onClick={() => void save()} disabled={!editable} className="min-h-[44px] rounded-lg bg-red-700/30 px-5 py-2 font-semibold text-red-100 disabled:opacity-40">
        {saving ? 'Saving…' : 'Save serum settings'}
      </button>
      {message && <p role="status" className="text-white/70">{message}</p>}
    </div>
  )
}
