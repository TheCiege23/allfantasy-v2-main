'use client'

import { useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Input } from '@/app/league/[leagueId]/tabs/settings/components'

type Payload = {
  league?: {
    config?: { serumReviveCount?: number; autoSerumRevive?: boolean } | null
  }
  viewerIsCommissioner?: boolean
}

export function ZombieItemsPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [cost, setCost] = useState(2)
  const [automatic, setAutomatic] = useState(false)
  const [commissioner, setCommissioner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const editable = canEdit && commissioner && !loading && !saving

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load serum settings.')
        return (await response.json()) as Payload
      })
      .then((data) => {
        if (!active) return
        setCost(data.league?.config?.serumReviveCount ?? 2)
        setAutomatic(data.league?.config?.autoSerumRevive ?? false)
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
      <SettingsSection id="zm-serum" title="Serums">
        <SettingsRow
          label="Serums to revive"
          description="A Zombie spends exactly this many. Extra serums stay in their inventory."
          control={<Input type="number" min={1} max={10} value={cost} onChange={(event) => setCost(Number(event.target.value))} disabled={!editable} className="w-24" />}
        />
        <SettingsRow
          label="Automatic revival"
          description="After a week resolves, revive Zombies with enough serums. Leave off to require @Chimmy revive."
          control={<input type="checkbox" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} disabled={!editable} className="h-5 w-5 accent-red-500" />}
        />
      </SettingsSection>
      <button type="button" onClick={() => void save()} disabled={!editable} className="min-h-[44px] rounded-lg bg-red-700/30 px-5 py-2 font-semibold text-red-100 disabled:opacity-40">
        {saving ? 'Saving…' : 'Save serum settings'}
      </button>
      {message && <p role="status" className="text-white/70">{message}</p>}
    </div>
  )
}
