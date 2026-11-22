'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Toggle, Input } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'
import { SurvivorSideGamesSettings } from './SurvivorSideGamesSettings'

type ExileSettings = {
  exileIslandEnabled: boolean
  exileReturnWeek: number
  exileReturnTokens: number
}

export function SurvivorExilePanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  const [settings, setSettings] = useState<ExileSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/state`, { credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || !payload.settings) throw new Error(payload.error ?? 'Could not load Exile rules')
      const current = payload.settings as ExileSettings
      setSettings({
        exileIslandEnabled: current.exileIslandEnabled,
        exileReturnWeek: current.exileReturnWeek,
        exileReturnTokens: current.exileReturnTokens,
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load Exile rules')
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => { void load() }, [load])

  async function save() {
    if (!canEdit || !settings) return
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/update-settings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Could not save Exile rules')
      const current = payload.settings as ExileSettings
      setSettings({ exileIslandEnabled: current.exileIslandEnabled, exileReturnWeek: current.exileReturnWeek, exileReturnTokens: current.exileReturnTokens })
      setMessage('Exile rules saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save Exile rules')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
      <p className="text-[11px] text-amber-200/80">Voted-out managers compete on Exile. At the return week, the system brings back one qualifying manager with the highest token balance. Set these rules before the draft.</p>
      {loading && <p role="status" className="text-sm text-white/50">Loading Exile rules…</p>}
      {settings && <SettingsSection id="sv-exile-rules" title="Exile return">
        <SettingsRow label="Exile enabled" control={<Toggle checked={settings.exileIslandEnabled} onChange={(value) => setSettings((current) => current ? { ...current, exileIslandEnabled: value } : current)} disabled={!canEdit || saving} />} />
        <SettingsRow label="Return week" control={<Input type="number" min={2} max={51} value={settings.exileReturnWeek} onChange={(event) => setSettings((current) => current ? { ...current, exileReturnWeek: Number(event.target.value) } : current)} disabled={!canEdit || saving || !settings.exileIslandEnabled} className="w-24" />} />
        <SettingsRow label="Minimum tokens to qualify" control={<Input type="number" min={1} max={1000} value={settings.exileReturnTokens} onChange={(event) => setSettings((current) => current ? { ...current, exileReturnTokens: Number(event.target.value) } : current)} disabled={!canEdit || saving || !settings.exileIslandEnabled} className="w-24" />} />
      </SettingsSection>}
      {settings && <div className="flex justify-end"><button type="button" onClick={() => void save()} disabled={!canEdit || saving || !Number.isInteger(settings.exileReturnWeek) || settings.exileReturnWeek < 2 || settings.exileReturnWeek > 51 || !Number.isInteger(settings.exileReturnTokens) || settings.exileReturnTokens < 1 || settings.exileReturnTokens > 1000} className="rounded-xl border border-[#ff3d81]/40 bg-cyan-950/40 px-5 py-2 text-sm text-[#ffd7e5] disabled:opacity-40">{saving ? 'Saving…' : 'Save Exile rules'}</button></div>}
      {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
      {/* Exile economy and the side games: token → FAAB, lineup slots, team bids, secrecy, Token Pool, shop, Survivor Pool, auctions. */}
      <SurvivorSideGamesSettings leagueId={leagueId} canEdit={canEdit} />
      <Link href={`/survivor/${encodeURIComponent(leagueId)}/exile`} className="inline-flex text-sm text-cyan-300 hover:text-cyan-200">Open Exile dashboard →</Link>
    </div>
  )
}
