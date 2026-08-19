'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Select, Input } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'

type SurvivorConfigApi = {
  tribeCount: number
  tribeSize: number
  tribeFormation: string
  mergeTrigger: string
  mergeWeek: number
  seasonThemeLabel: string | null
  challengesSystemRun: boolean
  regularSeasonEndWeek: number | null
}

export function SurvivorSetupPanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  const d = !canEdit
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const [tribeCount, setTribeCount] = useState('3')
  const [tribeSize, setTribeSize] = useState('4')
  const [tribeFormation, setTribeFormation] = useState('random')
  const [mergeTrigger, setMergeTrigger] = useState('week')
  const [mergeWeek, setMergeWeek] = useState('10')
  const [seasonThemeLabel, setSeasonThemeLabel] = useState('')
  const [challengesSystemRun, setChallengesSystemRun] = useState(true)
  const [regularSeasonEndWeek, setRegularSeasonEndWeek] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, { credentials: 'include' })
      if (!res.ok) {
        setError(`Could not load config (${res.status})`)
        return
      }
      const data = (await res.json()) as { config?: SurvivorConfigApi | null }
      const c = data.config
      if (!c) return
      setTribeCount(String(Math.min(4, Math.max(2, c.tribeCount))))
      setTribeSize(String(c.tribeSize))
      setTribeFormation(c.tribeFormation || 'random')
      setMergeTrigger(c.mergeTrigger || 'week')
      setMergeWeek(String(c.mergeWeek ?? 10))
      setSeasonThemeLabel(c.seasonThemeLabel ?? '')
      setChallengesSystemRun(c.challengesSystemRun !== false)
      setRegularSeasonEndWeek(c.regularSeasonEndWeek != null ? String(c.regularSeasonEndWeek) : '')
    } catch {
      setError('Failed to load Survivor config')
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    if (d) return
    setSaving(true)
    setError(null)
    setSavedAt(null)
    try {
      const tc = Math.min(4, Math.max(2, Number(tribeCount) || 3))
      const mw = Number(mergeWeek)
      const rsw = regularSeasonEndWeek.trim() === '' ? null : Math.min(52, Math.max(1, Number(regularSeasonEndWeek)))
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tribeCount: tc,
          tribeSize: Math.max(1, Number(tribeSize) || 4),
          tribeFormation,
          mergeTrigger,
          mergeWeek: Number.isFinite(mw) ? mw : 10,
          seasonThemeLabel: seasonThemeLabel.trim() === '' ? null : seasonThemeLabel.trim(),
          challengesSystemRun,
          regularSeasonEndWeek: rsw,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof payload?.error === 'string' ? payload.error : 'Save failed')
        return
      }
      setSavedAt(new Date().toISOString())
    } catch {
      setError('Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
      <p className="text-[11px] text-amber-200/80">
        Structure, merge timing, season headline, and system-run challenges (reduces collusion when the commissioner plays).
      </p>
      {loading && <p className="text-sm text-white/50">Loading…</p>}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {savedAt && <p className="text-xs text-emerald-300/90">Saved.</p>}

      <SettingsSection id="sv-structure" title="League structure" description="2–4 tribes; headline is yours.">
        <SettingsRow
          label="Season headline / theme"
          description="Shown on the Survivor home tab (e.g. Heroes vs Villains)."
          control={
            <Input
              value={seasonThemeLabel}
              onChange={(e) => setSeasonThemeLabel(e.target.value)}
              disabled={d}
              placeholder="e.g. Heroes vs Villains"
              className="max-w-md"
              data-testid="survivor-season-theme-input"
            />
          }
        />
        <SettingsRow
          label="Tribe count"
          control={
            <Select value={tribeCount} onChange={setTribeCount} disabled={d}>
              {['2', '3', '4'].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          }
        />
        <SettingsRow
          label="Tribe size"
          control={
            <Input
              type="number"
              min={1}
              value={tribeSize}
              onChange={(e) => setTribeSize(e.target.value)}
              disabled={d}
              className="w-24"
            />
          }
        />
        <SettingsRow
          label="Tribe formation"
          control={
            <Select value={tribeFormation} onChange={setTribeFormation} disabled={d}>
              <option value="random">Random</option>
              <option value="commissioner">Commissioner</option>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection id="sv-timing" title="Season timing">
        <SettingsRow
          label="Merge trigger"
          control={
            <Select value={mergeTrigger} onChange={setMergeTrigger} disabled={d}>
              <option value="week">Week</option>
              <option value="player_count">Player count</option>
            </Select>
          }
        />
        <SettingsRow
          label="Merge week"
          description="When merge trigger is week-based."
          control={
            <Input type="number" value={mergeWeek} onChange={(e) => setMergeWeek(e.target.value)} disabled={d} className="w-24" />
          }
        />
        <SettingsRow
          label="Regular season end week (optional)"
          description="Override last fantasy regular-season week for scheduling copy (1–52). Leave blank for your sport’s default (no playoffs)."
          control={
            <Input
              type="number"
              min={1}
              max={52}
              value={regularSeasonEndWeek}
              onChange={(e) => setRegularSeasonEndWeek(e.target.value)}
              disabled={d}
              placeholder="auto"
              className="w-24"
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="sv-challenges" title="Challenges">
        <SettingsRow
          label="System-run weekly challenges"
          description="When on, the catalog generates the weekly challenge — the commissioner is not hand-picking props."
          control={
            <button
              type="button"
              role="switch"
              aria-checked={challengesSystemRun}
              disabled={d}
              onClick={() => setChallengesSystemRun((v) => !v)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium ${
                challengesSystemRun ? 'bg-[#ff3d81]/25 text-[#ffd7e5]' : 'bg-white/10 text-white/60'
              }`}
              data-testid="survivor-challenges-system-toggle"
            >
              {challengesSystemRun ? 'On' : 'Off'}
            </button>
          }
        />
      </SettingsSection>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => save()}
          disabled={d || saving || loading}
          className="rounded-xl border border-[#ff3d81]/40 bg-cyan-950/40 px-5 py-2 text-sm text-[#ffd7e5] hover:bg-cyan-950/60 disabled:opacity-40"
          data-testid="survivor-setup-save"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
