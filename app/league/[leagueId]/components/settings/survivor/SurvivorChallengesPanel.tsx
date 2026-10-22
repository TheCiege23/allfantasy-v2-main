'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Toggle } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'

export function SurvivorChallengesPanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  const d = !canEdit

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingImmunity, setSavingImmunity] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [immunityMessage, setImmunityMessage] = useState<string | null>(null)
  const [challengesSystemRun, setChallengesSystemRun] = useState(true)
  const [twoHighestTribesImmune, setTwoHighestTribesImmune] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [configRes, stateRes] = await Promise.all([
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, { credentials: 'include' }),
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/state`, { credentials: 'include' }),
      ])
      if (!configRes.ok) throw new Error('Could not load challenge settings')
      const data = (await configRes.json()) as { config?: { challengesSystemRun?: boolean } | null }
      if (data.config?.challengesSystemRun != null) {
        setChallengesSystemRun(data.config.challengesSystemRun !== false)
      }
      if (stateRes.ok) {
        const state = (await stateRes.json().catch(() => null)) as { settings?: { twoHighestTribesImmune?: boolean } } | null
        setTwoHighestTribesImmune(state?.settings?.twoHighestTribesImmune === true)
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

  // A season rule (lib/survivor/survivorSettings.ts), saved through the foundation route like the
  // council rules; it locks when the draft starts.
  async function saveTribeImmunity() {
    if (d) return
    setSavingImmunity(true)
    setImmunityMessage(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/update-settings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { twoHighestTribesImmune } }),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string; settings?: { twoHighestTribesImmune?: boolean } }
      if (!res.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Save failed')
      if (payload?.settings?.twoHighestTribesImmune != null) setTwoHighestTribesImmune(payload.settings.twoHighestTribesImmune === true)
      setImmunityMessage('Tribe immunity rule saved.')
    } catch (err) {
      setImmunityMessage(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingImmunity(false)
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
      </SettingsSection>

      <SettingsSection id="sv-ch-immunity" title="Tribe immunity">
        <SettingsRow
          label="Two highest tribes are safe"
          description="With three or more tribes, the two highest-scoring tribes skip Tribal Council; off, only the highest tribe does. The lowest-scoring tribe that is not safe attends either way, and a tribe that wins immunity in a challenge is always safe. Locks when the draft starts."
          control={<Toggle checked={twoHighestTribesImmune} onChange={(v) => setTwoHighestTribesImmune(v)} disabled={d || savingImmunity} />}
        />
        <div className="flex items-center justify-end gap-3 pt-1">
          {immunityMessage && <p role="status" className="text-xs text-amber-200">{immunityMessage}</p>}
          <button
            type="button"
            onClick={() => void saveTribeImmunity()}
            disabled={d || savingImmunity || loading}
            className="rounded-xl border border-[#ff3d81]/35 bg-cyan-950/30 px-4 py-2 text-xs text-[#ffd7e5] hover:bg-cyan-950/45 disabled:opacity-40"
            data-testid="survivor-tribe-immunity-save"
          >
            {savingImmunity ? 'Saving…' : 'Save tribe immunity'}
          </button>
        </div>
      </SettingsSection>

      <p className="text-xs text-white/50">
        Challenge rewards pay out on their own: FAAB lands in the winner&apos;s waiver budget, individual immunity keeps the winner off that week&apos;s ballot, and tribe immunity keeps the tribe home from council. Challenge locks and submission methods are set by the active challenge; review each challenge before its game window.
      </p>
      <Link href={`/survivor/${encodeURIComponent(leagueId)}/challenges`} className="inline-flex text-sm text-cyan-300 hover:text-cyan-200">Open challenges →</Link>
    </div>
  )
}
