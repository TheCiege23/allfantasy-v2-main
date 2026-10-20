'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Toggle, Select, Input } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'

type CouncilSettings = {
  tribalCouncilDay: string
  tribalCouncilTime: string
  voteCloseOffset: number
  selfVotesAllowed: boolean
  lateVotesAllowed: boolean
  voteChangePolicy: 'first_valid_locks' | 'allow_until_close'
  tieRule: 'revote_then_rocks' | 'rocks_immediately' | 'revote_then_season_points' | 'season_points_only'
  nonVoterAutoCast: boolean
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function SurvivorTribalPanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  const [settings, setSettings] = useState<CouncilSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/state`, { credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || !payload.settings) throw new Error(payload.error ?? 'Could not load council rules')
      const current = payload.settings as CouncilSettings
      setSettings({
        tribalCouncilDay: current.tribalCouncilDay,
        tribalCouncilTime: current.tribalCouncilTime,
        voteCloseOffset: current.voteCloseOffset,
        selfVotesAllowed: current.selfVotesAllowed,
        lateVotesAllowed: current.lateVotesAllowed,
        voteChangePolicy: current.voteChangePolicy,
        tieRule: current.tieRule ?? 'revote_then_rocks',
        nonVoterAutoCast: current.nonVoterAutoCast !== false,
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load council rules')
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
      if (!response.ok) throw new Error(payload.error ?? 'Could not save council rules')
      setSettings(payload.settings as CouncilSettings)
      setMessage('Council rules saved. Active vote windows keep their existing deadline.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save council rules')
    } finally {
      setSaving(false)
    }
  }

  const update = <K extends keyof CouncilSettings>(key: K, value: CouncilSettings[K]) => {
    setSettings((current) => current ? { ...current, [key]: value } : current)
  }

  return (
    <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
      <p className="text-[11px] text-amber-200/80">These rules control the system-run Torch Ceremony and private ballots. Times are Eastern.</p>
      {loading && <p role="status" className="text-sm text-white/50">Loading council rules…</p>}
      {settings && <>
        <SettingsSection id="sv-vote-rules" title="Private voting">
          <SettingsRow label="Self-vote allowed" control={<Toggle checked={settings.selfVotesAllowed} onChange={(value) => update('selfVotesAllowed', value)} disabled={!canEdit || saving} />} />
          <SettingsRow label="Late votes count" control={<Toggle checked={settings.lateVotesAllowed} onChange={(value) => update('lateVotesAllowed', value)} disabled={!canEdit || saving} />} />
          <SettingsRow label="Vote change policy" control={<Select value={settings.voteChangePolicy} onChange={(value) => update('voteChangePolicy', value as CouncilSettings['voteChangePolicy'])} disabled={!canEdit || saving}><option value="first_valid_locks">First valid vote locks</option><option value="allow_until_close">Allow changes until close</option></Select>} />
          <SettingsRow label="Tie rule" description="Rocks is a seeded draw among the tied managers, recorded in the audit." control={<Select value={settings.tieRule} onChange={(value) => update('tieRule', value as CouncilSettings['tieRule'])} disabled={!canEdit || saving}><option value="revote_then_rocks">Revote, then rocks</option><option value="rocks_immediately">Rocks immediately</option>{(settings.tieRule === 'revote_then_season_points' || settings.tieRule === 'season_points_only') && <option value={settings.tieRule}>{settings.tieRule === 'season_points_only' ? 'Season points (legacy)' : 'Revote, then season points (legacy)'}</option>}</Select>} />
          <SettingsRow label="Missing ballots" description="A manager who does not vote has a ballot cast for them, for the lowest-scoring manager that week they could have voted for." control={<Toggle checked={settings.nonVoterAutoCast} onChange={(value) => update('nonVoterAutoCast', value)} disabled={!canEdit || saving} />} />
          <SettingsRow label="Vote window (hours)" description="Length of the private voting window after it opens." control={<Input type="number" min={1} max={168} value={settings.voteCloseOffset} onChange={(event) => update('voteCloseOffset', Number(event.target.value))} disabled={!canEdit || saving} className="w-24" />} />
        </SettingsSection>
        <SettingsSection id="sv-ceremony" title="Torch Ceremony">
          <SettingsRow label="Ceremony day" control={<Select value={settings.tribalCouncilDay} onChange={(value) => update('tribalCouncilDay', value)} disabled={!canEdit || saving}>{DAYS.map((day) => <option key={day} value={day}>{day}</option>)}</Select>} />
          <SettingsRow label="Ceremony time (Eastern)" control={<Input type="time" value={settings.tribalCouncilTime} onChange={(event) => update('tribalCouncilTime', event.target.value)} disabled={!canEdit || saving} className="w-32" />} />
        </SettingsSection>
        <div className="flex justify-end"><button type="button" onClick={() => void save()} disabled={!canEdit || saving || !Number.isInteger(settings.voteCloseOffset) || settings.voteCloseOffset < 1 || settings.voteCloseOffset > 168 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.tribalCouncilTime)} className="rounded-xl border border-[#ff3d81]/40 bg-cyan-950/40 px-5 py-2 text-sm text-[#ffd7e5] disabled:opacity-40">{saving ? 'Saving…' : 'Save council rules'}</button></div>
      </>}
      {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
    </div>
  )
}
