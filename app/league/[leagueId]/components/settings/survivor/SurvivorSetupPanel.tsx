'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Select, Input } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'

type Foundation = {
  commissionerParticipationMode: 'non_participating_host' | 'participating_player'
  tribeAssignmentMode: 'random' | 'commissioner_manual' | 'draft_pattern'
  mergeTriggerType: 'week' | 'active_player_count'
  mergeWeek: number
  mergeActivePlayerCount: number
  nbaWeeklyScoringMode: 'all_games' | 'one_game_per_player'
}
type Config = { seasonThemeLabel: string | null; regularSeasonEndWeek: number | null }

export function SurvivorSetupPanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  const [foundation, setFoundation] = useState<Foundation | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const [foundationResponse, configResponse] = await Promise.all([
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/state`, { credentials: 'include' }),
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, { credentials: 'include' }),
      ])
      const [foundationPayload, configPayload] = await Promise.all([foundationResponse.json(), configResponse.json()])
      if (!foundationResponse.ok || !foundationPayload.settings || !configResponse.ok || !configPayload.config) {
        throw new Error(foundationPayload.error ?? configPayload.error ?? 'Could not load Survivor setup')
      }
      const rules = foundationPayload.settings as Foundation
      const details = configPayload.config as Config
      setFoundation({ commissionerParticipationMode: rules.commissionerParticipationMode, tribeAssignmentMode: rules.tribeAssignmentMode, mergeTriggerType: rules.mergeTriggerType, mergeWeek: rules.mergeWeek, mergeActivePlayerCount: rules.mergeActivePlayerCount, nbaWeeklyScoringMode: rules.nbaWeeklyScoringMode ?? 'all_games' })
      setConfig({ seasonThemeLabel: details.seasonThemeLabel, regularSeasonEndWeek: details.regularSeasonEndWeek })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load Survivor setup')
    } finally {
      setLoading(false)
    }
  }, [leagueId])
  useEffect(() => { void load() }, [load])

  async function saveFoundation() {
    if (!canEdit || !foundation) return
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/update-settings`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: foundation }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Could not save season structure')
      const saved = payload.settings as Foundation
      setFoundation({ commissionerParticipationMode: saved.commissionerParticipationMode, tribeAssignmentMode: saved.tribeAssignmentMode, mergeTriggerType: saved.mergeTriggerType, mergeWeek: saved.mergeWeek, mergeActivePlayerCount: saved.mergeActivePlayerCount, nbaWeeklyScoringMode: saved.nbaWeeklyScoringMode })
      setMessage('Season structure saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save season structure')
    } finally { setSaving(false) }
  }

  async function saveSeasonDetails() {
    if (!canEdit || !config) return
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Could not save season details')
      setConfig({ seasonThemeLabel: payload.config.seasonThemeLabel, regularSeasonEndWeek: payload.config.regularSeasonEndWeek })
      setMessage('Season details saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save season details')
    } finally { setSaving(false) }
  }

  return <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
    <p className="text-[11px] text-amber-200/80">Set the NBA Survivor structure before the draft. Tribe identities and capacities are saved in the Tribes panel.</p>
    {loading && <p role="status" className="text-sm text-white/50">Loading Survivor setup…</p>}
    {foundation && <SettingsSection id="sv-structure" title="Season structure">
      <SettingsRow label="Tribe formation" description={foundation.commissionerParticipationMode === 'participating_player' ? 'Playing commissioners use system-run assignment.' : undefined} control={<Select value={foundation.tribeAssignmentMode} onChange={(value) => setFoundation((current) => current ? { ...current, tribeAssignmentMode: value as Foundation['tribeAssignmentMode'] } : current)} disabled={!canEdit || saving}><option value="random">System random</option><option value="commissioner_manual" disabled={foundation.commissionerParticipationMode === 'participating_player'}>Commissioner assigns</option><option value="draft_pattern">Draft order pattern</option></Select>} />
      <SettingsRow label="Merge trigger" control={<Select value={foundation.mergeTriggerType} onChange={(value) => setFoundation((current) => current ? { ...current, mergeTriggerType: value as Foundation['mergeTriggerType'] } : current)} disabled={!canEdit || saving}><option value="week">Week</option><option value="active_player_count">Active manager count</option></Select>} />
      {foundation.mergeTriggerType === 'week'
        ? <SettingsRow label="Merge week" control={<Input type="number" min={1} max={52} value={foundation.mergeWeek} onChange={(event) => setFoundation((current) => current ? { ...current, mergeWeek: Number(event.target.value) } : current)} disabled={!canEdit || saving} className="w-24" />} />
        : <SettingsRow label="Merge at active managers" control={<Input type="number" min={2} max={40} value={foundation.mergeActivePlayerCount} onChange={(event) => setFoundation((current) => current ? { ...current, mergeActivePlayerCount: Number(event.target.value) } : current)} disabled={!canEdit || saving} className="w-24" />} />}
      <SettingsRow label="NBA weekly scoring" description="Tuesday–Monday. All games adds every game each starter plays. One game lets managers choose a game before that player’s first tipoff; without a choice, the first game counts automatically. This rule locks when the draft starts." control={<Select value={foundation.nbaWeeklyScoringMode} onChange={(value) => setFoundation((current) => current ? { ...current, nbaWeeklyScoringMode: value as Foundation['nbaWeeklyScoringMode'] } : current)} disabled={!canEdit || saving}><option value="all_games">All games count</option><option value="one_game_per_player">One game per player</option></Select>} />
      <div className="flex justify-end"><button type="button" onClick={() => void saveFoundation()} disabled={!canEdit || saving || !Number.isInteger(foundation.mergeWeek) || foundation.mergeWeek < 1 || foundation.mergeWeek > 52 || !Number.isInteger(foundation.mergeActivePlayerCount) || foundation.mergeActivePlayerCount < 2 || foundation.mergeActivePlayerCount > 40} className="rounded-xl border border-[#ff3d81]/40 bg-cyan-950/40 px-5 py-2 text-sm text-[#ffd7e5] disabled:opacity-40">{saving ? 'Saving…' : 'Save structure'}</button></div>
    </SettingsSection>}
    {config && <SettingsSection id="sv-season-details" title="Season details">
      <SettingsRow label="Season headline" control={<Input value={config.seasonThemeLabel ?? ''} onChange={(event) => setConfig((current) => current ? { ...current, seasonThemeLabel: event.target.value } : current)} disabled={!canEdit || saving} placeholder="e.g. Rivalry Island" className="max-w-md" data-testid="survivor-season-theme-input" />} />
      <SettingsRow label="Regular season end week" description="Leave blank for the NBA season default." control={<Input type="number" min={1} max={52} value={config.regularSeasonEndWeek ?? ''} onChange={(event) => setConfig((current) => current ? { ...current, regularSeasonEndWeek: event.target.value === '' ? null : Number(event.target.value) } : current)} disabled={!canEdit || saving} placeholder="auto" className="w-24" />} />
      <div className="flex justify-end"><button type="button" onClick={() => void saveSeasonDetails()} disabled={!canEdit || saving || (config.regularSeasonEndWeek !== null && (!Number.isInteger(config.regularSeasonEndWeek) || config.regularSeasonEndWeek < 1 || config.regularSeasonEndWeek > 52))} className="rounded-xl border border-[#ff3d81]/40 bg-cyan-950/40 px-5 py-2 text-sm text-[#ffd7e5] disabled:opacity-40" data-testid="survivor-setup-save">{saving ? 'Saving…' : 'Save season details'}</button></div>
    </SettingsSection>}
    {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
  </div>
}
