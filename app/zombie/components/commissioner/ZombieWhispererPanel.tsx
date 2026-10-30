'use client'

import { useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Select } from '@/app/league/[leagueId]/tabs/settings/components'

type LeaguePayload = {
  league?: {
    status?: string
    sport?: string
    experienceMode?: string
    whispererCount?: number
    whispererSelectionMode?: string
    whispererAmbushCount?: number
    whispererRecord?: { id: string } | null
    config?: { whispererSelection?: string; ambushCountPerWeek?: number } | null
  }
  viewerIsCommissioner?: boolean
}

export function ZombieWhispererPanel({
  leagueId,
  canEdit,
}: {
  leagueId: string
  canEdit: boolean
}) {
  const [selection, setSelection] = useState('random')
  const [locked, setLocked] = useState(true)
  const [commissioner, setCommissioner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [ambushCount, setAmbushCount] = useState(3)
  const [weeklyCap, setWeeklyCap] = useState(1)
  const [whispererCount, setWhispererCount] = useState(1)
  const [allowsTwo, setAllowsTwo] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setMessage('')
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load Whisperer settings.')
        return (await response.json()) as LeaguePayload
      })
      .then((data) => {
        if (!active) return
        const league = data.league
        if (!league) throw new Error('Zombie league not found.')
        const mode = league.config?.whispererSelection ?? league.whispererSelectionMode
        setSelection(mode === 'veteran_priority' ? 'veteran_priority' : 'random')
        setLocked(Boolean(league.whispererRecord) || !['setup', 'registering'].includes(league.status ?? ''))
        setCommissioner(Boolean(data.viewerIsCommissioner))
        setAmbushCount(typeof league.whispererAmbushCount === 'number' ? league.whispererAmbushCount : 3)
        setWeeklyCap(typeof league.config?.ambushCountPerWeek === 'number' ? league.config.ambushCountPerWeek : 1)
        setWhispererCount(league.whispererCount === 2 ? 2 : 1)
        setAllowsTwo(league.experienceMode !== 'simple' && ['NBA', 'NHL', 'MLB'].includes((league.sport ?? '').toUpperCase()))
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Could not load settings.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [leagueId])

  const editable = canEdit && commissioner && !locked && !loading && !saving

  async function save() {
    if (!editable) return
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/zombie/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId, whispererSelectionMode: selection, whispererCount, whispererAmbushCount: ambushCount, ambushCountPerWeek: weeklyCap }),
      })
      const result = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not save Whisperer settings.')
      setMessage('Whisperer settings saved for the upcoming draft.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save Whisperer settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 px-4 py-5 text-[13px] text-white/85 sm:px-6">
      <SettingsSection id="zm-whisperer" title="Whisperer selection">
        <SettingsRow
          label="Selection mode"
          description={locked
            ? 'Locked after the draft assigns the Whisperer.'
            : 'Choose how the Whisperer is picked when the draft completes.'}
          control={
            <Select aria-label="Selection mode" value={selection} onChange={setSelection} disabled={!editable} className="min-h-[44px]">
              <option value="random">Random</option>
              <option value="veteran_priority">Veteran priority</option>
            </Select>
          }
        />
        {allowsTwo && <SettingsRow label="Whisperer seats" description="Each Whisperer has a separate ambush balance." control={<Select aria-label="Whisperer seats" value={String(whispererCount)} onChange={(value) => setWhispererCount(Number(value))} disabled={!editable} className="min-h-[44px]"><option value="1">One</option><option value="2">Two</option></Select>} />}
        <SettingsRow label="Season ambushes" description="Total ambushes granted when the Whisperer is chosen." control={<input aria-label="Season ambushes" type="number" min={0} max={20} value={ambushCount} onChange={(event) => setAmbushCount(Number(event.target.value))} disabled={!editable} className="min-h-[44px] w-20 rounded-lg border border-white/15 bg-[#050a18] px-2" />} />
        <SettingsRow label="Per-week cap" description="Maximum matchup swaps in one week." control={<input aria-label="Per-week cap" type="number" min={0} max={5} value={weeklyCap} onChange={(event) => setWeeklyCap(Number(event.target.value))} disabled={!editable} className="min-h-[44px] w-20 rounded-lg border border-white/15 bg-[#050a18] px-2" />} />
      </SettingsSection>

      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <p className="font-semibold text-white">Permanent trade rule</p>
        <p className="mt-1 text-white/65">Whisperers cannot trade players at any point in the season.</p>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
        <p className="font-semibold text-amber-200">Matchup ambush</p>
        <p className="mt-1 text-white/65">
          Each Whisperer has {ambushCount} season ambushes and may use {weeklyCap} per week. Before scoring starts, use @Chimmy ambush swap followed by an exact Survivor team name to change two matchups.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!editable}
          className="min-h-[44px] rounded-lg bg-red-700/30 px-5 py-2 font-semibold text-red-100 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save Whisperer settings'}
        </button>
        {loading && <span className="text-white/55">Loading settings…</span>}
        {message && <span role="status" className="text-white/70">{message}</span>}
      </div>
    </div>
  )
}
