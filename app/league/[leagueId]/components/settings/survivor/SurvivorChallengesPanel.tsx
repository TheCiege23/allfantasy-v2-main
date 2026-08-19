'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Toggle, Select } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'

export function SurvivorChallengesPanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  const [lockKickoff, setLockKickoff] = useState(true)
  const [submit, setSubmit] = useState('both')
  const [sportGen, setSportGen] = useState('league')
  const d = !canEdit

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [challengesSystemRun, setChallengesSystemRun] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, { credentials: 'include' })
      if (!res.ok) return
      const data = (await res.json()) as { config?: { challengesSystemRun?: boolean } | null }
      if (data.config?.challengesSystemRun != null) {
        setChallengesSystemRun(data.config.challengesSystemRun !== false)
      }
    } catch {
      setError('Could not load challenge settings')
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  async function saveSystemRun() {
    if (d) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengesSystemRun }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof payload?.error === 'string' ? payload.error : 'Save failed')
      }
    } catch {
      setError('Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
      <p className="text-[11px] text-amber-200/80">
        System-run challenges pull from the catalog each week so the host is not inventing props by hand (fairer when the commissioner plays).
      </p>
      {loading && <p className="text-sm text-white/50">Loading…</p>}
      {error && <p className="text-sm text-rose-300">{error}</p>}

      <SettingsSection id="sv-ch-auto" title="Challenge automation">
        <SettingsRow
          label="System-run weekly challenges"
          description="Matches Survivor Setup — saved here for quick access."
          control={
            <Toggle
              checked={challengesSystemRun}
              onChange={(v) => {
                setChallengesSystemRun(v)
              }}
              disabled={d}
            />
          }
        />
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => saveSystemRun()}
            disabled={d || saving || loading}
            className="rounded-xl border border-[#ff3d81]/35 bg-cyan-950/30 px-4 py-2 text-xs text-[#ffd7e5] hover:bg-cyan-950/45 disabled:opacity-40"
            data-testid="survivor-challenges-save"
          >
            {saving ? 'Saving…' : 'Save challenge mode'}
          </button>
        </div>
        <SettingsRow
          label="Auto-generate for sport"
          control={
            <Select value={sportGen} onChange={setSportGen} disabled={d}>
              <option value="league">Same as league sport</option>
            </Select>
          }
        />
      </SettingsSection>
      <SettingsSection id="sv-ch-time" title="Challenge timing">
        <SettingsRow label="Lock at kickoff" control={<Toggle checked={lockKickoff} onChange={setLockKickoff} disabled={d} />} />
        <SettingsRow
          label="Submission method"
          control={
            <Select value={submit} onChange={setSubmit} disabled={d}>
              <option value="tribe_chat">Tribe chat</option>
              <option value="private_chimmy">Private @Chimmy</option>
              <option value="both">Both</option>
            </Select>
          }
        />
      </SettingsSection>
    </div>
  )
}
