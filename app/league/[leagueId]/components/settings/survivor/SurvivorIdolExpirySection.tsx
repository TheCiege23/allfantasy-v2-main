'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Select, Input } from '../../../tabs/settings/components'
import { survivorIdolExpiryRule, survivorIdolExpiryText } from '@/lib/survivor/survivorIdolExpiry'
import type { SurvivorIdolExpiryMode } from '@/lib/survivor/survivorSettings'

type ExpirySettings = { idolExpiryMode: SurvivorIdolExpiryMode; idolExpiryRemainingPlayers: number; idolExpiryWeek: number }

/**
 * ONE league rule for when hidden idols stop being playable (owner's call, 2026-10-20). Saved
 * through the foundation settings, stamped on every idol at seeding, enforced at play time, and
 * shown to every holder in the reveal DM and the vault. Locks when the draft starts.
 */
export function SurvivorIdolExpirySection({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [settings, setSettings] = useState<ExpirySettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/state`, { credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || !payload.settings) throw new Error(payload.error ?? 'Could not load idol expiry')
      const rule = survivorIdolExpiryRule(payload.settings)
      setSettings({ idolExpiryMode: rule.mode, idolExpiryRemainingPlayers: rule.playersLeft, idolExpiryWeek: rule.week })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load idol expiry')
    }
  }, [leagueId])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!canEdit || !settings) return
    setSaving(true); setMessage(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/update-settings`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Could not save idol expiry')
      const rule = survivorIdolExpiryRule(payload.settings)
      setSettings({ idolExpiryMode: rule.mode, idolExpiryRemainingPlayers: rule.playersLeft, idolExpiryWeek: rule.week })
      setMessage('Idol expiry saved. Every idol holder sees this rule in their reveal and vault.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save idol expiry')
    } finally { setSaving(false) }
  }

  if (!settings) return <p role="status" className="px-6 text-sm text-white/50">{message ?? 'Loading idol expiry…'}</p>
  const rule = survivorIdolExpiryRule(settings)
  const valid = settings.idolExpiryMode !== 'players_left' || (Number.isInteger(settings.idolExpiryRemainingPlayers) && settings.idolExpiryRemainingPlayers >= 2)
  return (
    <div className="space-y-3 px-6 pb-2 text-[13px] text-white/85" data-testid="survivor-idol-expiry">
      <SettingsSection id="sv-idol-expiry" title="When idols expire">
        <SettingsRow label="Rule" description={survivorIdolExpiryText(rule)} control={
          <Select value={settings.idolExpiryMode} onChange={(value) => setSettings({ ...settings, idolExpiryMode: value === 'merge' ? 'merge' : value === 'week' ? 'week' : 'players_left' })} disabled={!canEdit || saving}>
            <option value="players_left">Once fewer than N managers remain</option>
            <option value="merge">At the merge</option>
            <option value="week">After a given week</option>
          </Select>
        } />
        {settings.idolExpiryMode === 'players_left' && <SettingsRow label="Managers remaining (N)" control={<Input type="number" min={2} max={24} value={settings.idolExpiryRemainingPlayers} onChange={(event) => setSettings({ ...settings, idolExpiryRemainingPlayers: Number(event.target.value) })} disabled={!canEdit || saving} className="w-24" aria-label="Managers remaining" />} />}
        {settings.idolExpiryMode === 'week' && <SettingsRow label="Last playable week" control={<Input type="number" min={1} max={52} value={settings.idolExpiryWeek} onChange={(event) => setSettings({ ...settings, idolExpiryWeek: Number(event.target.value) })} disabled={!canEdit || saving} className="w-24" aria-label="Last playable week" />} />}
      </SettingsSection>
      <div className="flex justify-end"><button type="button" onClick={() => void save()} disabled={!canEdit || saving || !valid} className="rounded-xl border border-[#ff3d81]/40 bg-cyan-950/40 px-5 py-2 text-sm text-[#ffd7e5] disabled:opacity-40">{saving ? 'Saving…' : 'Save idol expiry'}</button></div>
      {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
    </div>
  )
}
