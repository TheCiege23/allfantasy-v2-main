'use client'

import { useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Select } from '@/app/league/[leagueId]/tabs/settings/components'

type LeaguePayload = {
  league?: {
    status?: string
    whispererSelectionMode?: string
    whispererAmbushCount?: number
    whispererRecord?: { id: string } | null
    config?: { whispererSelection?: string } | null
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
  const [ambushCount, setAmbushCount] = useState<number | null>(null)

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
        setAmbushCount(typeof league.whispererAmbushCount === 'number' ? league.whispererAmbushCount : null)
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
        body: JSON.stringify({ leagueId, whispererSelectionMode: selection }),
      })
      const result = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not save Whisperer settings.')
      setMessage('Selection saved for the upcoming draft.')
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
            <Select value={selection} onChange={setSelection} disabled={!editable}>
              <option value="random">Random</option>
              <option value="veteran_priority">Veteran priority</option>
            </Select>
          }
        />
      </SettingsSection>

      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <p className="font-semibold text-white">Permanent trade rule</p>
        <p className="mt-1 text-white/65">Whisperers cannot trade players at any point in the season.</p>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
        <p className="font-semibold text-amber-200">Ambush power is not active yet</p>
        <p className="mt-1 text-white/65">
          The league currently tracks {ambushCount ?? 0} ambushes, but @Chimmy will not spend one
          until matchup changes are implemented and verified.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!editable}
          className="min-h-[44px] rounded-lg bg-red-700/30 px-5 py-2 font-semibold text-red-100 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save selection'}
        </button>
        {loading && <span className="text-white/55">Loading settings…</span>}
        {message && <span role="status" className="text-white/70">{message}</span>}
      </div>
    </div>
  )
}
