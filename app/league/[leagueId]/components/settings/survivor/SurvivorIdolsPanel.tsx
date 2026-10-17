'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Input } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'

type IdolConfig = { idolCount: number; idolPowerPool: string[] | null }
const AVAILABLE_POWERS = [
  ['vote_shield', 'Vote Shield'], ['extra_vote', 'Extra Vote'], ['skip_tribal', 'Council Pass'],
  ['vote_steal', 'Vote Steal'], ['triple_steal', 'Triple Raid'], ['island_raid', 'Island Raid'],
] as const
const DEFAULT_POOL = AVAILABLE_POWERS.map(([power]) => power)

export function SurvivorIdolsPanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  const [config, setConfig] = useState<IdolConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const [rulesResponse, configResponse] = await Promise.all([
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/state`, { credentials: 'include' }),
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, { credentials: 'include' }),
      ])
      const [rules, details] = await Promise.all([rulesResponse.json(), configResponse.json()])
      if (!rulesResponse.ok || !rules.settings || !configResponse.ok) throw new Error(rules.error ?? details.error ?? 'Could not load idol rules')
      setConfig({ idolCount: Number(rules.settings.idolCount ?? details.config?.idolCount), idolPowerPool: details.config?.idolPowerPool ?? null })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load idol rules')
    }
  }, [leagueId])

  useEffect(() => { void load() }, [load])

  async function save() {
    if (!canEdit || !config) return
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/update-settings`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { idolCount: config.idolCount } }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Could not save idol count')
      const poolResponse = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idolPowerPool: config.idolPowerPool ?? DEFAULT_POOL }),
      })
      const poolPayload = await poolResponse.json()
      if (!poolResponse.ok) throw new Error(poolPayload.error ?? 'Idol count saved, but the power pool could not be saved')
      setConfig(current => current ? { ...current, idolCount: payload.settings.idolCount } : current)
      setMessage('Idol count and power pool saved for the draft.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not save idol count')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
      <p className="text-[11px] text-amber-200/80">The system assigns hidden idols to drafted NBA players. About one third of managers receive one at the default count; extra idols may land on the same manager. A playing commissioner cannot see who holds them. Set the count before the draft starts.</p>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {!config && !error && <p role="status" className="text-sm text-white/50">Loading idol rules…</p>}
      {config && <SettingsSection id="sv-idol-current" title="Current idol configuration">
        <SettingsRow label="Idols assigned after draft" description="Choose 1–40. Each idol is bound to a unique drafted player." control={<Input type="number" min={1} max={40} value={config.idolCount} onChange={event => setConfig(current => current ? { ...current, idolCount: Number(event.target.value) } : current)} disabled={!canEdit || saving} className="w-24" />} />
        <SettingsRow label="Power pool" description="Only implemented powers can be seeded. Choose at least one before the draft starts." control={<div className="grid grid-cols-2 gap-2">{AVAILABLE_POWERS.map(([power, label]) => { const selected = config.idolPowerPool ?? DEFAULT_POOL; return <label key={power} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected.includes(power)} disabled={!canEdit || saving} onChange={() => setConfig(current => { if (!current) return current; const previous = current.idolPowerPool ?? DEFAULT_POOL; return { ...current, idolPowerPool: previous.includes(power) ? previous.filter(value => value !== power) : [...previous, power] } })} />{label}</label> })}</div>} />
        <div className="flex justify-end"><button type="button" onClick={() => void save()} disabled={!canEdit || saving || !Number.isInteger(config.idolCount) || config.idolCount < 1 || config.idolCount > 40 || (config.idolPowerPool ?? DEFAULT_POOL).length === 0} className="rounded-xl border border-[#ff3d81]/40 bg-cyan-950/40 px-5 py-2 text-sm text-[#ffd7e5] disabled:opacity-40">{saving ? 'Saving…' : 'Save idol setup'}</button></div>
      </SettingsSection>}
      {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
    </div>
  )
}
